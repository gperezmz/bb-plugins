import { describe, expect, it } from "vitest";
import { failedUnread, finishedUnread, makeThread, rowIds, T0, viewOf, working } from "../testing/fixtures";
import { needsYouFlagsOf, isParentIdle, isOrphanedFailure, revealsOn } from "./needs-you";
import { chipTone, type Flag } from "./state";
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
    expect([...needsYouFlagsOf(every, { isRoot: true, mode: "blocked", orphaned: false })].sort()).toEqual(
      ["offline", "queue-failed", "unread", "unread-failed", "waits-on-you"],
    );
  });
  it("counts a child that waits on you or is offline, never one that only finished", () => {
    expect([...needsYouFlagsOf(every, { isRoot: false, mode: "blocked", orphaned: false })].sort()).toEqual(["offline", "waits-on-you"]);
    expect(needsYouFlagsOf(flags("unread"), { isRoot: false, mode: "blocked", orphaned: false }).size).toBe(0);
  });
  it("adds a failed child only when it is orphaned", () => {
    const failedFlags = flags("unread-failed", "unread");
    expect(needsYouFlagsOf(failedFlags, { isRoot: false, mode: "blocked", orphaned: false }).size).toBe(0);
    expect([...needsYouFlagsOf(failedFlags, { isRoot: false, mode: "blocked", orphaned: true })]).toEqual(["unread-failed"]);
  });
  it("counts a child like a root when children count as everything", () => {
    expect(needsYouFlagsOf(every, { isRoot: false, mode: "everything", orphaned: false }).has("unread")).toBe(true);
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

describe("Needs attention over a family", () => {
  const parent = (overrides: Record<string, unknown> = {}) =>
    makeThread({ id: "m", latestAttentionAt: T0, lastReadAt: T0, ...overrides });

  it("keeps a family whose grandchild asks a question, with every ancestor", () => {
    const threads = [
      parent(),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2, hasPendingInteraction: true }),
    ];
    const view = viewOf({ threads, filter: "attention" });
    expect(rowIds(view, "project:proj_a")).toEqual(["m", "c", "g"]);
    expect(view.attentionCount).toBe(1);
    expect(group(viewOf({ threads }), "project:proj_a").counters.waitsOnYou).toBe(1);
  });

  it("drops a family whose only news is a finished grandchild, and shows no counter or chip flag for it", () => {
    const threads = [
      parent(),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2 }),
    ];
    const finishedAt = { g: T0 + 30 };
    expect(viewOf({ threads, filter: "attention", finishedAt }).groups).toEqual([]);
    const view = viewOf({ threads, finishedAt, prefs: { expandedChildren: ["m", "c"] } });
    expect(view.attentionCount).toBe(0);
    expect(group(view, "project:proj_a").counters).toMatchObject({ unread: 0, waitsOnYou: 0 });
    const rows = threadRows(view);
    expect(rows.find((row) => row.info.thread.id === "m")?.chip?.flag).toBeNull();
    // The unread dot stays on its own row, inside the open family.
    expect(rows.find((row) => row.info.thread.id === "g")?.info.state.kind).toBe("unread");
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

  it("tints the chip only for what waits on you, an orphaned failure or work", () => {
    const tone = (children: ReturnType<typeof makeThread>[], m = parent({ lastReadAt: T0 + 50 })) => {
      const row = threadRows(viewOf({ threads: [m, ...children] })).find((r) => r.info.thread.id === "m")!;
      return chipTone(row.chip?.flag ?? null);
    };
    const child = (overrides: object) => makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...overrides });
    expect(tone([child({ hasPendingInteraction: true })])).toBe("attention");
    expect(tone([child({ ...failedUnread })])).toBe("destructive");
    expect(tone([child({ ...failedUnread })], parent({ ...working }))).toBe("neutral");
    expect(tone([child({ ...working })])).toBe("working");
    expect(tone([child({ ...finishedUnread })])).toBe("neutral");
  });

  it("puts the chip on a child that has children, with its own tone", () => {
    const threads = [
      parent({ lastReadAt: T0 + 50 }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...working }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2, hasPendingInteraction: true }),
    ];
    const rows = threadRows(viewOf({ threads, prefs: { expandedChildren: ["m"] } }));
    const child = rows.find((row) => row.info.thread.id === "c")!;
    expect(child.chip).toMatchObject({ count: 1, flag: "waits-on-you", expanded: false });
    // Its children wait for its chip, or for an auto-reveal.
    expect(rows.map((row) => row.info.thread.id)).toEqual(["m", "c"]);
    const revealed = viewOf({ threads, prefs: { expandedChildren: ["m"] }, targets: new Map([["g", "reveal" as const]]) });
    expect(threadRows(revealed).map((row) => row.info.thread.id)).toEqual(["m", "c", "g"]);
  });
});

describe("the setting: Child threads in Needs attention", () => {
  const threads = [
    makeThread({ id: "m", ...working }),
    makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...failedUnread }),
    makeThread({ id: "d", parentThreadId: "m", createdAt: T0 + 2, ...finishedUnread }),
  ];
  const finishedAt = { d: T0 + 30 };
  it("blocked leaves a working parent's failed and finished children out", () => {
    expect(viewOf({ threads, filter: "attention", finishedAt }).groups).toEqual([]);
  });
  it("everything brings them back, as before", () => {
    const view = viewOf({ threads, filter: "attention", finishedAt, prefs: { childAttention: "everything" } });
    expect(rowIds(view, "project:proj_a")).toEqual(["m", "c", "d"]);
    expect(view.attentionCount).toBe(2);
  });
});
