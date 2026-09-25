import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  failedUnread,
  finishedUnread,
  forestOf,
  makeThread,
  rowIds,
  T0,
  viewOf,
  working,
  type Scenario,
} from "../testing/fixtures";
import { detectTransitions, mergeTargets, pruneTargets, snapshotOf, type Targets } from "./expansion";
import type { ThreadRow } from "./view";

/** Runs one render the way the list does: diff, merge targets, build. */
function render(scenario: Scenario, previous: ReturnType<typeof snapshotOf> | null, targets: Targets) {
  const forest = forestOf(scenario);
  const snapshot = snapshotOf(forest, scenario.activeThreadId ?? null);
  const nextTargets = mergeTargets(targets, detectTransitions(previous, snapshot));
  return { snapshot, targets: nextTargets, view: viewOf({ ...scenario, targets: nextTargets }) };
}

function threadRow(view: ReturnType<typeof viewOf>, id: string): ThreadRow {
  for (const group of [...view.groups, ...view.more]) {
    for (const row of group.rows) if (row.type === "thread" && row.info.thread.id === id) return row;
  }
  throw new Error(`no row ${id}`);
}

function group(view: ReturnType<typeof viewOf>, id: string) {
  const found = [...view.groups, ...view.more].find((candidate) => candidate.descriptor.id === id);
  if (found === undefined) throw new Error(`no group ${id}`);
  return found;
}

describe("scenario 1: parent with 5 working children, one blocked", () => {
  const threads = [
    makeThread({ id: "m", latestAttentionAt: T0 + 100, lastReadAt: T0 + 100 }),
    ...[1, 2, 3, 4, 5].map((n) =>
      makeThread({
        id: `c${n}`,
        parentThreadId: "m",
        createdAt: T0 + n,
        ...working,
        hasPendingInteraction: n === 3,
      }),
    ),
    makeThread({ id: "other", latestAttentionAt: T0 + 200, lastReadAt: T0 + 200 }),
  ];

  it("the chip shows 5 with the question and auto-expands only the blocked child", () => {
    const { view } = render({ threads }, null, new Map());
    const root = threadRow(view, "m");
    // The chip still expands; a "+4 more" row says what the reveal left out.
    expect(root.chip).toEqual({ count: 5, flag: "waits-on-you", expanded: false, providerIds: [] });
    expect(root.info.state.kind).toBe("idle");
    expect(rowIds(view, "project:proj_a")).toEqual(["other", "m", "c3", "older:4"]);
    expect(threadRow(view, "c3").info.state.glyph).toMatchObject({ icon: "CircleQuestion", tone: "attention" });
  });

  it("the header shows ?1 and 5 working (6 with a working root)", () => {
    expect(group(viewOf({ threads }), "project:proj_a").counters).toMatchObject({ waitsOnYou: 1, working: 5 });
    const busyRoot = threads.map((t) => (t.id === "m" ? { ...t, ...working } : t));
    expect(group(viewOf({ threads: busyRoot }), "project:proj_a").counters.working).toBe(6);
  });

  it("the family keeps its place: questions don't move rows", () => {
    const calm = threads.map((t) => ({ ...t, hasPendingInteraction: false }));
    const ids = (s: Scenario) => rowIds(viewOf(s), "project:proj_a").filter((id) => !id.startsWith("c"));
    expect(ids({ threads })).toEqual(ids({ threads: calm }));
  });

  it("collapsing the chip sticks until another transition", () => {
    const first = render({ threads }, null, new Map());
    const collapsed = pruneTargets(first.targets, (id) => id.startsWith("c"));
    const again = render({ threads }, first.snapshot, collapsed);
    expect(rowIds(again.view, "project:proj_a")).toEqual(["other", "m"]);
    const c5blocked = threads.map((t) => (t.id === "c5" ? { ...t, hasPendingInteraction: true } : t));
    const next = render({ threads: c5blocked }, again.snapshot, again.targets);
    expect(rowIds(next.view, "project:proj_a")).toEqual(["other", "m", "c5", "older:4"]);
  });
});

