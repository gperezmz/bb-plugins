import { describe, expect, it } from "vitest";
import { mapBbPreferences, coercePreferences, defaultPreferences, parsePreference, parseStoredPreference } from "@/shared/preferences";
import { defaultSourceHostId, isOffDefaultBranch } from "./branches";
import { resolveDrop, targetAt, type DraggedThread } from "./drag";
import { layoutItems } from "./layout-items";
import { moveGroup, resolveGroupOrder } from "./groups";
import { assignProviderMarks, providerMark } from "./provider-mark";
import { olderRowText, settledRowText } from "./labels";
import { FOLDED_STEP, ROOT_INDENT, rowIndent } from "./layout";
import { chipTone } from "./state";
import { formatDuration, TRAILING_SLOT_SIZERS, trailingTime } from "./time";
import type { GroupView, OlderRow, Row } from "./view";
import { keptIndexes, mountedByGroup, mountedIndexes, rangeKey, windowedNavValue } from "./windowing";

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
  it("sizes the trailing slot for every time text up to 99 weeks: each has a sizer of its unit and at least its length", () => {
    const texts = new Set<string>(["<1m"]);
    for (let minutes = 0; minutes < 100 * 7 * 24 * 60; minutes += 1) texts.add(formatDuration(minutes * 60e3));
    const unitOf = (text: string) => text.replace(/\d/g, "");
    for (const text of texts) {
      const sizer = TRAILING_SLOT_SIZERS.find((candidate) => unitOf(candidate) === unitOf(text));
      expect(sizer, text).toBeDefined();
      expect(sizer!.length, text).toBeGreaterThanOrEqual(text.length);
    }
    expect(formatDuration(100 * 7 * 86400e3)).toBe("100w");
  });

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
});

describe("default branch", () => {
  it("asks the default source's machine, else the first source's, else none", () => {
    expect(defaultSourceHostId([{ hostId: "a", isDefault: false }, { hostId: "b", isDefault: true }])).toBe("b");
    expect(defaultSourceHostId([{ hostId: "a", isDefault: false }])).toBe("a");
    expect(defaultSourceHostId([])).toBeNull();
  });
  it("knows a branch differs only once the default branch is known", () => {
    expect(isOffDefaultBranch("feature", "main")).toBe(true);
    expect(isOffDefaultBranch("main", "main")).toBe(false);
    expect(isOffDefaultBranch("feature", undefined)).toBe(false);
    expect(isOffDefaultBranch("feature", null)).toBe(false);
    expect(isOffDefaultBranch(null, "main")).toBe(false);
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
      environmentGrouping: false,
      settleAfter: "1d",
      harnessIcon: "muted",
      openSettledFolds: [],
    });
  });
  it("a bad mirror value falls back per key", () => {
    expect(coercePreferences({ organizationMode: "machine", settleAfter: "2d" })).toMatchObject({ organizationMode: "machine", settleAfter: "1d" });
  });
  it("drops removed settings, and a saved foldOlder leaves Settle after at its default", () => {
    const prefs = coercePreferences({ nesting: "tree", collapsedChildren: ["p"], foldOlder: false, workingFirst: true, showPullRequests: false });
    for (const key of ["nesting", "collapsedChildren", "foldOlder", "workingFirst", "showPullRequests"]) {
      expect(prefs).not.toHaveProperty(key);
    }
    expect(prefs.settleAfter).toBe("1d");
  });
  it("reads a stored Hidden harness icon as Muted, and refuses to save it", () => {
    expect(coercePreferences({ harnessIcon: "hidden" }).harnessIcon).toBe("muted");
    expect(parseStoredPreference("harnessIcon", "hidden")).toEqual({ success: true, value: "muted" });
    expect(parsePreference("harnessIcon", "hidden").success).toBe(false);
  });
  it("does not import a removed setting from bb", () => {
    expect(mapBbPreferences({ workingFirst: true, foldOlder: false, showPullRequests: false, threadLifecycles: ["active", "archived"], organizationMode: "machine" })).toEqual({
      organizationMode: "machine",
    });
  });
});

