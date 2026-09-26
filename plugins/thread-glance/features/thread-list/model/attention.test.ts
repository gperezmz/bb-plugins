import { describe, expect, it } from "vitest";
import { failedUnread, finishedUnread, forestOf, makeThread, attentionIds, rowIds, T0, viewOf, working } from "../testing/fixtures";
import { holdAttention, NO_HOLD, type AttentionHold, isOrphanedFailure, isParentIdle, attentionFlagsOf, revealsOn } from "./attention";
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

const sectionRows = (view: ReturnType<typeof viewOf>): ThreadRow[] =>
  (view.attention?.rows ?? []).filter((row): row is ThreadRow => row.type === "thread");

describe("Needs attention over a family", () => {
  const parent = (overrides: Record<string, unknown> = {}) =>
    makeThread({ id: "m", latestAttentionAt: T0, lastReadAt: T0, ...overrides });

  it("draws a grandchild that needs attention under its root and its parent, one step per level, and nowhere else", () => {
    const threads = [
      parent(),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2, hasPendingInteraction: true }),
    ];
    const view = viewOf({ threads });
    expect(attentionIds(view)).toEqual(["m", "c", "g"]);
    const rows = sectionRows(view);
    expect(rows.map((row) => [row.depth, row.nested])).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ]);
    // The root and the parent carry their own state, not the grandchild's.
    expect(rows.map((row) => row.info.state.kind)).toEqual(["idle", "idle", "waits-on-you"]);
    expect(rowIds(view, "project:proj_a")).toEqual([]);
    expect(group(view, "project:proj_a").counters.waitsOnYou).toBe(1);
  });

  it("shows the path to each thread that needs attention, and counts the rest in one +N more line", () => {
    const threads = [
      parent(),
      makeThread({ id: "a", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "a1", parentThreadId: "a", createdAt: T0 + 2, hasPendingInteraction: true }),
      makeThread({ id: "a2", parentThreadId: "a", createdAt: T0 + 3 }),
      makeThread({ id: "b", parentThreadId: "m", createdAt: T0 + 4, runtimeStatus: "waiting-for-host", status: "active" }),
      makeThread({ id: "q", parentThreadId: "m", createdAt: T0 + 5 }),
      makeThread({ id: "q1", parentThreadId: "q", createdAt: T0 + 6 }),
    ];
    expect(attentionIds(viewOf({ threads }))).toEqual(["m", "a", "a1", "b", "+3"]);
    // The open thread's path comes up too, and leaves the count. The family was in the section when opened, so it is held.
    expect(attentionIds(viewOf({ threads, activeThreadId: "q1", heldRootId: "m" }))).toEqual(["m", "a", "a1", "b", "q", "q1", "+1"]);
  });

  it("draws the root's chip, closed, and its home group where the age goes", () => {
    const threads = [
      parent({ hasPendingInteraction: true }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
    ];
    const rows = sectionRows(viewOf({ threads }));
    expect(rows.map((row) => row.chip)).toEqual([{ count: 1, flag: null, expanded: false, providerIds: [] }]);
    expect(rows[0]!.homeGroupLabel).toBe("Alpha");
    expect(attentionIds(viewOf({ threads }))).toEqual(["m", "+1"]);
  });

  it("names the home group in every Group by mode, and Pinned for a pinned root", () => {
    const blocked = (overrides: Record<string, unknown>) => [
      makeThread({ id: "m", ...overrides }),
      makeThread({ id: "c", parentThreadId: "m", hasPendingInteraction: true }),
    ];
    const home = (view: ReturnType<typeof viewOf>) => sectionRows(view)[0]!.homeGroupLabel;
    expect(home(viewOf({ threads: blocked({ projectId: "proj_b" }) }))).toBe("Beta");
    expect(home(viewOf({ threads: blocked({ projectId: "proj_personal" }) }))).toBe("Threads");
    expect(home(viewOf({ threads: blocked({ pinnedAt: T0, isPinned: true }) }))).toBe("Pinned");
    // A drop on a section row acts in its home group, the child's included.
    expect(viewOf({ threads: blocked({ projectId: "proj_b" }) }).attention?.homeGroupIds).toEqual({ m: "project:proj_b", c: "project:proj_b" });
    const sections = [{ id: "s1", name: "Later", createdAt: T0, updatedAt: T0 }];
    expect(home(viewOf({ threads: blocked({ sectionId: "s1" }), sections, prefs: { organizationMode: "chronological" } }))).toBe("Later");
    expect(home(viewOf({ threads: blocked({ host: { id: "h2", name: "Server" } }), prefs: { organizationMode: "machine" } }))).toBe("Server");
  });

  it("takes the family out of its group in every Group by mode, Pinned and hidden groups included", () => {
    const threads = [
      makeThread({ id: "m", sectionId: "s1", host: { id: "h2", name: "Server" } }),
      makeThread({ id: "c", parentThreadId: "m", hasPendingInteraction: true }),
      makeThread({ id: "p", pinnedAt: T0, isPinned: true }),
      makeThread({ id: "pc", parentThreadId: "p", hasPendingInteraction: true }),
      makeThread({ id: "o", sectionId: "s1", host: { id: "h2", name: "Server" } }),
    ];
    const sections = [{ id: "s1", name: "Later", createdAt: T0, updatedAt: T0 }];
    for (const organizationMode of ["project", "chronological", "machine"] as const) {
      for (const hiddenGroups of [[], ["project:proj_a", "section:s1", "machine:h2"]]) {
        const view = viewOf({ threads, sections, prefs: { organizationMode, hiddenGroups } });
        expect(attentionIds(view)).toEqual(["m", "c", "p", "pc"]);
        const drawn = [...view.groups, ...view.more].flatMap((g) => g.rows).flatMap((row) => (row.type === "thread" ? [row.info.thread.id] : []));
        expect(drawn).toEqual(["o"]);
        expect(view.groups.some((g) => g.descriptor.id === "pinned")).toBe(false);
      }
    }
  });

  it("orders families by what they need, then the chosen field in its own direction, whatever the arrow says", () => {
    const threads = [
      makeThread({ id: "u", latestAttentionAt: T0 + 30, lastReadAt: T0 }),
      makeThread({ id: "f", ...failedUnread }),
      makeThread({ id: "q1", hasPendingInteraction: true, latestAttentionAt: T0 + 1 }),
      makeThread({ id: "q2", hasPendingInteraction: true, latestAttentionAt: T0 + 2 }),
    ];
    expect(attentionIds(viewOf({ threads }))).toEqual(["q2", "q1", "f", "u"]);
    expect(attentionIds(viewOf({ threads, prefs: { sortDirection: "ascending" } }))).toEqual(["q2", "q1", "f", "u"]);
  });

  it("counts its families in the header, and no group preference collapses or hides it", () => {
    const threads = [
      makeThread({ id: "a", hasPendingInteraction: true }),
      makeThread({ id: "b", projectId: "proj_b", hasPendingInteraction: true }),
    ];
    const view = viewOf({
      threads,
      prefs: { collapsedProjects: ["proj_a", "proj_b"], collapsedSections: ["pinned", "threads"], hiddenGroups: ["project:proj_a"] },
    });
    expect(view.attention?.familyCount).toBe(2);
    expect(attentionIds(view)).toEqual(["a", "b"]);
    expect(viewOf({ threads: [makeThread({ id: "a" })] }).attention).toBeNull();
  });

  it("drops a family whose only news is a finished grandchild, and shows no counter or chip flag for it", () => {
    const threads = [
      parent(),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2 }),
    ];
    const finishedAt = { g: T0 + 30 };
    const view = viewOf({ threads, finishedAt, prefs: { expandedChildren: ["m", "c"] } });
    expect(view.attention).toBeNull();
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

  it("tints a chip in a group for work, and takes a family whose child waits or failed orphaned to Needs attention", () => {
    const view = (children: ReturnType<typeof makeThread>[], m = parent({ lastReadAt: T0 + 50 })) => viewOf({ threads: [m, ...children] });
    const tone = (children: ReturnType<typeof makeThread>[], m?: ReturnType<typeof makeThread>) => {
      const row = threadRows(view(children, m)).find((r) => r.info.thread.id === "m")!;
      return chipTone(row.chip?.flag ?? null);
    };
    const child = (overrides: object) => makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, ...overrides });
    expect(attentionIds(view([child({ hasPendingInteraction: true })]))).toEqual(["m", "c"]);
    expect(attentionIds(view([child({ ...failedUnread })]))).toEqual(["m", "c"]);
    expect(tone([child({ ...failedUnread })], parent({ ...working }))).toBe("neutral");
    expect(tone([child({ ...working })])).toBe("working");
    expect(tone([child({ ...finishedUnread })])).toBe("neutral");
  });

  it("puts the chip on a child that has children, with its own tone", () => {
    const threads = [
      parent({ lastReadAt: T0 + 50 }),
      makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1 }),
      makeThread({ id: "g", parentThreadId: "c", createdAt: T0 + 2, ...working }),
    ];
    const rows = threadRows(viewOf({ threads, prefs: { expandedChildren: ["m"] } }));
    const child = rows.find((row) => row.info.thread.id === "c")!;
    expect(child.chip).toMatchObject({ count: 1, flag: "working", expanded: false });
    // Its children wait for its chip, or for an auto-reveal.
    expect(rows.map((row) => row.info.thread.id)).toEqual(["m", "c"]);
    const revealed = viewOf({ threads, prefs: { expandedChildren: ["m"] }, targets: new Map([["g", "reveal" as const]]) });
    expect(threadRows(revealed).map((row) => row.info.thread.id)).toEqual(["m", "c", "g"]);
  });
});