describe("scenario 2: child failed while its parent finished", () => {
  const threads = [
    makeThread({ id: "p", ...finishedUnread }),
    makeThread({ id: "c", parentThreadId: "p", ...failedUnread }),
  ];

  it("root unread, chip CircleX, failed child revealed bold; header failed 1 unread 2", () => {
    const { view } = render({ threads }, null, new Map());
    const root = threadRow(view, "p");
    expect(root.info.unread).toBe(true);
    expect(root.info.state.kind).toBe("unread");
    expect(root.chip?.flag).toBe("unread-failed");
    const child = threadRow(view, "c");
    expect(child.info).toMatchObject({ unread: true, state: { kind: "failed" } });
    // The finished child adds nothing to the counters; its failure does, as its parent finished no later.
    expect(group(view, "project:proj_a").counters).toMatchObject({ failed: 1, unread: 1 });
  });

  it("after opening both, counters clear, the chip loses CircleX, the child stays red", () => {
    const read = threads.map((t) => ({ ...t, lastReadAt: T0 + 20 }));
    const view = viewOf({ threads: read, prefs: { expandedChildren: ["p"] } });
    expect(group(view, "project:proj_a").counters).toMatchObject({ failed: 0, unread: 0 });
    expect(threadRow(view, "p").chip?.flag).toBeNull();
    const child = threadRow(view, "c");
    expect(child.info).toMatchObject({ unread: false, state: { kind: "failed", glyph: { icon: "CircleX" } } });
  });

  it("the family can then fold", () => {
    const read = threads.map((t) => ({ ...t, lastReadAt: T0 + 20 }));
    const others = [1, 2, 3, 4, 5].map((n) =>
      makeThread({ id: `q${n}`, latestAttentionAt: T0 + 100 + n, lastReadAt: T0 + 200 }),
    );
    expect(rowIds(viewOf({ threads: [...read, ...others] }), "project:proj_a")).toEqual([
      "q5",
      "q4",
      "q3",
      "q2",
      "q1",
      "older:1",
    ]);
  });
});

describe("scenario 3: machine offline", () => {
  it("offline row, header offline 1, kept under Needs attention", () => {
    const threads = [
      makeThread({ id: "t", status: "active", runtimeStatus: "waiting-for-host" }),
      makeThread({ id: "u" }),
    ];
    const view = viewOf({ threads });
    expect(threadRow(view, "t").info.state).toMatchObject({ kind: "offline", label: "Machine offline" });
    expect(group(view, "project:proj_a").counters.offline).toBe(1);
    expect(rowIds(viewOf({ threads, filter: "attention" }), "project:proj_a")).toEqual(["t"]);
  });
  it("host-reconnecting counts as working", () => {
    const view = viewOf({ threads: [makeThread({ id: "t", status: "active", runtimeStatus: "host-reconnecting" })] });
    expect(threadRow(view, "t").info.state).toMatchObject({ kind: "working", label: "Reconnecting" });
    expect(group(view, "project:proj_a").counters.working).toBe(1);
  });
});

describe("scenario 5: a project with 60 old threads", () => {
  const old = Array.from({ length: 60 }, (_, n) =>
    makeThread({ id: `o${n}`, createdAt: T0 + n, latestAttentionAt: T0 + n, lastReadAt: T0 + n }),
  );

  it("shows the 5 most recent quiet roots, then 55 older", () => {
    const ids = rowIds(viewOf({ threads: old }), "project:proj_a");
    expect(ids).toEqual(["o59", "o58", "o57", "o56", "o55", "older:55"]);
  });
  it("non-quiet roots are all shown, in sort order", () => {
    const withBusy = old.map((t) => (t.id === "o3" ? { ...t, ...working } : t));
    const ids = rowIds(viewOf({ threads: withBusy }), "project:proj_a");
    expect(ids).toEqual(["o59", "o58", "o57", "o56", "o55", "o3", "older:54"]);
  });
  it("the persisted expansion shows every root", () => {
    const ids = rowIds(viewOf({ threads: old, prefs: { expandedOlder: ["project:proj_a"] } }), "project:proj_a");
    expect(ids).toHaveLength(61);
    expect(ids.at(-1)).toBe("older:55");
  });
  it("fold older off shows everything", () => {
    expect(rowIds(viewOf({ threads: old, prefs: { foldOlder: false } }), "project:proj_a")).toHaveLength(60);
  });
  it("unread roots don't fold; the header counts them", () => {
    const unread = old.map((t) => ({ ...t, lastReadAt: T0 - 1 }));
    const view = viewOf({ threads: unread });
    expect(rowIds(view, "project:proj_a")).toHaveLength(60);
    expect(group(view, "project:proj_a").counters.unread).toBe(60);
  });
});

