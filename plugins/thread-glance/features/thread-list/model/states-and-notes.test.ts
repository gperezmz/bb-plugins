import { describe, expect, it } from "vitest";
import { failedUnread, finishedUnread, forestOf, makeThread, attentionIds, rowIds, T0, viewOf, working } from "../testing/fixtures";
import { visibleCounters } from "./counters";
import { modelDisplayName, sinceLabel } from "./details";
import { rowMenuItems } from "./menu";
import { moveTargets } from "./move";
import { attentionNote, noteText, rowNote } from "./notes";
import { computeState } from "./state";
import { finishedAtFor, trailingTime } from "./time";
import type { Row, ThreadRow } from "./view";
import type { Flag } from "./state";

const note = (kind: "question" | "approval" | "plan" | "input" | "failed" | "done", text: string) => ({ kind, text, at: T0 });

describe("working is visible, background stays faint", () => {
  it("draws working in the working tone and background in its own", () => {
    const base = { unread: false, hasDraft: false, scheduledAt: null, now: T0 };
    expect(computeState(makeThread({ id: "w", ...working }), base).glyph.tone).toBe("working");
    expect(computeState(makeThread({ id: "b", activity: { workflows: 1 } }), base).glyph.tone).toBe("background");
  });
});

describe("what a thread waits on you for", () => {
  const base = { unread: false, hasDraft: false, scheduledAt: null, now: T0 };
  it.each([
    ["question", "CircleQuestion", "Asks a question"],
    ["approval", "SecurityCheck", "Needs approval"],
    ["plan", "ListTodo", "Plan to review"],
    ["input", "MessageQuestion", "Needs your input"],
  ] as const)("%s draws %s in the attention tone", (needsKind, icon, label) => {
    const state = computeState(makeThread({ id: "q", hasPendingInteraction: true }), { ...base, needsKind });
    expect(state).toMatchObject({ kind: "waits-on-you", label, glyph: { icon, tone: "attention" } });
  });
  it("without a note it keeps the question glyph", () => {
    const state = computeState(makeThread({ id: "q", hasPendingInteraction: true }), base);
    expect(state.glyph.icon).toBe("CircleQuestion");
  });
});

describe("row notes", () => {
  it("say why a thread waits on you or failed, and nothing otherwise", () => {
    expect(rowNote(makeThread({ id: "a", hasPendingInteraction: true }), { pending: note("question", "Tabs or spaces?") })).toEqual({
      prefix: "Asks",
      text: "Tabs or spaces?",
      tone: "attention",
    });
    expect(rowNote(makeThread({ id: "b", hasPendingInteraction: true }), { pending: note("approval", "rm -rf build/") })?.prefix).toBe("Approve");
    expect(rowNote(makeThread({ id: "c", status: "error" }), { failed: note("failed", "429 quota exceeded") })).toMatchObject({
      prefix: "Failed",
      tone: "destructive",
    });
    expect(rowNote(makeThread({ id: "d" }), { done: note("done", "Updated 3 files") })).toBeNull();
    expect(rowNote(makeThread({ id: "c", status: "error" }), { failed: note("failed", "Failed") })).toBeNull();
    // A stale pending note doesn't outlive the interaction.
    expect(rowNote(makeThread({ id: "e" }), { pending: note("question", "old") })).toBeNull();
  });
  it("reach the forest, so rows and the state glyph use them", () => {
    const forest = forestOf({
      threads: [makeThread({ id: "a", hasPendingInteraction: true })],
      notes: { a: { pending: note("plan", "Refactor the store") } },
    });
    const info = forest.infos.get("a")!;
    expect(info.note?.prefix).toBe("Plan");
    expect(info.state.glyph.icon).toBe("ListTodo");
  });
});