describe("row indent", () => {
  it("steps each level by 12px", () => {
    expect(rowIndent(0)).toBe(ROOT_INDENT);
    expect(rowIndent(1)).toBe(ROOT_INDENT + FOLDED_STEP);
    expect(rowIndent(3)).toBe(8 + 12 * 3);
  });
});

describe("children chip tone", () => {
  it("takes each state glyph's tone, and the accent for unread", () => {
    expect(chipTone("waits-on-you")).toBe("attention");
    expect(chipTone("unread-failed")).toBe("destructive");
    expect(chipTone("queue-failed")).toBe("destructive");
    expect(chipTone("offline")).toBe("attention");
    expect(chipTone("working")).toBe("working");
    expect(chipTone("unread")).toBe("working");
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
  });
  it("says child threads on a tree's fold, singular for one", () => {
    expect(olderRowText(fold("tree", 16))).toEqual({ label: "16 more child threads", ariaLabel: "Show 16 more child threads" });
    expect(olderRowText(fold("tree", 1)).label).toBe("1 more child thread");
    expect(olderRowText(fold("reveal", 4)).label).toBe("4 more child threads");
  });
  it("says Show fewer on an open tree's fold", () => {
    expect(olderRowText(fold("tree", 5, true)).label).toBe("Show fewer");
  });
  it("reads Settled (N) on a closed settled fold and Settled on an open one, N counting trees", () => {
    const settled = (count: number, expanded: boolean) => ({ type: "settled" as const, key: "k", groupId: "g", count, expanded });
    expect(settledRowText(settled(3, false))).toEqual({ label: "Settled (3)", ariaLabel: "Show 3 settled thread trees" });
    expect(settledRowText(settled(1, true))).toEqual({ label: "Settled", ariaLabel: "Hide 1 settled thread tree" });
  });
});

describe("drop target from positions", () => {
  const thread = (id: string, extra: object = {}): Row =>
    ({ type: "thread", key: `thread:${id}`, info: { thread: { id } }, note: null, branchLine: null, ...extra }) as unknown as Row;
  const group = (id: string, rows: Row[], extra: Partial<GroupView> = {}): GroupView =>
    ({ descriptor: { id }, rows, collapsed: false, rootIds: rows.length > 0 ? ["x"] : [], ...extra }) as unknown as GroupView;
  // Compact, desktop: headers 28 px, one-line rows 28, two-line 44, a 4 px gap above every header but the first.
  const layout = layoutItems(
    [
      group("pinned", [thread("p1"), thread("p2")]),
      group("project:a", [thread("a1", { branchLine: "fix/x" }), { type: "settled", key: "settled:project:a" } as unknown as Row]),
      group("project:b", []),
    ],
    { density: "compact", phone: false },
  );

  it("lays every item out from the heights model, with the gap above every header but the first", () => {
    expect(layout.items.map((item) => [item.key, item.start, item.size])).toEqual([
      ["pinned/header", 0, 28],
      ["pinned/thread:p1", 28, 28],
      ["pinned/thread:p2", 56, 28],
      ["project:a/header", 84, 32],
      ["project:a/thread:a1", 116, 44],
      ["project:a/settled:project:a", 160, 24],
      ["project:b/header", 184, 32],
      ["project:b/empty", 216, 24],
    ]);
    expect(layout.total).toBe(240);
  });

  it("splits a thread row into its top quarter, middle half and bottom quarter, in and out of Pinned", () => {
    const zone = (y: number) => targetAt(layout, y, "thread").target;
    expect(zone(28 + 6)).toEqual({ kind: "thread", threadId: "p1", zone: "before", inPinned: true });
    expect(zone(28 + 14)).toEqual({ kind: "thread", threadId: "p1", zone: "middle", inPinned: true });
    expect(zone(28 + 22)).toEqual({ kind: "thread", threadId: "p1", zone: "after", inPinned: true });
    expect(zone(116 + 10)).toEqual({ kind: "thread", threadId: "a1", zone: "before", inPinned: false });
    expect(zone(116 + 22)).toEqual({ kind: "thread", threadId: "a1", zone: "middle", inPinned: false });
    expect(zone(116 + 40)).toEqual({ kind: "thread", threadId: "a1", zone: "after", inPinned: false });
  });

  it("targets the group around a header, a fold or No threads, and nothing in a gap or past the list", () => {
    expect(targetAt(layout, 90, "thread").target).toEqual({ kind: "group", groupId: "project:a" });
    expect(targetAt(layout, 170, "thread").target).toEqual({ kind: "group", groupId: "project:a" });
    expect(targetAt(layout, 220, "thread").target).toEqual({ kind: "group", groupId: "project:b" });
    expect(targetAt(layout, 85, "thread").target).toBeNull();
    expect(targetAt(layout, 240, "thread").target).toBeNull();
    expect(targetAt(layout, -1, "thread").target).toBeNull();
  });

  it("gives a dragged group header whole groups, and the half of the group under the pointer", () => {
    expect(targetAt(layout, 40, "group")).toEqual({ target: { kind: "group", groupId: "pinned" }, placement: "before" });
    expect(targetAt(layout, 150, "group")).toEqual({ target: { kind: "group", groupId: "project:a" }, placement: "after" });
  });
});