describe("scenario 6: pinned thread while its child is active", () => {
  const threads = [
    makeThread({ id: "p", pinnedAt: T0, isPinned: true }),
    makeThread({ id: "c", parentThreadId: "p", ...working }),
    makeThread({ id: "c2", parentThreadId: "p" }),
  ];
  it("Pinned shows the chip with the spinner and counts working 1", () => {
    const view = viewOf({ threads });
    expect(threadRow(view, "p").chip).toMatchObject({ count: 2, flag: "working" });
    expect(group(view, "pinned").counters.working).toBe(1);
    expect(view.groups.find((g) => g.descriptor.id === "project:proj_a")?.rows ?? []).toEqual([]);
  });
  it("pinning the child moves it to Pinned and drops the parent's count", () => {
    const unpinnedParent = [
      makeThread({ id: "p" }),
      makeThread({ id: "c", parentThreadId: "p", pinnedAt: T0, isPinned: true }),
      makeThread({ id: "g", parentThreadId: "c" }),
      makeThread({ id: "c2", parentThreadId: "p" }),
    ];
    const view = viewOf({ threads: unpinnedParent });
    expect(threadRow(view, "p").chip?.count).toBe(1);
    expect(rowIds(view, "pinned")).toEqual(["c"]);
    expect(threadRow(view, "c").chip?.count).toBe(1);
  });
});

describe("scenario 7: active grandchild inside a collapsed project", () => {
  const quietRoots = Array.from({ length: 7 }, (_, n) =>
    makeThread({ id: `r${n}`, createdAt: T0 + n * 10, latestAttentionAt: T0 + n * 10, lastReadAt: T0 + 100 }),
  );
  const threads = [
    ...quietRoots,
    makeThread({ id: "child", parentThreadId: "r0", createdAt: T0 + 1 }),
    makeThread({ id: "grand", parentThreadId: "child", createdAt: T0 + 2 }),
  ];
  const prefs = { collapsedProjects: ["proj_a"] };

  it("opens the project and the path, with ↳ on the grandchild; its root is never folded", () => {
    const { view } = render({ threads, prefs, activeThreadId: "grand" }, null, new Map());
    const project = group(view, "project:proj_a");
    expect(project.userCollapsed).toBe(true);
    expect(project.collapsed).toBe(false);
    const ids = rowIds(view, "project:proj_a");
    // r0 holds the active thread, so it isn't quiet: only r1–r6 are, and one folds.
    expect(ids.slice(-4)).toEqual(["r0", "child", "grand", "older:1"]);
    expect(threadRow(view, "grand")).toMatchObject({ nested: true, parentTitle: "Thread child", depth: 2 });
    expect(threadRow(view, "child").nested).toBe(false);
    expect(threadRow(view, "grand").info.isActive).toBe(true);
  });
  it("an older fold holding a target opens, without persisting", () => {
    const unreadOld = [...quietRoots.slice(1), makeThread({ id: "u", createdAt: T0 - 50, latestAttentionAt: T0 - 50, lastReadAt: T0 - 50 })];
    const first = render({ threads: unreadOld }, null, new Map());
    const readNow = unreadOld.map((t) => (t.id === "u" ? { ...t, lastReadAt: T0 + 100 } : t));
    const nextTargets = mergeTargets(first.targets, new Map([["u", "reveal"]]));
    const view = viewOf({ threads: readNow, targets: nextTargets });
    expect(rowIds(view, "project:proj_a")).toContain("u");
    expect(rowIds(viewOf({ threads: readNow }), "project:proj_a")).not.toContain("u");
  });
  it("the root never folds while the grandchild is active", () => {
    const view = viewOf({ threads, prefs: {}, activeThreadId: "grand" });
    expect(rowIds(view, "project:proj_a")).toContain("r0");
  });
});

describe("scenario 8: Needs attention with a quiet parent whose child is blocked", () => {
  const threads = [
    makeThread({ id: "p" }),
    makeThread({ id: "c1", parentThreadId: "p", hasPendingInteraction: true, createdAt: T0 + 1 }),
    makeThread({ id: "c2", parentThreadId: "p", createdAt: T0 + 2 }),
    makeThread({ id: "b", projectId: "proj_b" }),
    makeThread({ id: "pin", pinnedAt: T0, isPinned: true }),
    makeThread({ id: "d", createdAt: T0 - 5 }),
    makeThread({ id: "dc", parentThreadId: "d", createdAt: T0 + 3 }),
  ];
  const finishedAt = { dc: T0 + 50 };

  it("keeps the parent and only the blocked child; empty groups disappear", () => {
    const view = viewOf({ threads, filter: "attention", finishedAt, prefs: { hiddenGroups: ["project:proj_b"] } });
    expect(view.groups.map((g) => g.descriptor.id)).toEqual(["project:proj_a"]);
    expect(view.more).toEqual([]);
    // dc finished unread, which a child never counts, so d and dc drop out.
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "c1"]);
  });
  it("keeps a finished child too when children count as everything", () => {
    const view = viewOf({ threads, filter: "attention", finishedAt, prefs: { childAttention: "everything" } });
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "c1", "d", "dc"]);
  });
});