describe("why a row in Needs attention is there", () => {
  const flags = (...list: Flag[]) => new Set<Flag>(list);
  const line = (thread: Parameters<typeof attentionNote>[0], notes: Parameters<typeof attentionNote>[1], attention: Set<Flag>) => {
    const found = attentionNote(thread, notes, attention);
    return found === null ? null : { line: noteText(found), tone: found.tone };
  };

  it("names each reason with its prefix and its glyph's tone", () => {
    const pending = makeThread({ id: "a", hasPendingInteraction: true });
    expect(line(pending, { pending: note("question", "Tabs or spaces?") }, flags("waits-on-you"))).toEqual({ line: "Asks: Tabs or spaces?", tone: "attention" });
    expect(line(pending, undefined, flags("waits-on-you"))).toEqual({ line: "Needs", tone: "attention" });
    const failed = makeThread({ id: "b", status: "error" });
    expect(line(failed, { failed: note("failed", "429 quota exceeded") }, flags("unread-failed"))).toEqual({ line: "Failed: 429 quota exceeded", tone: "destructive" });
    expect(line(failed, undefined, flags("unread-failed"))).toEqual({ line: "Failed", tone: "destructive" });
    expect(line(failed, { failed: note("failed", "Failed") }, flags("unread-failed"))?.line).toBe("Failed");
    expect(line(makeThread({ id: "q", queuedWork: "failed" }), undefined, flags("queue-failed"))?.line).toBe("Failed: queued message wasn't sent");
    const offline = makeThread({ id: "c", runtimeStatus: "waiting-for-host", host: { id: "h", name: "Build box" } });
    expect(line(offline, undefined, flags("offline"))).toEqual({ line: "Offline: Build box", tone: "attention" });
    expect(line(makeThread({ id: "c", runtimeStatus: "waiting-for-host", host: null }), undefined, flags("offline"))?.line).toBe("Offline");
    const done = makeThread({ id: "d", ...finishedUnread });
    expect(line(done, { done: note("done", "Updated 3 files") }, flags("unread"))).toEqual({ line: "Finished: Updated 3 files", tone: "muted" });
    expect(line(done, undefined, flags("unread"))).toEqual({ line: "Finished", tone: "muted" });
  });

  it("shows the most urgent of several: waits on you, failed, offline, finished", () => {
    const thread = makeThread({ id: "a", hasPendingInteraction: true, status: "error", runtimeStatus: "waiting-for-host" });
    expect(line(thread, undefined, flags("unread", "offline", "unread-failed", "waits-on-you"))?.line).toBe("Needs");
    expect(line(thread, undefined, flags("unread", "offline", "unread-failed"))?.line).toBe("Failed");
    expect(line(thread, undefined, flags("unread", "offline"))?.line).toBe("Offline: Laptop");
    expect(line(thread, undefined, flags("working"))).toBeNull();
  });

  it("goes under rows in Needs attention that need attention, and 0.2.1's line everywhere else", () => {
    const threads = [
      makeThread({ id: "p", ...finishedUnread }),
      makeThread({ id: "c", parentThreadId: "p", createdAt: T0 + 1, runtimeStatus: "waiting-for-host", host: { id: "h2", name: "Build box" } }),
      makeThread({ id: "u", parentThreadId: "p", createdAt: T0 + 2, ...finishedUnread }),
      makeThread({ id: "lone", ...finishedUnread, projectId: "proj_b" }),
    ];
    const notes = { p: { done: note("done", "Shipped it") }, u: { done: note("done", "All green") } };
    const view = viewOf({ threads, notes, prefs: { expandedChildren: ["p"] } });
    const lines = (rows: readonly Row[]) =>
      rows.flatMap((row): [string, string | null][] => (row.type === "thread" ? [[row.info.thread.id, row.note === null ? null : noteText(row.note)]] : []));
    const inSection = new Map(lines(view.attention!.rows));
    expect(inSection.get("lone")).toBe("Finished");
    expect(inSection.get("p")).toBe("Finished: Shipped it");
    expect(inSection.get("c")).toBe("Offline: Build box");
    // Opened with the chip, the unread child does not need attention with the setting off: 0.2.1's rule, no line.
    expect(inSection.has("u")).toBe(true);
    expect(inSection.get("u")).toBeNull();
    // Outside the section, a finished or offline thread has no line.
    const outside = viewOf({ threads, notes, activeThreadId: "p", heldRootId: null, prefs: { expandedChildren: ["p"] } });
    expect(outside.groups.flatMap((group) => lines(group.rows)).filter(([, text]) => text !== null)).toEqual([]);
  });
});

describe("timer vs age", () => {
  const thread = { id: "t", latestAttentionAt: T0, createdAt: T0 };
  it("a timer says <1m, never now, and is marked as a timer", () => {
    expect(trailingTime(thread, true, { startedAt: { t: T0 }, finishedAt: {} }, T0 + 5_000)).toMatchObject({
      text: "<1m",
      kind: "timer",
    });
    expect(trailingTime(thread, false, { startedAt: {}, finishedAt: {} }, T0 + 5_000)?.kind).toBe("age");
  });
  it("a thread waiting on you shows how long it has waited, not a working timer", () => {
    const stamps = { startedAt: { t: T0 }, finishedAt: {} };
    expect(trailingTime(thread, true, stamps, T0 + 20 * 60_000, T0 + 18 * 60_000)).toEqual({
      text: "2m",
      label: "Waiting on you for 2m",
      kind: "waiting",
    });
    expect(trailingTime(thread, true, stamps, T0 + 60_000, null)).toBeNull();
  });
});