describe("a family held in Needs attention while one of its threads is open", () => {
  const blocked = [
    makeThread({ id: "m" }),
    makeThread({ id: "c", parentThreadId: "m", hasPendingInteraction: true }),
    makeThread({ id: "o", projectId: "proj_b" }),
  ];
  const answered = blocked.map((t) => (t.id === "c" ? { ...t, hasPendingInteraction: false } : t));

  /** Renders a sequence of (threads, open thread), carrying the hold as the list does. */
  function renders(steps: [ReturnType<typeof makeThread>[], string | null][]): string[][] {
    let held: AttentionHold = NO_HOLD;
    return steps.map(([threads, activeThreadId]) => {
      const forest = forestOf({ threads, activeThreadId });
      held = holdAttention(held, activeThreadId === null ? undefined : forest.familyOf.get(activeThreadId));
      return attentionIds(viewOf({ threads, activeThreadId, heldRootId: held.heldRootId }));
    });
  }

  it("stays after its question is answered, until a thread outside it is opened", () => {
    expect(
      renders([
        [blocked, null],
        [blocked, "c"],
        [answered, "c"],
        [answered, "m"],
        [answered, "o"],
      ]),
    ).toEqual([["m", "c"], ["m", "c"], ["m", "c"], ["m", "+1"], []]);
  });

  it("stays after an unread root is opened and read", () => {
    const unread = [makeThread({ id: "u", ...finishedUnread }), makeThread({ id: "o", projectId: "proj_b" })];
    const read = unread.map((t) => (t.id === "u" ? { ...t, lastReadAt: T0 + 20 } : t));
    expect(renders([[unread, "u"], [read, "u"], [read, "o"]])).toEqual([["u"], ["u"], []]);
  });

  it("does not pull in the open family when its root finishes a turn unread", () => {
    const running = [makeThread({ id: "u", ...working, lastReadAt: T0 + 5 }), makeThread({ id: "o", projectId: "proj_b" })];
    const finished = running.map((t) => (t.id === "u" ? { ...t, ...finishedUnread } : t));
    expect(renders([[running, "u"], [finished, "u"], [finished, "u"]])).toEqual([[], [], []]);
  });

  it("does not pull in the open family when it asks a question or a child needs attention", () => {
    const idle = [makeThread({ id: "m" }), makeThread({ id: "c", parentThreadId: "m" }), makeThread({ id: "o", projectId: "proj_b" })];
    const asks = (id: string) => idle.map((t) => (t.id === id ? { ...t, hasPendingInteraction: true } : t));
    expect(renders([[idle, "m"], [asks("m"), "m"]])).toEqual([[], []]);
    expect(renders([[idle, "c"], [asks("c"), "c"], [asks("c"), "m"]])).toEqual([[], [], []]);
  });

  it("judges a family afresh when a thread outside it is opened", () => {
    const running = [makeThread({ id: "u", ...working, lastReadAt: T0 + 5 }), makeThread({ id: "o", projectId: "proj_b" })];
    const finished = running.map((t) => (t.id === "u" ? { ...t, ...finishedUnread } : t));
    expect(renders([[running, "u"], [finished, "u"], [finished, "o"], [finished, "o"]])).toEqual([[], [], ["u"], ["u"]]);
    // Opened again, it is judged again: still unread, so it goes straight back in.
    expect(renders([[finished, "u"], [finished, "o"], [finished, "u"]])).toEqual([["u"], ["u"], ["u"]]);
    // Nothing in it needs attention: it stays in its group.
    expect(renders([[answered, "o"], [answered, "c"], [answered, "m"]])).toEqual([[], [], []]);
  });

  it("is not pulled in by opening a family that never needed attention", () => {
    expect(renders([[answered, "c"], [answered, "m"]])).toEqual([[], []]);
    expect(holdAttention({ heldRootId: "m", openRootId: "m" }, undefined)).toEqual(NO_HOLD);
  });
});