describe("scenario 9: cross-project child", () => {
  const threads = [
    makeThread({ id: "p", projectId: "proj_a" }),
    makeThread({ id: "c", parentThreadId: "p", projectId: "proj_b", hasPendingInteraction: true }),
  ];
  it("sits under its parent with the badge and counts in the parent's project", () => {
    const view = viewOf({ threads, prefs: { expandedChildren: ["p"] } });
    expect(threadRow(view, "c").crossGroupLabel).toBe("In project Beta");
    expect(group(view, "project:proj_a").counters.waitsOnYou).toBe(1);
    expect(group(view, "project:proj_b").counters.waitsOnYou).toBe(0);
    expect(group(view, "project:proj_b").rows).toEqual([]);
  });
});

describe("folding inside a family", () => {
  const children = Array.from({ length: 8 }, (_, n) =>
    makeThread({ id: `c${n}`, parentThreadId: "p", createdAt: T0 + n }),
  );
  const threads = [makeThread({ id: "p" }), ...children];
  it("user expansion shows non-quiet plus the 3 most recent quiet, in creation order", () => {
    const busy = threads.map((t) => (t.id === "c0" ? { ...t, ...working } : t));
    const view = viewOf({ threads: busy, prefs: { expandedChildren: ["p"] } });
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "c0", "c5", "c6", "c7", "older:4"]);
  });
  it("keeps the same children whichever visible child is open, and adds a hidden open one without evicting", () => {
    const prefs = { expandedChildren: ["p"] };
    const idle = rowIds(viewOf({ threads, prefs }), "project:proj_a");
    expect(idle).toEqual(["p", "c5", "c6", "c7", "older:5"]);
    // Navigating among the visible children leaves the rendered list as it was.
    for (const active of ["c5", "c6", "c7"]) {
      expect(rowIds(viewOf({ threads, prefs, activeThreadId: active }), "project:proj_a")).toEqual(idle);
    }
    // An open child behind the fold shows too; the rest stay, and the fold counts one fewer.
    expect(rowIds(viewOf({ threads, prefs, activeThreadId: "c1" }), "project:proj_a")).toEqual([
      "p",
      "c1",
      "c5",
      "c6",
      "c7",
      "older:4",
    ]);
  });
  it("moving between two children behind the fold swaps the one extra row, and a grandchild brings its parent", () => {
    const prefs = { expandedChildren: ["p"] };
    const rows = (activeThreadId: string, all = threads) => rowIds(viewOf({ threads: all, prefs, activeThreadId }), "project:proj_a");
    expect(rows("c2")).toEqual(["p", "c2", "c5", "c6", "c7", "older:4"]);
    // A grandchild is drawn under its parent only, so its parent comes with it.
    const withGrandchild = [...threads, makeThread({ id: "g", parentThreadId: "c1", createdAt: T0 - 1 })];
    const targeted = viewOf({
      threads: withGrandchild,
      prefs,
      activeThreadId: "g",
      targets: new Map([["g", "reveal" as const]]),
    });
    expect(rowIds(targeted, "project:proj_a")).toEqual(["p", "c1", "g", "c5", "c6", "c7", "older:4"]);
    expect(rows("g", withGrandchild)).toEqual(["p", "c1", "c5", "c6", "c7", "older:4"]);
  });
  it("draws the rail from the parent down to the fold row, where it ends", () => {
    const view = viewOf({ threads, prefs: { expandedChildren: ["p"] } });
    const rows = group(view, "project:proj_a").rows;
    expect(rows.map((row) => row.rails)).toEqual([["start"], ["full", null], ["full", null], ["full", null], ["end", null]]);
    expect(rows.at(-1)).toMatchObject({ type: "older", scope: "family" });
  });
  it("does not reshuffle when an auto-reveal target is a shown quiet child", () => {
    const idle = rowIds(viewOf({ threads, prefs: { expandedChildren: ["p"] } }), "project:proj_a");
    const targeted = viewOf({
      threads,
      prefs: { expandedChildren: ["p"] },
      activeThreadId: "c7",
      targets: new Map([["c7", "reveal" as const]]),
    });
    expect(rowIds(targeted, "project:proj_a")).toEqual(idle);
  });
  it("an expanded older fold shows all", () => {
    const view = viewOf({ threads, prefs: { expandedChildren: ["p"], expandedOlder: ["p"] } });
    expect(rowIds(view, "project:proj_a")).toHaveLength(10);
  });
});

