import { describe, expect, it } from "vitest";
import { attentionRootIds, failedUnread, finishedUnread, makeThread, rowIds, T0, viewOf, working } from "../testing/fixtures";
import { isOrphanedFailure, isParentIdle, attentionFlagsOf, revealsOn } from "./attention";
import type { Flag } from "./state";
import type { ThreadRow } from "./view";

const flags = (...list: Flag[]) => new Set<Flag>(list);
const idleParent = { thread: { latestAttentionAt: T0 }, state: { kind: "idle" as const } };

describe("orphaned failures", () => {
  const failed = { latestAttentionAt: T0 + 10, updatedAt: T0 + 10 };
  it("counts a failure whose parent is idle and has not run since", () => {
    expect(isOrphanedFailure(failed, flags("unread-failed"), idleParent)).toBe(true);
  });
  it("counts it when the parent last finished at the same moment", () => {
    const parent = { thread: { latestAttentionAt: T0 + 10 }, state: { kind: "idle" as const } };
    expect(isOrphanedFailure(failed, flags("unread-failed"), parent)).toBe(true);
  });
  it("does not count it while the parent is busy, in any of the busy states", () => {
    for (const kind of ["working", "background", "queued", "scheduled"] as const) {
      expect(isOrphanedFailure(failed, flags("unread-failed"), { ...idleParent, state: { kind } })).toBe(false);
    }
    for (const kind of ["idle", "unread", "draft", "waits-on-you", "failed", "offline"] as const) {
      expect(isParentIdle({ ...idleParent, state: { kind } })).toBe(true);
    }
  });
  it("does not count it when the parent finished after the child failed", () => {
    // Its last finish is the later of its own attention time and the server's finishedAt stamp.
    for (const later of [{ thread: { latestAttentionAt: T0 + 11 } }, { finishedAt: T0 + 11 }]) {
      const parent = { ...idleParent, ...later };
      expect(isOrphanedFailure(failed, flags("unread-failed"), parent)).toBe(false);
    }
  });
  it("is not cleared by opening or renaming the parent, which only move updatedAt", () => {
    const parent = { ...idleParent, thread: { latestAttentionAt: T0, updatedAt: T0 + 500 } };
    expect(isOrphanedFailure(failed, flags("unread-failed"), parent)).toBe(true);
  });
  it("dates a failed queue by updatedAt, and ignores a thread that did not fail", () => {
    const queue = { latestAttentionAt: T0, updatedAt: T0 + 20 };
    const parent = { thread: { latestAttentionAt: T0 + 15 }, state: { kind: "idle" as const } };
    expect(isOrphanedFailure(queue, flags("queue-failed"), parent)).toBe(true);
    expect(isOrphanedFailure(failed, flags("unread"), idleParent)).toBe(false);
  });
});

describe("what a thread contributes", () => {
  const every = flags("waits-on-you", "unread-failed", "queue-failed", "offline", "working", "unread");
  it("keeps a root's own flags, except working", () => {
    expect([...attentionFlagsOf(every, { isRoot: true, mode: "blocked", orphaned: false })].sort()).toEqual(
      ["offline", "queue-failed", "unread", "unread-failed", "waits-on-you"],
    );
  });
  it("counts a child that waits on you or is offline, never one that only finished", () => {
    expect([...attentionFlagsOf(every, { isRoot: false, mode: "blocked", orphaned: false })].sort()).toEqual(["offline", "waits-on-you"]);
    expect(attentionFlagsOf(flags("unread"), { isRoot: false, mode: "blocked", orphaned: false }).size).toBe(0);
  });
  it("adds a failed child only when it is orphaned", () => {
    const failedFlags = flags("unread-failed", "unread");
    expect(attentionFlagsOf(failedFlags, { isRoot: false, mode: "blocked", orphaned: false }).size).toBe(0);
    expect([...attentionFlagsOf(failedFlags, { isRoot: false, mode: "blocked", orphaned: true })]).toEqual(["unread-failed"]);
  });
  it("counts a child like a root when children count as everything", () => {
    expect(attentionFlagsOf(every, { isRoot: false, mode: "everything", orphaned: false }).has("unread")).toBe(true);
  });
  it("reveals on a question or a failure, and on a failed queue only for a child", () => {
    expect(revealsOn(flags("waits-on-you"), true)).toBe(true);
    expect(revealsOn(flags("unread-failed"), false)).toBe(true);
    expect(revealsOn(flags("queue-failed"), true)).toBe(false);
    expect(revealsOn(flags("queue-failed"), false)).toBe(true);
    expect(revealsOn(flags("offline", "unread"), false)).toBe(false);
  });
});

