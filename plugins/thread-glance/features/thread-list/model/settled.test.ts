import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { defaultPreferences } from "@/shared/preferences";
import { failedUnread, finishedUnread, forestOf, makeProject, makeThread, rowIds, settleOf, T0, viewOf, working, type Scenario } from "../testing/fixtures";
import { holdSettled, isSettledThread, isSettledTree, lastActivityAt, SETTLE_AFTER_MS, type SettleHold } from "./settled";
import { markAllReadPlan, markReadPlanFor, toggleSettled } from "./toggles";
import type { ThreadRow, SettledRow } from "./view";
import { groupIdForRoot } from "./groups";
import type { OrganizationMode } from "@/shared/preferences";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A day and a minute after T0: a thread last active at T0 has settled under the default 1 day. */
const LATER = T0 + DAY + 60_000;

const settled = (scenario: Scenario, id: string) => {
  const forest = forestOf(scenario);
  return isSettledThread(forest.infos.get(id)!, settleOf(scenario));
};

describe("a settled thread", () => {
  const onBranch = (overrides: Partial<PluginSidebarThread> = {}) =>
    makeThread({ id: "t", environment: { branchName: "feature" }, ...overrides });

  it("is quiet, needs no attention, is not pinned and has been idle for the Settle after period", () => {
    const threads = [makeThread({ id: "t" })];
    expect(settled({ threads, now: LATER }, "t")).toBe(true);
    expect(settled({ threads, now: T0 + DAY - 60_000 }, "t")).toBe(false);
    expect(settled({ threads: [makeThread({ id: "t", ...working })], now: LATER }, "t")).toBe(false);
    expect(settled({ threads: [makeThread({ id: "t", ...failedUnread })], now: LATER }, "t")).toBe(false);
    expect(settled({ threads: [makeThread({ id: "t", hasPendingInteraction: true })], now: LATER }, "t")).toBe(false);
    expect(settled({ threads: [makeThread({ id: "t", pinnedAt: T0, isPinned: true })], now: LATER }, "t")).toBe(false);
    expect(settled({ threads: [makeThread({ id: "t", queuedWork: "waiting" })], now: LATER }, "t")).toBe(false);
  });

  it("settles a read failure, and a draft, which are quiet", () => {
    expect(settled({ threads: [makeThread({ id: "t", status: "error" })], now: LATER }, "t")).toBe(true);
    expect(settled({ threads: [makeThread({ id: "t" })], draftIds: ["t"], now: LATER }, "t")).toBe(true);
  });

  it("follows each Settle after period, and with Never does not settle", () => {
    const threads = [makeThread({ id: "t" })];
    for (const [period, ms] of Object.entries(SETTLE_AFTER_MS)) {
      const prefs = { settleAfter: period as keyof typeof SETTLE_AFTER_MS };
      expect(settled({ threads, prefs, now: T0 + ms - 1 }, "t")).toBe(false);
      expect(settled({ threads, prefs, now: T0 + ms }, "t")).toBe(true);
    }
    const never = { settleAfter: "never" as const };
    expect(settled({ threads, prefs: never, now: T0 + 365 * DAY }, "t")).toBe(false);
  });

  it("settles on a branch off its project's default as on any other, with that default found or still being looked up", () => {
    expect(settled({ threads: [onBranch()], now: LATER }, "t")).toBe(true);
    expect(settled({ threads: [onBranch()], defaultBranches: {}, now: LATER }, "t")).toBe(true);
    expect(settled({ threads: [onBranch()], now: T0 + DAY - 60_000 }, "t")).toBe(false);
    // A pinned or busy thread on a branch stays.
    expect(settled({ threads: [onBranch({ pinnedAt: T0, isPinned: true })], now: LATER }, "t")).toBe(false);
    expect(settled({ threads: [onBranch({ ...working })], now: LATER }, "t")).toBe(false);
  });

  it("counts its own last activity, not a rename or a visit that only moved updatedAt", () => {
    const stamps = { startedAt: { t: T0 + 5 }, finishedAt: { t: T0 + 9 } };
    const thread = makeThread({ id: "t", updatedAt: T0 + 50 * DAY, latestAttentionAt: T0 + 3, lastReadAt: T0 + 3 });
    expect(lastActivityAt(thread, stamps)).toBe(T0 + 9);
    expect(settled({ threads: [thread], now: LATER + 9 }, "t")).toBe(true);
    expect(settled({ threads: [thread], startedAt: { t: T0 + DAY }, now: LATER }, "t")).toBe(false);
  });
});