describe("a group's fold while a thread is open", () => {
  // 13 quiet roots, newest first r12..r0; r11 has a quiet child.
  const roots = Array.from({ length: 13 }, (_, n) =>
    makeThread({ id: `r${n}`, createdAt: T0 + n * 10, updatedAt: T0 + n * 10, latestAttentionAt: T0 + n * 10, lastReadAt: T0 + 200 }),
  );
  const threads = [...roots, makeThread({ id: "k", parentThreadId: "r11", createdAt: T0 + 111, lastReadAt: T0 + 200 })];
  const rows = (activeThreadId: string | null) => rowIds(viewOf({ threads, activeThreadId }), "project:proj_a");
  const idle = ["r12", "r11", "r10", "r9", "r8", "older:8"];

  it("keeps the shown roots and the older count when a shown root or its child is opened", () => {
    expect(rows(null)).toEqual(idle);
    for (const active of ["r12", "r11", "r10", "r9", "r8", "k"]) expect(rows(active)).toEqual(idle);
  });
  it("adds a root behind the fold when it is opened, in its place, and counts one fewer", () => {
    expect(rows("r3")).toEqual(["r12", "r11", "r10", "r9", "r8", "r3", "older:7"]);
  });
  it("adds a root behind the fold with the open child and its reveal, and keeps the fold shut", () => {
    const withChild = [...threads, makeThread({ id: "j", parentThreadId: "r2", createdAt: T0 + 21, lastReadAt: T0 + 200 })];
    const first = render({ threads: withChild }, null, new Map());
    const opened = render({ threads: withChild, activeThreadId: "j" }, first.snapshot, first.targets);
    expect(rowIds(opened.view, "project:proj_a")).toEqual(["r12", "r11", "r10", "r9", "r8", "r2", "j", "older:7"]);
  });
  it("keeps the rows as they were across the render that opens a thread", () => {
    const first = render({ threads }, null, new Map());
    const opened = render({ threads, activeThreadId: "r12" }, first.snapshot, first.targets);
    expect(rowIds(opened.view, "project:proj_a")).toEqual(idle);
    // Opening one behind the fold reveals it alone, not the whole fold.
    const behind = render({ threads, activeThreadId: "r3" }, first.snapshot, first.targets);
    expect(rowIds(behind.view, "project:proj_a")).toEqual(["r12", "r11", "r10", "r9", "r8", "r3", "older:7"]);
  });
});

