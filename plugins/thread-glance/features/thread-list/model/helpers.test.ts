import { describe, expect, it } from "vitest";
import { mapBbPreferences, coercePreferences, defaultPreferences } from "@/shared/preferences";
import { resolveDrop, type DraggedThread } from "./drag";
import { moveGroup, resolveGroupOrder } from "./groups";
import { assignProviderMarks, providerMark } from "./provider-mark";
import { olderRowText } from "./labels";
import { FOLDED_STEP, railLeft, railsFor, ROOT_INDENT, rowIndent, titleTreatment } from "./layout";
import { chipTone } from "./state";
import { formatDuration, trailingTime } from "./time";
import type { OlderRow } from "./view";
import { chunk, windowedNavValue } from "./windowing";

describe("group order", () => {
  it("expands the legacy anchor and keeps Pinned and Threads", () => {
    expect(resolveGroupOrder("project", ["pinned", "projects", "threads"], ["project:a", "project:b"])).toEqual([
      "pinned",
      "project:a",
      "project:b",
      "threads",
    ]);
  });
  it("keeps explicit order, drops unknown ids, splices new entities after the last entity", () => {
    expect(
      resolveGroupOrder("project", ["project:b", "gone", "project:a", "threads"], ["project:a", "project:b", "project:c"]),
    ).toEqual(["pinned", "project:b", "project:a", "project:c", "threads"]);
  });
  it("moves a header before or after another", () => {
    expect(moveGroup(["pinned", "a", "b", "threads"], "b", "a", "before")).toEqual(["pinned", "b", "a", "threads"]);
    expect(moveGroup(["pinned", "a", "b", "threads"], "a", "threads", "after")).toEqual(["pinned", "b", "threads", "a"]);
  });
});

describe("drop resolution (drag guards)", () => {
  const parents: Record<string, string | null> = { p: null, c: "p", g: "c", x: null };
  const context = {
    mode: "project" as const,
    parentOf: (id: string) => parents[id] ?? null,
    pinnedOrder: ["pa", "pb", "pc"],
    groupOfThread: () => "project:a",
  };
  const source = (overrides: Partial<DraggedThread> = {}): DraggedThread => ({
    threadId: "p",
    parentThreadId: null,
    sectionId: null,
    pinned: false,
    ...overrides,
  });
  it("nests on a row's middle, but never into its own subtree", () => {
    expect(resolveDrop(source({ threadId: "x" }), { kind: "thread", threadId: "c", zone: "middle", inPinned: false }, context))
      .toEqual({ type: "nest", threadId: "x", parentThreadId: "c", unpinFirst: false });
    expect(resolveDrop(source(), { kind: "thread", threadId: "g", zone: "middle", inPinned: false }, context)).toEqual({
      type: "blocked",
    });
    expect(
      resolveDrop(source({ threadId: "c", parentThreadId: "p" }), { kind: "thread", threadId: "p", zone: "middle", inPinned: false }, context),
    ).toEqual({ type: "unchanged" });
  });
  it("pins on Pinned, unpins out of it, detaches onto a group", () => {
    expect(resolveDrop(source(), { kind: "group", groupId: "pinned" }, context)).toEqual({ type: "pin", threadId: "p" });
    expect(resolveDrop(source({ pinned: true }), { kind: "group", groupId: "project:a" }, context)).toEqual({
      type: "unpin",
      threadId: "p",
    });
    expect(resolveDrop(source({ threadId: "c", parentThreadId: "p" }), { kind: "group", groupId: "project:a" }, context)).toEqual({
      type: "detach",
      threadId: "c",
    });
    expect(resolveDrop(source(), { kind: "group", groupId: "project:a" }, context)).toEqual({ type: "unchanged" });
  });
  it("moves between sections in custom mode", () => {
    const chrono = { ...context, mode: "chronological" as const };
    expect(resolveDrop(source(), { kind: "group", groupId: "section:s1" }, chrono)).toEqual({
      type: "move",
      threadId: "p",
      sectionId: "s1",
      detach: false,
    });
    expect(resolveDrop(source({ sectionId: "s1" }), { kind: "group", groupId: "section:s1" }, chrono)).toEqual({
      type: "unchanged",
    });
  });
  it("reorders inside Pinned with neighbour ids", () => {
    expect(
      resolveDrop(source({ threadId: "pc", pinned: true }), { kind: "thread", threadId: "pa", zone: "after", inPinned: true }, context),
    ).toEqual({ type: "reorder-pinned", threadId: "pc", previousThreadId: "pa", nextThreadId: "pb" });
    expect(
      resolveDrop(source({ threadId: "pb", pinned: true }), { kind: "thread", threadId: "pa", zone: "after", inPinned: true }, context),
    ).toEqual({ type: "unchanged" });
  });
});