function group(view: ReturnType<typeof viewOf>, id: string) {
  const found = [...view.groups, ...view.more].find((candidate) => candidate.descriptor.id === id);
  if (found === undefined) throw new Error(`no group ${id}`);
  return found;
}

const threadRows = (view: ReturnType<typeof viewOf>, groupId = "project:proj_a"): ThreadRow[] =>
  group(view, groupId).rows.filter((row): row is ThreadRow => row.type === "thread");

const drawnIds = (view: ReturnType<typeof viewOf>) =>
  [...view.groups, ...view.more].flatMap((g) => g.rows).flatMap((row) => (row.type === "thread" ? [row.info.thread.id] : []));

describe("Needs attention is a state of a tree, drawn in its own group", () => {
  const parent = (overrides: Record<string, unknown> = {}) =>
    makeThread({ id: "m", latestAttentionAt: T0, lastReadAt: T0, ...overrides });

  it("keeps a tree that needs attention in its group, in the place its sort gives it", () => {
    const threads = [
      makeThread({ id: "new", latestAttentionAt: T0 + 20 }),
      makeThread({ id: "q", hasPendingInteraction: true, latestAttentionAt: T0 + 10 }),
      makeThread({ id: "old", latestAttentionAt: T0 }),
    ];
    const view = viewOf({ threads });
    expect(rowIds(view, "project:proj_a")).toEqual(["new", "q", "old"]);
    expect(viewOf({ threads, prefs: { sortDirection: "ascending" } }).groups[0]!.rows.map((row) => row.key)).toEqual([
      "thread:old",
      "thread:q",
      "thread:new",
    ]);
  });

  it("draws the tree in its own group only, in every Group by mode, Pinned and hidden groups included", () => {
    const threads = [
      makeThread({ id: "m", sectionId: "s1", host: { id: "h2", name: "Server" } }),
      makeThread({ id: "c", parentThreadId: "m", hasPendingInteraction: true }),
      makeThread({ id: "p", pinnedAt: T0, isPinned: true }),
      makeThread({ id: "pc", parentThreadId: "p", hasPendingInteraction: true }),
      makeThread({ id: "o", sectionId: "s1", host: { id: "h2", name: "Server" } }),
    ];
    const sections = [{ id: "s1", name: "Later", createdAt: T0, updatedAt: T0 }];
    const homes = { project: "project:proj_a", chronological: "section:s1", machine: "machine:h2" } as const;
    for (const organizationMode of ["project", "chronological", "machine"] as const) {
      for (const hiddenGroups of [[], [homes[organizationMode]]]) {
        const view = viewOf({ threads, sections, prefs: { organizationMode, hiddenGroups } });
        const ids = drawnIds(view);
        expect(ids.filter((id) => id === "m")).toHaveLength(1);
        expect(ids.filter((id) => id === "p")).toHaveLength(1);
        expect(rowIds(view, homes[organizationMode])).toContain("m");
        expect(rowIds(view, "pinned")).toEqual(["p"]);
      }
    }
  });

  it("draws, under a collapsed group's header, every tree in it that needs attention and nothing else", () => {
    const threads = [
      parent({ latestAttentionAt: T0 + 30, lastReadAt: T0 + 30 }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, hasPendingInteraction: true }),
      makeThread({ id: "quiet", latestAttentionAt: T0 + 20, lastReadAt: T0 + 20 }),
      makeThread({ id: "busy", latestAttentionAt: T0 + 10, lastReadAt: T0 + 10, ...working }),
      makeThread({ id: "failed", ...failedUnread }),
    ];
    const view = viewOf({ threads, prefs: { collapsedProjects: ["proj_a"] } });
    expect(group(view, "project:proj_a").collapsed).toBe(true);
    // The path to the child that asks is revealed, as it is in an open group.
    const revealed = viewOf({ threads, prefs: { collapsedProjects: ["proj_a"] }, targets: new Map([["c", "reveal" as const]]) });
    expect(rowIds(view, "project:proj_a")).toEqual(["m", "failed"]);
    expect(rowIds(revealed, "project:proj_a")).toEqual(["m", "c", "failed"]);
    expect(rowIds(viewOf({ threads: [makeThread({ id: "quiet" })], prefs: { collapsedProjects: ["proj_a"] } }), "project:proj_a")).toEqual([]);
  });

  it("opens a collapsed group when a thread in it is opened, and not for a thread that needs attention", () => {
    const threads = [makeThread({ id: "a", latestAttentionAt: T0 + 1, lastReadAt: T0 + 1 }), makeThread({ id: "b", latestAttentionAt: T0 })];
    const prefs = { collapsedProjects: ["proj_a"] };
    expect(rowIds(viewOf({ threads, prefs, activeThreadId: "b", targets: new Map([["b", "reveal" as const]]) }), "project:proj_a")).toEqual(["a", "b"]);
    const asks = [...threads, makeThread({ id: "q", hasPendingInteraction: true })];
    expect(rowIds(viewOf({ threads: asks, prefs, targets: new Map([["q", "reveal" as const]]) }), "project:proj_a")).toEqual(["q"]);
  });

  it("counts a thread that needs attention in its own group's header, collapsed or not", () => {
    const threads = [makeThread({ id: "a", hasPendingInteraction: true }), makeThread({ id: "b", projectId: "proj_b", ...failedUnread })];
    for (const collapsedProjects of [[], ["proj_a", "proj_b"]]) {
      const view = viewOf({ threads, prefs: { collapsedProjects } });
      expect(group(view, "project:proj_a").counters).toMatchObject({ waitsOnYou: 1, failed: 0 });
      expect(group(view, "project:proj_b").counters).toMatchObject({ waitsOnYou: 0, failed: 1 });
    }
  });

  it("never draws a home-group label or a Finished line", () => {
    const threads = [makeThread({ id: "u", latestAttentionAt: T0 + 30, lastReadAt: T0 }), makeThread({ id: "d", parentThreadId: "u", createdAt: T0 + 1 })];
    const notes = { u: { done: { kind: "done" as const, text: "All done", at: T0 + 30 } } };
    const rows = threadRows(viewOf({ threads, notes, prefs: { expandedChildren: ["u"] } }));
    for (const row of rows) {
      expect(row).not.toHaveProperty("homeGroupLabel");
      expect(row.note).toBeNull();
    }
  });

  it("does not count a tree whose only news is a finished grandchild, and shows no counter for it", () => {
    const threads = [
      parent(),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2 }),
    ];
    const finishedAt = { g: T0 + 30 };
    const view = viewOf({ threads, finishedAt, prefs: { expandedChildren: ["m", "c"] } });
    expect(attentionRootIds({ threads, finishedAt })).toEqual([]);
    expect(group(view, "project:proj_a").counters).toMatchObject({ unread: 0, waitsOnYou: 0 });
    // The unread dot stays on its own row, inside the open tree.
    expect(threadRows(view).find((row) => row.info.thread.id === "g")?.info.state.kind).toBe("unread");
  });

  it("counts a child that failed while its parent is idle, not while it works or after it finished", () => {
    const failedChild = makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...failedUnread });
    const counters = (m: ReturnType<typeof makeThread>, extra: Parameters<typeof viewOf>[0]["prefs"] = {}) =>
      group(viewOf({ threads: [m, failedChild], prefs: extra }), "project:proj_a").counters.failed;
    expect(counters(parent({ lastReadAt: T0 + 50, latestAttentionAt: T0 + 5 }))).toBe(1);
    expect(counters(parent({ ...working }))).toBe(0);
    expect(counters(parent({ lastReadAt: T0 + 50, latestAttentionAt: T0 + 40 }))).toBe(0);
    expect(counters(parent({ ...working }), { childAttention: "everything" })).toBe(1);
    // A parent that is a child finishes without moving latestAttentionAt; the server's stamp says so.
    const stamped = viewOf({
      threads: [parent({ lastReadAt: T0 + 50, latestAttentionAt: T0 + 5 }), failedChild],
      finishedAt: { m: T0 + 40 },
    });
    expect(group(stamped, "project:proj_a").counters.failed).toBe(0);
  });

  it("needs attention for a child that waits or failed orphaned, whatever the child dot says", () => {
    const view = (children: ReturnType<typeof makeThread>[], m = parent({ lastReadAt: T0 + 50 })) => viewOf({ threads: [m, ...children] });
    const dot = (children: ReturnType<typeof makeThread>[], m?: ReturnType<typeof makeThread>) =>
      threadRows(view(children, m)).find((r) => r.info.thread.id === "m")!.childDot;
    const child = (overrides: object) => makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...overrides });
    const m = parent({ lastReadAt: T0 + 50 });
    expect(attentionRootIds({ threads: [m, child({ hasPendingInteraction: true })] })).toEqual(["m"]);
    expect(attentionRootIds({ threads: [m, child({ ...failedUnread })] })).toEqual(["m"]);
    // A failure the busy parent may still deal with needs no attention, and still shows on the dot.
    expect(attentionRootIds({ threads: [parent({ ...working }), child({ ...failedUnread })] })).toEqual([]);
    expect(dot([child({ ...failedUnread })], parent({ ...working }))).toBe("unread-failed");
    expect(dot([child({ ...working })])).toBe("working");
    expect(dot([child({ ...finishedUnread })])).toBe("unread");
  });

  it("puts the chip and the child dot on a child that has children", () => {
    const threads = [
      parent({ lastReadAt: T0 + 50 }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2, ...working }),
    ];
    const rows = threadRows(viewOf({ threads, prefs: { expandedChildren: ["m"] } }));
    const child = rows.find((row) => row.info.thread.id === "c")!;
    expect(child.chip).toEqual({ count: 1, expanded: false });
    expect(child.childDot).toBe("working");
    // Its children wait for its chip, or for an auto-reveal.
    expect(rows.map((row) => row.info.thread.id)).toEqual(["m", "c"]);
    const revealed = viewOf({ threads, prefs: { expandedChildren: ["m"] }, targets: new Map([["g", "reveal" as const]]) });
    expect(threadRows(revealed).map((row) => row.info.thread.id)).toEqual(["m", "c", "g"]);
  });
});