describe("folding a family by the attention rule", () => {
  // A parent whose 12 workers all finished after you last looked at them (done-unseen).
  const workers = Array.from({ length: 12 }, (_, n) =>
    makeThread({ id: `w${n}`, parentThreadId: "m", createdAt: T0 + n }),
  );
  const finishedAt = Object.fromEntries(workers.map((worker) => [worker.id, T0 + 100]));
  const threads = [makeThread({ id: "m" }), ...workers];
  const rows = (scenario: Scenario, attention: "blocked" | "everything" = "blocked") =>
    rowIds(
      viewOf({
        finishedAt,
        ...scenario,
        prefs: { expandedChildren: ["m"], childAttention: attention, ...scenario.prefs },
      }),
      "project:proj_a",
    );
  const withState = (overrides: Record<string, Partial<PluginSidebarThread>>) =>
    threads.map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t));

  it("folds finished-unread children like quiet ones, keeping the 3 most recent", () => {
    expect(rows({ threads })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
  });
  it("keeps their unread dot when the fold is opened", () => {
    const view = viewOf({ threads, finishedAt, prefs: { expandedChildren: ["m"], expandedOlder: ["m"] } });
    const shown = group(view, "project:proj_a").rows.filter((row): row is ThreadRow => row.type === "thread").slice(1);
    expect(shown).toHaveLength(12);
    for (const row of shown) expect(row.info.state.kind).toBe("unread");
  });
  it("with Everything, a finished-unread child stays visible, as a root would", () => {
    expect(rows({ threads }, "everything")).toEqual(["m", ...workers.map((worker) => worker.id)]);
  });
  it("keeps children that work, wait on you, are offline or failed under an idle parent", () => {
    const mixed = withState({
      w0: working,
      w1: { status: "idle", runtimeStatus: "provisioning" },
      w2: { activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } },
      w3: { hasPendingInteraction: true },
      w4: { runtimeStatus: "waiting-for-host" },
      w5: failedUnread,
    });
    expect(rows({ threads: mixed })).toEqual(["m", "w0", "w1", "w2", "w3", "w4", "w5", "w9", "w10", "w11", "older:3"]);
  });
  it("folds a failed child while its parent is busy, and shows it once the parent is idle and has not run since", () => {
    const busy = withState({ m: working, w0: failedUnread });
    expect(rows({ threads: busy })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
    expect(rows({ threads: withState({ w0: failedUnread }) })).toEqual(["m", "w0", "w9", "w10", "w11", "older:8"]);
  });
  it("keeps a child whose own child is stuck, even with its own chip closed", () => {
    const stuck = [...threads, makeThread({ id: "g", parentThreadId: "w0", createdAt: T0 + 50, hasPendingInteraction: true })];
    expect(rows({ threads: stuck })).toEqual(["m", "w0", "w9", "w10", "w11", "older:8"]);
    const quietIgnoringOpen = [...threads, makeThread({ id: "g", parentThreadId: "w0", createdAt: T0 + 50 })];
    expect(rows({ threads: quietIgnoringOpen, finishedAt: { ...finishedAt, g: T0 + 100 } })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
  });
  it("folds a child holding a queued or scheduled message", () => {
    const waiting = withState({ w0: { queuedWork: "waiting" }, w1: { queuedWork: "waiting" } });
    expect(rows({ threads: waiting, scheduled: { w1: T0 + 10 * 60_000 } })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
    expect(rows({ threads: waiting }, "everything")).toEqual(["m", ...workers.map((worker) => worker.id)]);
  });
  it("folds an archived child, whatever it carries", () => {
    const archived = withState({ w0: { isArchived: true, runtimeStatus: "waiting-for-host" } });
    const prefs = { threadLifecycles: ["active", "archived"] as ("active" | "archived")[] };
    expect(rows({ threads: archived, prefs })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
  });
  it("counts a hidden grandchild only when it needs attention", () => {
    const hidden = (overrides: Partial<PluginSidebarThread>) => [
      ...threads,
      makeThread({ id: "g", parentThreadId: "w0", createdAt: T0 + 50, isHidden: true, ...overrides }),
    ];
    expect(rows({ threads: hidden(working) })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
    expect(rows({ threads: hidden({ hasPendingInteraction: true }) })).toEqual(["m", "w0", "w9", "w10", "w11", "older:8"]);
  });
  it("adds the open child behind the fold, and moving between children keeps the rest in place", () => {
    expect(rows({ threads, activeThreadId: "w2" })).toEqual(["m", "w2", "w9", "w10", "w11", "older:8"]);
    for (const active of ["w9", "w10", "w11"]) {
      expect(rows({ threads, activeThreadId: active })).toEqual(["m", "w9", "w10", "w11", "older:9"]);
    }
  });
  it("keeps the child on the path to an open grandchild", () => {
    const deep = [...threads, makeThread({ id: "g", parentThreadId: "w0", createdAt: T0 + 50 })];
    expect(rows({ threads: deep, activeThreadId: "g" })).toEqual(["m", "w0", "w9", "w10", "w11", "older:8"]);
  });
});

describe("hidden threads", () => {
  it("attach to the nearest visible ancestor; a blocked hidden one gets a badge row", () => {
    const threads = [
      makeThread({ id: "p" }),
      makeThread({ id: "h", parentThreadId: "p", isHidden: true }),
      makeThread({ id: "w", parentThreadId: "h", createdAt: T0 + 1 }),
      makeThread({ id: "hb", parentThreadId: "p", isHidden: true, hasPendingInteraction: true, createdAt: T0 + 2 }),
    ];
    const view = viewOf({ threads, prefs: { expandedChildren: ["p"] } });
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "w", "hb"]);
    expect(threadRow(view, "w").nested).toBe(false);
    expect(threadRow(view, "hb").hiddenBadge).toBe(true);
    expect(threadRow(view, "p").chip).toMatchObject({ count: 1, flag: "waits-on-you" });
  });
  it("hidden working threads don't count", () => {
    const threads = [makeThread({ id: "p" }), makeThread({ id: "h", parentThreadId: "p", isHidden: true, ...working })];
    expect(group(viewOf({ threads }), "project:proj_a").counters.working).toBe(0);
  });
});

describe("tree nesting", () => {
  const threads = [
    makeThread({ id: "p" }),
    makeThread({ id: "c", parentThreadId: "p", latestAttentionAt: T0 + 1 }),
    makeThread({ id: "g", parentThreadId: "c", hasPendingInteraction: true }),
    makeThread({ id: "c2", parentThreadId: "p", latestAttentionAt: T0 + 5 }),
  ];
  it("indents by depth, expanded by default, siblings by the list's comparator", () => {
    const view = viewOf({ threads, prefs: { nesting: "tree" } });
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "c2", "c", "g"]);
    expect(threadRow(view, "g").depth).toBe(2);
    expect(threadRow(view, "p").stickyLevel).toBe(0);
  });
  it("a collapsed parent shows the rollup chip unless a transition opens it", () => {
    const collapsed = viewOf({ threads, prefs: { nesting: "tree", collapsedChildren: ["c"] } });
    expect(rowIds(collapsed, "project:proj_a")).toEqual(["p", "c2", "c"]);
    expect(threadRow(collapsed, "c").chip).toMatchObject({ count: 1, flag: "waits-on-you", expanded: false });
    const { view } = render({ threads, prefs: { nesting: "tree", collapsedChildren: ["c"] } }, null, new Map());
    expect(rowIds(view, "project:proj_a")).toEqual(["p", "c2", "c", "g"]);
  });
});