describe("a settled tree", () => {
  const tree = (child: Omit<Parameters<typeof makeThread>[0], "id"> = {}) => [
    makeThread({ id: "p" }),
    makeThread({ id: "c", parentThreadId: "p", createdAt: T0 + 1, ...child }),
  ];
  const treeSettled = (scenario: Scenario) => {
    const forest = forestOf(scenario);
    return isSettledTree(forest.treeOf.get("p")!, settleOf(scenario));
  };

  it("settles as one unit, only when every thread in it is settled", () => {
    expect(treeSettled({ threads: tree(), now: LATER })).toBe(true);
    expect(treeSettled({ threads: tree({ ...working }), now: LATER })).toBe(false);
    expect(treeSettled({ threads: tree({ environment: { branchName: "f" } }), now: LATER })).toBe(true);
    expect(treeSettled({ threads: tree({ latestAttentionAt: T0 + DAY, lastReadAt: T0 + DAY }), now: LATER })).toBe(false);
  });

  it("takes archived threads, shown with Show archived threads, through the same test", () => {
    const archived = { isArchived: true, archivedAt: T0 };
    expect(treeSettled({ threads: tree(archived), now: LATER })).toBe(true);
    expect(treeSettled({ threads: tree({ ...archived, ...working }), now: LATER })).toBe(false);
    expect(treeSettled({ threads: [makeThread({ id: "p", ...archived })], now: LATER })).toBe(true);
    const branched = [makeThread({ id: "p", ...archived, environment: { branchName: "f" } })];
    expect(treeSettled({ threads: branched, now: LATER })).toBe(true);
    expect(treeSettled({ threads: branched })).toBe(false);
    expect(treeSettled({ threads: [makeThread({ id: "p", ...archived, ...finishedUnread })], now: LATER })).toBe(false);
  });

  it("takes a hidden child through the same test as any other", () => {
    expect(treeSettled({ threads: tree({ isHidden: true }), now: LATER })).toBe(true);
    expect(treeSettled({ threads: tree({ isHidden: true, ...working }), now: LATER })).toBe(false);
    expect(treeSettled({ threads: tree({ isHidden: true, hasPendingInteraction: true }), now: LATER })).toBe(false);
    expect(treeSettled({ threads: tree({ isHidden: true, environment: { branchName: "f" } }), now: LATER })).toBe(true);
  });
});