describe("Needs attention counts every child", () => {
  // The parent is read, as if you watched it: a root that finishes unread needs attention on its own.
  const failedAt = T0 + 10;
  const child = makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, status: "error", latestAttentionAt: failedAt, lastReadAt: T0 });
  const parent = (overrides: Record<string, unknown>) => makeThread({ id: "m", lastReadAt: T0 + 100, ...overrides });
  const ids = (m: ReturnType<typeof makeThread>, childAttention: "blocked" | "everything" = "blocked", extra = {}) =>
    attentionRootIds({ threads: [m, child], prefs: { childAttention }, ...extra });

  it("off: a child that fails while its parent runs stays out, before and after the parent finishes", () => {
    expect(ids(parent({ ...working, latestAttentionAt: T0 }))).toEqual([]);
    expect(ids(parent({ latestAttentionAt: T0 + 20 }))).toEqual([]);
    // A parent that is itself a child finishes without moving latestAttentionAt: the server's stamp says so.
    expect(ids(parent({ latestAttentionAt: T0 }), "blocked", { finishedAt: { m: T0 + 20 } })).toEqual([]);
  });

  it("off: a child that fails while its parent is idle is in, and leaves once the parent runs a turn", () => {
    expect(ids(parent({ latestAttentionAt: T0 }))).toEqual(["m"]);
    expect(ids(parent({ ...working, latestAttentionAt: T0 }))).toEqual([]);
    expect(ids(parent({ latestAttentionAt: T0 + 20 }))).toEqual([]);
  });

  it("off: the tree stays while another of its threads needs attention", () => {
    const asks = makeThread({ id: "d", parentThreadId: "m", createdAt: T0 + 2, hasPendingInteraction: true });
    expect(attentionRootIds({ threads: [parent({ ...working, latestAttentionAt: T0 }), child, asks] })).toEqual(["m"]);
  });

  it("on: a child that failed while its parent runs brings its tree in", () => {
    expect(ids(parent({ ...working, latestAttentionAt: T0 }), "everything")).toEqual(["m"]);
  });

  it("a finished, unread child: out with the setting off, in with it on", () => {
    const threads = [parent({ latestAttentionAt: T0 }), makeThread({ id: "d", parentThreadId: "m", createdAt: T0 + 2 })];
    const finishedAt = { d: T0 + 30 };
    expect(attentionRootIds({ threads, finishedAt })).toEqual([]);
    expect(attentionRootIds({ threads, finishedAt, prefs: { childAttention: "everything" } })).toEqual(["m"]);
  });
});