describe("groups and modes", () => {
  it("project mode: Pinned first, projects in host order, personal threads in Threads", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "a" }),
        makeThread({ id: "b", projectId: "proj_b" }),
        makeThread({ id: "l", projectId: "proj_personal" }),
        makeThread({ id: "x", projectId: "proj_missing" }),
      ],
    });
    expect(view.groups.map((g) => g.descriptor.id)).toEqual(["project:proj_a", "project:proj_b", "threads"]);
    expect(rowIds(view, "threads")).toEqual(["l", "x"]);
  });
  it("an empty project still shows (No threads) unless hidden", () => {
    const view = viewOf({ threads: [makeThread({ id: "a" })], prefs: { hiddenGroups: [] } });
    expect(group(view, "project:proj_b").rows).toEqual([]);
    const hidden = viewOf({ threads: [makeThread({ id: "a" })], prefs: { hiddenGroups: ["project:proj_b"] } });
    expect(hidden.groups.map((g) => g.descriptor.id)).toEqual(["project:proj_a"]);
    expect(hidden.more.map((g) => g.descriptor.id)).toEqual(["project:proj_b"]);
  });
  it("More's counters sum the hidden groups", () => {
    const view = viewOf({
      threads: [makeThread({ id: "b", projectId: "proj_b", hasPendingInteraction: true })],
      prefs: { hiddenGroups: ["project:proj_b"] },
    });
    expect(view.moreCounters.waitsOnYou).toBe(1);
  });
  it("custom sections mode buckets by the root's section", () => {
    const view = viewOf({
      threads: [makeThread({ id: "a", sectionId: "s1" }), makeThread({ id: "b" }), makeThread({ id: "c", sectionId: "gone" })],
      sections: [{ id: "s1", name: "Later", createdAt: T0, updatedAt: T0 }],
      prefs: { organizationMode: "chronological" },
    });
    expect(view.groups.map((g) => [g.descriptor.id, g.descriptor.label])).toEqual([
      ["section:s1", "Later"],
      ["section:gone", "Section"],
      ["threads", "Threads"],
    ]);
  });
  it("machine mode buckets by the root's host", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "a", host: { id: "h1", name: "Laptop" } }),
        makeThread({ id: "b", host: { id: "h2", name: "Server" } }),
        makeThread({ id: "c", parentThreadId: "a", host: { id: "h2", name: "Server" } }),
      ],
      prefs: { organizationMode: "machine", expandedChildren: ["a"] },
    });
    expect(view.groups.map((g) => g.descriptor.label)).toEqual(["Laptop", "Server"]);
    expect(threadRow(view, "c").crossGroupLabel).toBe("On machine Server");
    expect(view.multiHost).toBe(true);
  });
  it("environment folders group 2+ roots sharing a worktree when enabled", () => {
    const wt = { id: "env_wt", isWorktree: true, branchName: "feat/x" };
    const threads = [
      makeThread({ id: "a", environment: wt, latestAttentionAt: T0 + 3 }),
      makeThread({ id: "b", environment: wt, latestAttentionAt: T0 + 2 }),
      makeThread({ id: "c", latestAttentionAt: T0 + 1 }),
    ];
    expect(rowIds(viewOf({ threads }), "project:proj_a")).toEqual(["a", "b", "c"]);
    const on = viewOf({ threads, prefs: { environmentGrouping: true } });
    expect(rowIds(on, "project:proj_a")).toEqual(["env:env_wt", "a", "b", "c"]);
    const collapsed = viewOf({ threads, prefs: { environmentGrouping: true, collapsedEnvironments: ["env_wt"] } });
    expect(rowIds(collapsed, "project:proj_a")).toEqual(["env:env_wt", "c"]);
  });
});