describe("time", () => {
  it("formats ages", () => {
    expect([30e3, 5 * 60e3, 3 * 3600e3, 2 * 86400e3, 30 * 86400e3].map(formatDuration)).toEqual([
      "now",
      "5m",
      "3h",
      "2d",
      "4w",
    ]);
  });
  it("working rows show time since start, or nothing without a stamp", () => {
    const thread = { id: "t", latestAttentionAt: 0, createdAt: 0 };
    const stamps = { startedAt: { t: 1000 }, finishedAt: {} };
    expect(trailingTime(thread, true, stamps, 1000 + 4 * 60e3)?.text).toBe("4m");
    expect(trailingTime(thread, true, { startedAt: {}, finishedAt: {} }, 5)).toBeNull();
  });
  it("age is time since the last finish", () => {
    const thread = { id: "t", latestAttentionAt: 1000, createdAt: 0 };
    expect(trailingTime(thread, false, { startedAt: {}, finishedAt: { t: 3600e3 } }, 2 * 3600e3)?.text).toBe("1h");
  });
});

describe("provider marks", () => {
  it("gives the four built-in harnesses distinct marks", () => {
    const marks = assignProviderMarks([
      { id: "claude-code", displayName: "Claude Code" },
      { id: "codex", displayName: "Codex" },
      { id: "pi", displayName: "Pi" },
      { id: "acp-cursor", displayName: "Cursor" },
    ]);
    expect(new Set(marks.values()).size).toBe(4);
    expect(marks.get("claude-code")).toBe("CL");
  });
  it("resolves clashes from the next word, then the id", () => {
    const marks = assignProviderMarks([
      { id: "a", displayName: "Open Code" },
      { id: "b", displayName: "Open Cursor" },
    ]);
    expect(marks.get("a")).toBe("OP");
    expect(marks.get("b")).toBe("OC");
  });
  it("falls back to the id while the roster loads", () => {
    expect(providerMark("codex", new Map())).toBe("CO");
  });
});