describe("the settled fold", () => {
  const recent = (id: string, at: number) => makeThread({ id, createdAt: at, latestAttentionAt: at, lastReadAt: at });
  const threads = [
    recent("new", LATER - HOUR),
    recent("old1", T0 + 2),
    makeThread({ id: "old1c", parentThreadId: "old1", createdAt: T0 + 3 }),
    recent("old2", T0 + 1),
    recent("busy", T0),
  ].map((thread) => (thread.id === "busy" ? { ...thread, ...working } : thread));
  const ids = (scenario: Partial<Scenario> = {}) => rowIds(viewOf({ threads, now: LATER, ...scenario }), "project:proj_a");

  it("ends the group with Settled (N), N counting trees, and holds them closed by default", () => {
    expect(defaultPreferences().openSettledFolds).toEqual([]);
    expect(ids()).toEqual(["new", "busy", "settled:2"]);
    const view = viewOf({ threads, now: LATER });
    const fold = view.groups.find((group) => group.descriptor.id === "project:proj_a")!.rows.at(-1) as SettledRow;
    expect(fold).toMatchObject({ type: "settled", count: 2, expanded: false });
  });

  it("shows the settled trees below it, in the group's sort, once opened", () => {
    expect(ids({ prefs: { openSettledFolds: ["project:proj_a"] } })).toEqual(["new", "busy", "settled:2", "old1", "old2"]);
    expect(ids({ prefs: { openSettledFolds: ["project:proj_a"], expandedChildren: ["old1"] } })).toEqual([
      "new",
      "busy",
      "settled:2",
      "old1",
      "old1c",
      "old2",
    ]);
  });

  it("is absent when nothing in the group is settled, and draws no N older row anywhere", () => {
    expect(ids({ now: T0 + 60_000 })).toEqual(["new", "old1", "old2", "busy"]);
    const many = Array.from({ length: 30 }, (_, n) => recent(`q${n}`, T0 + n));
    const rows = rowIds(viewOf({ threads: many, now: T0 + HOUR }), "project:proj_a");
    expect(rows).toHaveLength(30);
    expect(rows.some((row) => row.startsWith("older") || row.startsWith("settled"))).toBe(false);
  });

  it("never takes a child out of its tree", () => {
    const busyChild = [...threads, makeThread({ id: "w", parentThreadId: "old2", createdAt: T0 + 4, ...working })];
    const view = viewOf({ threads: busyChild, now: LATER, prefs: { expandedChildren: ["old2"] } });
    expect(rowIds(view, "project:proj_a")).toEqual(["new", "old2", "w", "busy", "settled:1"]);
  });

  it("takes in a tree that crosses the period, and changes with Settle after", () => {
    expect(ids({ now: T0 + DAY - 1 })).toEqual(["new", "old1", "old2", "busy"]);
    // old1's child was created last, at T0 + 3, so the tree crosses then.
    expect(ids({ now: T0 + DAY + 2 })).toEqual(["new", "old1", "busy", "settled:1"]);
    expect(ids({ now: T0 + DAY + 3 })).toEqual(["new", "busy", "settled:2"]);
    expect(ids({ prefs: { settleAfter: "3d" } })).toEqual(["new", "old1", "old2", "busy"]);
    expect(ids({ prefs: { settleAfter: "12h" } })).toEqual(["new", "busy", "settled:2"]);
    expect(ids({ prefs: { settleAfter: "never" } })).toEqual(["new", "old1", "old2", "busy"]);
  });

  it("lets a settled tree that becomes active again leave the fold", () => {
    const active = threads.map((thread) => (thread.id === "old2" ? { ...thread, ...working } : thread));
    expect(ids({ threads: active })).toEqual(["new", "old2", "busy", "settled:1"]);
    const replied = threads.map((thread) => (thread.id === "old2" ? { ...thread, latestAttentionAt: LATER - 1, lastReadAt: LATER - 1 } : thread));
    expect(ids({ threads: replied })).toEqual(["old2", "new", "busy", "settled:1"]);
  });

  it("has no place in Pinned, whose threads never settle", () => {
    const pinned = [makeThread({ id: "p", pinnedAt: T0, isPinned: true })];
    expect(rowIds(viewOf({ threads: pinned, now: T0 + 30 * DAY }), "pinned")).toEqual(["p"]);
  });

  it("is hidden with the rest of a collapsed group", () => {
    expect(ids({ prefs: { collapsedProjects: ["proj_a"] } })).toEqual([]);
  });

  it("opens and closes through openSettledFolds, which the server keeps for every window", () => {
    const prefs = { ...defaultPreferences(), openSettledFolds: ["other"] };
    const closed: SettledRow = { type: "settled", key: "k", groupId: "project:proj_a", count: 2, expanded: false };
    expect(toggleSettled(closed, prefs).patch).toEqual({ openSettledFolds: ["other", "project:proj_a"] });
    expect(toggleSettled({ ...closed, expanded: true }, { ...prefs, openSettledFolds: ["other", "project:proj_a"] }).patch).toEqual({
      openSettledFolds: ["other"],
    });
  });
});