describe("sort", () => {
  const threads = [
    makeThread({ id: "a", title: "b-title", createdAt: T0 + 1, latestAttentionAt: T0 + 1 }),
    makeThread({ id: "b", title: "a-title", createdAt: T0 + 2, latestAttentionAt: T0 }),
    makeThread({ id: "c", parentThreadId: "b", latestAttentionAt: T0 + 9, status: "error", lastReadAt: T0 + 9 }),
  ];
  it("Updated sorts by the family's latest attention", () => {
    expect(rowIds(viewOf({ threads }), "project:proj_a").filter((id) => id !== "c")).toEqual(["b", "a"]);
  });
  it("Created and Alphabetical, and direction", () => {
    const ids = (prefs: Scenario["prefs"]) =>
      rowIds(viewOf({ threads, prefs }), "project:proj_a").filter((id) => id !== "c");
    expect(ids({ chronologicalSort: "created" })).toEqual(["b", "a"]);
    expect(ids({ chronologicalSort: "created", sortDirection: "ascending" })).toEqual(["a", "b"]);
    expect(ids({ chronologicalSort: "alpha" })).toEqual(["b", "a"]);
    expect(ids({ chronologicalSort: "none", sortDirection: "ascending" })).toEqual(["a", "b"]);
  });
  it("working first puts active roots on top only when enabled", () => {
    const busy = [...threads, makeThread({ id: "w", latestAttentionAt: T0 - 100, ...working })];
    const ids = (workingFirst: boolean) =>
      rowIds(viewOf({ threads: busy, prefs: { workingFirst } }), "project:proj_a").filter((id) => id !== "c");
    expect(ids(false)).toEqual(["b", "a", "w"]);
    expect(ids(true)).toEqual(["w", "b", "a"]);
  });
  it("Pinned orders by pinSortKey, then pinnedAt", () => {
    const pinned = [
      makeThread({ id: "x", pinnedAt: T0 + 1, pinSortKey: "b" }),
      makeThread({ id: "y", pinnedAt: T0 + 2, pinSortKey: "a" }),
      makeThread({ id: "z", pinnedAt: T0 + 3 }),
    ];
    expect(rowIds(viewOf({ threads: pinned }), "pinned")).toEqual(["z", "y", "x"]);
  });
});

describe("transitions", () => {
  it("the first render counts; later renders only add what changed", () => {
    const threads = [makeThread({ id: "a", ...finishedUnread }), makeThread({ id: "b" })];
    const first = render({ threads, activeThreadId: "b" }, null, new Map());
    expect([...first.targets]).toEqual([
      ["b", "reveal"],
      ["a", "open"],
    ]);
    const again = detectTransitions(first.snapshot, snapshotOf(forestOf({ threads, activeThreadId: "b" }), "b"));
    expect(again.size).toBe(0);
  });
  it("a finished child opens its group but not its parent's chip", () => {
    const threads = [makeThread({ id: "p" }), makeThread({ id: "c", parentThreadId: "p" })];
    const { view } = render({ threads, finishedAt: { c: T0 + 5 }, prefs: { childAttention: "everything" } }, null, new Map());
    expect(rowIds(view, "project:proj_a")).toEqual(["p"]);
    expect(threadRow(view, "p").chip?.flag).toBe("unread");
  });
  it("a finished child opens nothing and leaves the chip plain", () => {
    const threads = [makeThread({ id: "p" }), makeThread({ id: "c", parentThreadId: "p" })];
    const { view, targets } = render({ threads, finishedAt: { c: T0 + 5 } }, null, new Map());
    expect(targets.has("c")).toBe(false);
    expect(threadRow(view, "p").chip?.flag).toBeNull();
    expect(threadRow(view, "p").chip).not.toBeNull();
  });
});

describe("attention badge", () => {
  it("counts each thread once, whatever flags it carries", () => {
    const view = viewOf({
      threads: [
        makeThread({ id: "a", ...failedUnread }),
        makeThread({ id: "b", hasPendingInteraction: true, ...working }),
        makeThread({ id: "c", ...working }),
      ],
    });
    expect(view.attentionCount).toBe(2);
  });
});