describe("Needs attention counts every child", () => {
  // The parent is read, as if you watched it: a root that finishes unread needs attention on its own.
  const failedAt = T0 + 10;
  const child = makeThread({ id: "c", parentThreadId: "m", createdAt: T0 + 1, status: "error", latestAttentionAt: failedAt, lastReadAt: T0 });
  const parent = (overrides: Record<string, unknown>) => makeThread({ id: "m", lastReadAt: T0 + 100, ...overrides });
  const ids = (m: ReturnType<typeof makeThread>, childAttention: "blocked" | "everything" = "blocked", extra = {}) =>
    attentionIds(viewOf({ threads: [m, child], prefs: { childAttention }, ...extra }));

  it("off: a child that fails while its parent runs stays out, before and after the parent finishes", () => {
    expect(ids(parent({ ...working, latestAttentionAt: T0 }))).toEqual([]);
    expect(ids(parent({ latestAttentionAt: T0 + 20 }))).toEqual([]);
    // A parent that is itself a child finishes without moving latestAttentionAt: the server's stamp says so.
    expect(ids(parent({ latestAttentionAt: T0 }), "blocked", { finishedAt: { m: T0 + 20 } })).toEqual([]);
  });

  it("off: a child that fails while its parent is idle is in, and leaves once the parent runs a turn", () => {
    expect(ids(parent({ latestAttentionAt: T0 }))).toEqual(["m", "c"]);
    expect(ids(parent({ ...working, latestAttentionAt: T0 }))).toEqual([]);
    expect(ids(parent({ latestAttentionAt: T0 + 20 }))).toEqual([]);
  });

  it("off: the family stays while another of its threads needs attention", () => {
    const asks = makeThread({ id: "d", parentThreadId: "m", createdAt: T0 + 2, hasPendingInteraction: true });
    expect(attentionIds(viewOf({ threads: [parent({ ...working, latestAttentionAt: T0 }), child, asks] }))).toEqual(["m", "d", "+1"]);
  });

  it("on: a child that failed while its parent runs brings its family in", () => {
    expect(ids(parent({ ...working, latestAttentionAt: T0 }), "everything")).toEqual(["m", "c"]);
  });

  it("a finished, unread child: out with the setting off, in with it on", () => {
    const threads = [parent({ latestAttentionAt: T0 }), makeThread({ id: "d", parentThreadId: "m", createdAt: T0 + 2 })];
    const finishedAt = { d: T0 + 30 };
    expect(attentionIds(viewOf({ threads, finishedAt }))).toEqual([]);
    expect(attentionIds(viewOf({ threads, finishedAt, prefs: { childAttention: "everything" } }))).toEqual(["m", "d"]);
  });
});