describe("the focused thread in a settled tree", () => {
  const recent = (id: string, at: number) => makeThread({ id, createdAt: at, latestAttentionAt: at, lastReadAt: at });
  const child = (id: string, parent: string, at: number) => makeThread({ id, parentThreadId: parent, createdAt: at });
  // old1 has five children, so an open chip keeps three and folds two.
  const threads = [
    recent("new", LATER - HOUR),
    recent("old1", T0 + 20),
    child("c1", "old1", T0 + 11),
    child("c2", "old1", T0 + 12),
    child("c3", "old1", T0 + 13),
    child("c4", "old1", T0 + 14),
    child("c5", "old1", T0 + 15),
    child("c1a", "c1", T0 + 16),
    recent("old2", T0 + 1),
    { ...recent("busy", T0), ...working },
  ];
  const MODES: Record<OrganizationMode, string> = { project: "project:proj_a", chronological: "threads", machine: "machine:host_1" };
  const modes = Object.entries(MODES) as [OrganizationMode, string][];
  const ids = (mode: OrganizationMode, scenario: Partial<Scenario> = {}) =>
    rowIds(viewOf({ threads, now: LATER, ...scenario, prefs: { organizationMode: mode, ...scenario.prefs } }), MODES[mode]);
  const rowOf = (mode: OrganizationMode, scenario: Partial<Scenario>, id: string) =>
    viewOf({ threads, now: LATER, ...scenario, prefs: { organizationMode: mode, ...scenario.prefs } })
      .groups.flatMap((group) => group.rows)
      .find((row): row is ThreadRow => row.type === "thread" && row.info.thread.id === id)!;
  // The path the auto-expand opens to a focused child.
  const reveal = (id: string) => new Map([[id, "reveal" as const]]);

  it.each(modes)("stays in place inside the open fold, root or child, in bright rows (%s)", (mode, group) => {
    const open = { openSettledFolds: [group] };
    const before = ["new", "busy", "settled:2", "old1", "old2"];
    expect(ids(mode, { prefs: open })).toEqual(before);
    expect(ids(mode, { prefs: open, activeThreadId: "old2" })).toEqual(before);
    expect(ids(mode, { prefs: open, activeThreadId: "old1" })).toEqual(before);
    expect(rowOf(mode, { prefs: open, activeThreadId: "old2" }, "old2").dimmed).toBe(false);
    const expanded = { ...open, expandedChildren: ["old1"] };
    const tree = ["new", "busy", "settled:2", "old1", "c3", "c4", "c5", "older:2", "old2"];
    expect(ids(mode, { prefs: expanded })).toEqual(tree);
    expect(ids(mode, { prefs: expanded, activeThreadId: "c4", targets: reveal("c4") })).toEqual(tree);
    expect(rowOf(mode, { prefs: expanded, activeThreadId: "c4" }, "c4").dimmed).toBe(false);
  });

  it.each(modes)("under a closed fold, shows only the path from its root down to it, and keeps the count (%s)", (mode, group) => {
    expect(ids(mode)).toEqual(["new", "busy", "settled:2"]);
    expect(ids(mode, { activeThreadId: "old2" })).toEqual(["new", "busy", "settled:2", "old2"]);
    // A focused root shows alone, without its children.
    expect(ids(mode, { activeThreadId: "old1", prefs: { expandedChildren: ["old1"] } })).toEqual(["new", "busy", "settled:2", "old1"]);
    // No sibling and no "N more child threads" row, whether the chips were opened or the path revealed.
    const path = ["new", "busy", "settled:2", "old1", "c1", "c1a"];
    expect(ids(mode, { activeThreadId: "c1a", targets: reveal("c1a") })).toEqual(path);
    expect(ids(mode, { activeThreadId: "c1a", prefs: { expandedChildren: ["old1", "c1"] } })).toEqual(path);
    expect(ids(mode, { activeThreadId: "c4", prefs: { expandedChildren: ["old1"], expandedOlder: ["old1"] } })).toEqual([
      "new",
      "busy",
      "settled:2",
      "old1",
      "c4",
    ]);
    // Every ancestor shows, even where a closed chip hides the focused child in the open fold.
    expect(ids(mode, { activeThreadId: "c1a" })).toEqual(path);
    const clustered = threads.map((thread) =>
      thread.parentThreadId === "old1" ? makeThread({ ...thread, environment: { id: "wt", isWorktree: true, branchName: "f" } }) : thread,
    );
    const folder = { environmentGrouping: true, collapsedEnvironments: ["wt"], expandedChildren: ["old1"] };
    expect(ids(mode, { threads: clustered, activeThreadId: "c1a", prefs: { ...folder, openSettledFolds: [group] } })).not.toContain("c1a");
    expect(ids(mode, { threads: clustered, activeThreadId: "c1a", prefs: folder })).toEqual(path);
    const focused = rowOf(mode, { activeThreadId: "c1a", targets: reveal("c1a") }, "c1a");
    expect(focused).toMatchObject({ dimmed: false, depth: 2 });
  });

  it.each(modes)("goes back behind the closed fold, or stays in the open one, when focus moves on (%s)", (mode, group) => {
    for (const next of ["new", "busy", null]) {
      expect(ids(mode, { activeThreadId: next })).toEqual(["new", "busy", "settled:2"]);
      expect(ids(mode, { activeThreadId: next, prefs: { openSettledFolds: [group] } })).toEqual(["new", "busy", "settled:2", "old1", "old2"]);
    }
  });

  it.each(modes)("leaves the fold on activity while focused (%s)", (mode) => {
    const active = threads.map((thread) => (thread.id === "old2" ? { ...thread, ...working } : thread));
    expect(ids(mode, { threads: active, activeThreadId: "old2" })).toEqual(["new", "old2", "busy", "settled:1"]);
    const failed = threads.map((thread) => (thread.id === "c1a" ? { ...thread, status: "error" as const, latestAttentionAt: LATER - 1 } : thread));
    expect(ids(mode, { threads: failed, activeThreadId: "c1a", targets: reveal("c1a") })).toContain("old1");
    expect(ids(mode, { threads: failed, activeThreadId: "c1a", targets: reveal("c1a") }).at(-1)).toBe("settled:1");
    const queued = threads.map((thread) => (thread.id === "old2" ? { ...thread, queuedWork: "waiting" as const } : thread));
    expect(ids(mode, { threads: queued, activeThreadId: "old2" })).toEqual(["new", "old2", "busy", "settled:1"]);
  });

  it.each(modes)("keeps a held tree in its place, uncounted, until it moves into the fold (%s)", (mode) => {
    expect(ids(mode, { activeThreadId: "old2", held: ["old2"] })).toEqual(["new", "old2", "busy", "settled:1"]);
    expect(ids(mode, { held: ["old2"] })).toEqual(["new", "old2", "busy", "settled:1"]);
  });
});