describe("the rows the window mounts", () => {
  const row = (id: string): Row => ({ type: "thread", key: `thread:${id}`, info: { thread: { id } }, note: null, branchLine: null }) as unknown as Row;
  const group = (id: string, rows: Row[]): GroupView => ({ descriptor: { id }, rows, collapsed: false, rootIds: ["x"] }) as unknown as GroupView;
  // Compact desktop rows are 28 px under a 28 px header: row n starts at 28 + 28n.
  const layout = layoutItems([group("threads", Array.from({ length: 60 }, (_, n) => row(`t${n}`)))], { density: "compact", phone: false });
  const keys = (indexes: readonly number[]) => indexes.map((index) => layout.items[index]!.key.replace("threads/", ""));

  it("mounts every item within the margin of the view, and nothing for an unknown view but the kept rows", () => {
    // The view is 868–1148 px; with the 240 px margin, 628–1388: rows t21 (616–644) to t48 (1372–1400).
    const mounted = keys(mountedIndexes(layout, { top: 868, height: 280 }, []));
    expect(mounted[0]).toBe("thread:t21");
    expect(mounted.at(-1)).toBe("thread:t48");
    expect(mounted).toHaveLength(28);
    expect(mountedIndexes(layout, null, [5, 2])).toEqual([2, 5]);
  });

  it("keeps the first nine thread rows for bb's jump keys in the main list, and the kept threads and rows wherever they are", () => {
    const kept = keptIndexes(layout, { threadIds: ["t40"], itemKeys: ["threads/thread:t50"] }, true);
    expect(keys([...kept].sort((a, b) => a - b))).toEqual([...Array.from({ length: 9 }, (_, n) => `thread:t${n}`), "thread:t40", "thread:t50"]);
    expect(keptIndexes(layout, { threadIds: [], itemKeys: [] }, false)).toEqual([]);
  });

  it("keeps each group's mounted set while it holds, and changes its range key only when the range does", () => {
    const first = mountedByGroup(layout, [1, 2, 3], new Map());
    expect(mountedByGroup(layout, [1, 2, 3], first).get("threads")).toBe(first.get("threads"));
    expect(mountedByGroup(layout, [1, 2, 4], first).get("threads")).not.toBe(first.get("threads"));
    expect(rangeKey(layout, { top: 1000, height: 100 })).toBe(rangeKey(layout, { top: 1001, height: 100 }));
    expect(rangeKey(layout, { top: 1000, height: 100 })).not.toBe(rangeKey(layout, { top: 1040, height: 100 }));
  });
});