describe("hover card facts", () => {
  it("Finished only for threads that finished", () => {
    expect(finishedAtFor(makeThread({ id: "w", ...working }), {})).toBeNull();
    expect(finishedAtFor(makeThread({ id: "q", hasPendingInteraction: true, latestAttentionAt: T0 + 9 }), {})).toBeNull();
    expect(finishedAtFor(makeThread({ id: "c", parentThreadId: "p" }), {})).toBeNull();
    expect(finishedAtFor(makeThread({ id: "c", parentThreadId: "p" }), { c: T0 + 5 })).toBe(T0 + 5);
    expect(finishedAtFor(makeThread({ id: "r", ...finishedUnread }), {})).toBe(T0 + 10);
  });
  it("names the time for each state", () => {
    expect(sinceLabel("working", "4m")).toBe("started 4m ago");
    expect(sinceLabel("waits-on-you", "now")).toBe("waiting since just now");
    expect(sinceLabel("idle", "2h")).toBe("finished 2h ago");
    expect(sinceLabel("idle", null)).toBeNull();
  });
  it("shows the model's display name", () => {
    const catalog = [{ id: "haiku", model: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" }];
    expect(modelDisplayName("claude-haiku-4-5-20251001", catalog)).toBe("Haiku 4.5");
    expect(modelDisplayName("unknown-model", catalog)).toBe("unknown-model");
  });
});

describe("Needs attention order", () => {
  it("puts what waits on you first, then failed, then unread, whatever the recency", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "u", ...finishedUnread, latestAttentionAt: T0 + 300 }),
        makeThread({ id: "f", ...failedUnread, latestAttentionAt: T0 + 200 }),
        makeThread({ id: "q", hasPendingInteraction: true, latestAttentionAt: T0 + 1 }),
      ],
    });
    expect(attentionIds(view)).toEqual(["q", "f", "u"]);
  });
});

describe("chip harnesses", () => {
  it("lists child harnesses that differ from the parent's", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "p" }),
        makeThread({ id: "a", parentThreadId: "p", providerId: "codex" }),
        makeThread({ id: "b", parentThreadId: "p", providerId: "pi" }),
        makeThread({ id: "c", parentThreadId: "p" }),
        makeThread({ id: "d", parentThreadId: "p", providerId: "codex" }),
      ],
    });
    const root = view.groups[0]!.rows[0] as ThreadRow;
    expect(root.chip?.providerIds).toEqual(["codex", "pi"]);
  });
});

describe("header counters", () => {
  const counters = { waitsOnYou: 1, failed: 2, offline: 0, working: 3, unread: 9 };
  it("keep what needs action; working only when collapsed; unread only on More", () => {
    expect(visibleCounters(counters, { collapsed: false, more: false })).toEqual({ ...counters, working: 0, unread: 0 });
    expect(visibleCounters(counters, { collapsed: true, more: false })).toEqual({ ...counters, unread: 0 });
    expect(visibleCounters(counters, { collapsed: false, more: true })).toEqual(counters);
  });
});

describe("Move… (keyboard route to drag)", () => {
  const forest = forestOf({
    threads: [
      makeThread({ id: "p", title: "Parent", latestAttentionAt: T0 + 3 }),
      makeThread({ id: "c", title: "Child", parentThreadId: "p" }),
      makeThread({ id: "g", title: "Grandchild", parentThreadId: "c" }),
      makeThread({ id: "o", title: "Other", latestAttentionAt: T0 + 5 }),
      makeThread({ id: "h", title: "Hidden", isHidden: true }),
    ],
  });
  it("offers the top level and every thread outside the subtree, not the current parent", () => {
    expect(moveTargets("c", forest).map((target) => target.parentThreadId)).toEqual([null, "o"]);
    expect(moveTargets("p", forest).map((target) => target.parentThreadId)).toEqual(["o"]);
  });
  it("filters by title", () => {
    expect(moveTargets("o", forest, "grand").map((target) => target.label)).toEqual(["Grandchild"]);
  });
  it("is in the row menu, with Details, on every viewport", () => {
    const actions = rowMenuItems({
      thread: makeThread({ id: "t" }),
      unread: false,
      splitAvailable: false,
      isRoot: true,
      hasSections: false,
      compact: false,
    }).map((item) => item.action);
    expect(actions).toContain("move");
    expect(actions).toContain("details");
  });
});