describe("the hold on a tree that settles while focused", () => {
  const recent = (id: string, at: number) => makeThread({ id, createdAt: at, latestAttentionAt: at, lastReadAt: at });
  const base = [
    recent("new", LATER - HOUR),
    recent("old1", T0 + 2),
    recent("old2", T0 + 1),
    makeThread({ id: "elsewhere", projectId: "proj_b", createdAt: T0 }),
  ];
  // old2 finished unread at T0 + 10 and has been left since.
  const unread = base.map((thread) => (thread.id === "old2" ? { ...thread, ...finishedUnread } : thread));
  const step = (previous: SettleHold | null, scenario: Scenario, mode: OrganizationMode = "project") =>
    holdSettled(previous, forestOf(scenario).trees, settleOf(scenario), (root) =>
      groupIdForRoot(root.thread, { mode, projects: [makeProject("proj_a"), makeProject("proj_b")] }),
    );

  it("holds nothing on the first build, so a reload draws a focused settled tree in the fold", () => {
    expect(step(null, { threads: base, now: LATER, activeThreadId: "old2" }).held.size).toBe(0);
  });

  it("holds nothing when a settled thread is opened", () => {
    const first = step(null, { threads: base, now: LATER });
    expect(step(first, { threads: base, now: LATER, activeThreadId: "old2" }).held.size).toBe(0);
  });

  it.each(["project", "chronological", "machine"] as const)(
    "holds an unread old thread that settles on opening until focus leaves its group's settled trees (%s)",
    (mode) => {
      const first = step(null, { threads: unread, now: LATER }, mode);
      expect(first.settled.has("old2")).toBe(false);
      // Opening reads it: it settles, and is held where it was.
      const opened = step(first, { threads: unread, now: LATER, activeThreadId: "old2" }, mode);
      expect([...opened.held]).toEqual(["old2"]);
      expect(step(opened, { threads: unread, now: LATER, activeThreadId: "old2" }, mode).held.has("old2")).toBe(true);
      // bb marks it read, which leaves it settled.
      const read = step(opened, { threads: base, now: LATER, activeThreadId: "old2" }, mode);
      expect(read.held.has("old2")).toBe(true);
      // Focus on another settled tree in its group keeps the hold.
      const inFold = step(read, { threads: base, now: LATER, activeThreadId: "old1" }, mode);
      expect(inFold.held.has("old2")).toBe(true);
      // Focus on a live thread, or none, ends it.
      expect(step(inFold, { threads: base, now: LATER, activeThreadId: "new" }, mode).held.size).toBe(0);
      expect(step(inFold, { threads: base, now: LATER, activeThreadId: null }, mode).held.size).toBe(0);
    },
  );

  it("ends when focus moves to a settled tree in another group", () => {
    const first = step(null, { threads: unread, now: LATER });
    const opened = step(first, { threads: unread, now: LATER, activeThreadId: "old2" });
    expect(step(opened, { threads: base, now: LATER, activeThreadId: "elsewhere" }).held.size).toBe(0);
  });

  it("holds a focused tree whose Settle after period runs out, and a settled tree that settles again after activity", () => {
    const first = step(null, { threads: base, now: T0 + DAY - 1, activeThreadId: "old2" });
    expect(first.settled.has("old2")).toBe(false);
    expect([...step(first, { threads: base, now: LATER, activeThreadId: "old2" }).held]).toEqual(["old2"]);
    const busy = base.map((thread) => (thread.id === "old2" ? { ...thread, ...working } : thread));
    const woke = step(step(null, { threads: base, now: LATER, activeThreadId: "old2" }), { threads: busy, now: LATER, activeThreadId: "old2" });
    expect(woke.settled.has("old2")).toBe(false);
    expect([...step(woke, { threads: base, now: LATER, activeThreadId: "old2" }).held]).toEqual(["old2"]);
  });

  it("releases a held tree that stops being settled", () => {
    const first = step(null, { threads: unread, now: LATER });
    const opened = step(first, { threads: unread, now: LATER, activeThreadId: "old2" });
    const busy = unread.map((thread) => (thread.id === "old2" ? { ...thread, ...working } : thread));
    expect(step(opened, { threads: busy, now: LATER, activeThreadId: "old2" }).held.size).toBe(0);
  });
});

describe("Mark read over a tree", () => {
  it("covers every unread thread drawn in it, an archived one shown with Show archived threads included", () => {
    const threads = [
      makeThread({ id: "p" }),
      makeThread({ id: "a", parentThreadId: "p", createdAt: T0 + 1, isArchived: true, archivedAt: T0, ...finishedUnread }),
      makeThread({ id: "b", parentThreadId: "p", createdAt: T0 + 2, ...finishedUnread }),
    ];
    const forest = forestOf({ threads });
    const context = { activeThreadId: null, finishedAt: {}, seenAt: {} };
    expect(markReadPlanFor("p", forest, context).read.sort()).toEqual(["a", "b"]);
    expect(markAllReadPlan(forest.trees, context).read.sort()).toEqual(["a", "b"]);
    const onlyArchived = threads.filter((thread) => thread.id !== "b");
    const row = viewOf({ threads: onlyArchived, prefs: { showArchived: true } }).groups[0]!.rows[0]!;
    expect(row.type === "thread" && row.treeUnread).toBe(true);
  });
});