describe("windowed nav contract", () => {
  it("pins bb 0.43.4's `threadId:projectId` space-separated format", () => {
    expect(
      windowedNavValue([
        { threadId: "thr_1", projectId: "proj_a" },
        { threadId: "thr_2", projectId: "proj_b" },
      ]),
    ).toBe("thr_1:proj_a thr_2:proj_b");
  });
  it("chunks keep order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("preferences", () => {
  it("imports bb's values, maps auto grouping to off and skips collapsedThreads", () => {
    expect(
      mapBbPreferences({
        organizationMode: "chronological",
        environmentGrouping: "auto",
        collapsedThreads: ["t1"],
        hiddenGroups: ["project:x", "project:x"],
        chronologicalSort: "bogus",
        unknownKey: 1,
      }),
    ).toEqual({ organizationMode: "chronological", environmentGrouping: false, hiddenGroups: ["project:x"] });
    expect(mapBbPreferences({ environmentGrouping: true })).toEqual({ environmentGrouping: true });
  });
  it("defaults follow the spec", () => {
    expect(defaultPreferences()).toMatchObject({
      organizationMode: "project",
      foldOlder: true,
      workingFirst: false,
      environmentGrouping: false,
      showPullRequests: true,
    });
  });
  it("a bad mirror value falls back per key", () => {
    expect(coercePreferences({ organizationMode: "machine", foldOlder: "yes" })).toMatchObject({ organizationMode: "machine", foldOlder: true });
  });
  it("reads a saved tree nesting as the folded layout, without an error", () => {
    const prefs = coercePreferences({ nesting: "tree", collapsedChildren: ["p"], foldOlder: false });
    expect(prefs).not.toHaveProperty("nesting");
    expect(prefs).not.toHaveProperty("collapsedChildren");
    expect(prefs.foldOlder).toBe(false);
  });
});

describe("row indent", () => {
  it("steps each level by 12px", () => {
    expect(rowIndent(0)).toBe(ROOT_INDENT);
    expect(rowIndent(1)).toBe(ROOT_INDENT + FOLDED_STEP);
    expect(rowIndent(3)).toBe(8 + 12 * 3);
  });
});

describe("guide rails", () => {
  it("runs from under the parent through its children and ends on the last row", () => {
    // Root, three children (one a grandchild, at the same folded depth), the fold row, the next root.
    expect(railsFor([0, 1, 1, 1, 1, 0])).toEqual([
      ["start"],
      ["full", null],
      ["full", null],
      ["full", null],
      ["end", null],
      [null],
    ]);
  });
  it("draws no rail on a root with nothing under it", () => {
    expect(railsFor([0, 0])).toEqual([[null], [null]]);
  });
  it("keeps one rail per level and ends each where its subtree ends", () => {
    // a > b > (c, d), then a's other child e, then root f.
    expect(railsFor([0, 1, 2, 2, 1, 0])).toEqual([
      ["start"],
      ["full", "start"],
      ["full", "full", null],
      ["full", "end", null],
      ["end", null],
      [null],
    ]);
  });
  it("sits under the status slot of its level", () => {
    expect(railLeft(0)).toBe(ROOT_INDENT + 8);
    expect(railLeft(1)).toBe(ROOT_INDENT + FOLDED_STEP + 8);
  });
});

describe("title treatment", () => {
  it("steps children down and mutes them, except unread or open ones", () => {
    expect(titleTreatment(0, { unread: false, active: false })).toEqual({ small: false, muted: false });
    expect(titleTreatment(1, { unread: false, active: false })).toEqual({ small: true, muted: true });
    expect(titleTreatment(1, { unread: true, active: false })).toEqual({ small: true, muted: false });
    expect(titleTreatment(2, { unread: false, active: true })).toEqual({ small: true, muted: false });
  });
});

describe("child chip tone", () => {
  it("is amber for waits-on-you, red for failures, blue for working, neutral otherwise", () => {
    expect(chipTone("waits-on-you")).toBe("attention");
    expect(chipTone("unread-failed")).toBe("destructive");
    expect(chipTone("queue-failed")).toBe("destructive");
    expect(chipTone("working")).toBe("working");
    expect(chipTone("offline")).toBe("neutral");
    expect(chipTone("unread")).toBe("neutral");
    expect(chipTone(null)).toBe("neutral");
  });
});

describe("fold row text", () => {
  const fold = (scope: OlderRow["scope"], count: number, expanded = false): OlderRow => ({
    type: "older",
    key: "k",
    scopeId: "s",
    scope,
    count,
    expanded,
    depth: 1,
    rails: [],
  });
  it("says child threads on a family's fold, singular for one", () => {
    expect(olderRowText(fold("family", 16))).toEqual({ label: "16 more child threads", ariaLabel: "Show 16 more child threads" });
    expect(olderRowText(fold("family", 1)).label).toBe("1 more child thread");
    expect(olderRowText(fold("reveal", 4)).label).toBe("4 more child threads");
  });
  it("keeps 'older' for the group's fold, so the two never read alike", () => {
    expect(olderRowText(fold("group", 5)).label).toBe("5 older");
    expect(olderRowText(fold("group", 5, true)).label).toBe("Show fewer");
    expect(olderRowText(fold("family", 5, true)).label).toBe("Show fewer");
  });
});
