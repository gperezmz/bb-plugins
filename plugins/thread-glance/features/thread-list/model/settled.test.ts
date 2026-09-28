import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { defaultPreferences } from "@/shared/preferences";
import { failedUnread, finishedUnread, forestOf, makeThread, rowIds, settleOf, T0, viewOf, working, type Scenario } from "../testing/fixtures";
import { isSettledThread, isSettledTree, lastActivityAt, SETTLE_AFTER_MS } from "./settled";
import { markAllReadPlan, markReadPlanFor, toggleSettled } from "./toggles";
import type { SettledRow } from "./view";

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
    expect(settled({ threads: [onBranch()], prefs: never, now: T0 + 365 * DAY }, "t")).toBe(false);
  });

  it("settles by its activity alone, on a branch other than its project's default or while that is still being looked up", () => {
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

  it("draws the open thread's settled tree directly above the fold, leaving the fold as it was and every other row in place", () => {
    expect(ids({ activeThreadId: "old2" })).toEqual(["new", "busy", "old2", "settled:2"]);
    const open = { openSettledFolds: ["project:proj_a"] };
    expect(ids({ activeThreadId: "old2", prefs: open })).toEqual(["new", "busy", "old2", "settled:2", "old1"]);
    expect(ids({ activeThreadId: "old1c", prefs: { expandedChildren: ["old1"] } })).toEqual(["new", "busy", "old1", "old1c", "settled:2"]);
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
