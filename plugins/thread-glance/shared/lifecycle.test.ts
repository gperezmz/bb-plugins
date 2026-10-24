import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import {
  activeRow,
  clearStaleMark,
  clearStaleMarks,
  hasManualMark,
  hasMark,
  isEmptyRow,
  isWoke,
  liftedIds,
  markShelf,
  nextWakeAt,
  parkedRow,
  sameRow,
  settledRow,
  shelfOf,
  shouldClearForPin,
  snoozedRow,
  staleMark,
  treeSignals,
  wakeReason,
  waitingBelow,
  type ShelfOptions,
  type ShelfThread,
} from "./lifecycle";

const HOUR = 3_600_000;
const NOW = 1_000 * HOUR;

const thread = (overrides: Partial<ShelfThread> = {}): ShelfThread => ({
  hasPendingInteraction: false,
  queuedWork: "none",
  status: "idle",
  runtimeStatus: "idle",
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  isPinned: false,
  latestAttentionAt: NOW - 100 * HOUR,
  createdAt: NOW - 100 * HOUR,
  updatedAt: NOW - 100 * HOUR,
  ...overrides,
});

const recent = (overrides: Partial<ShelfThread> = {}) =>
  thread({ latestAttentionAt: NOW - HOUR, updatedAt: NOW - HOUR, createdAt: NOW - HOUR, ...overrides });

const options = (overrides: Partial<ShelfOptions> = {}): ShelfOptions => ({
  now: NOW,
  workingShelf: false,
  inactiveShelf: true,
  hoursBeforeInactive: 6,
  ...overrides,
});

describe("rows", () => {
  it("writes exclusive marks", () => {
    expect(parkedRow(5)).toMatchObject({ parkedAt: 5, settledAt: null, snoozeUntil: null, activeOverride: false });
    expect(snoozedRow(9, 5)).toMatchObject({ snoozeUntil: 9, snoozedAt: 5, parkedAt: null });
    expect(settledRow(5, "auto")).toMatchObject({ settledAt: 5, settledKind: "auto" });
    expect(isEmptyRow(activeRow())).toBe(false);
  });

  it("compares rows, a missing row being an empty one", () => {
    expect(sameRow(null, undefined)).toBe(true);
    expect(sameRow(parkedRow(1), parkedRow(1))).toBe(true);
    expect(sameRow(parkedRow(1), parkedRow(2))).toBe(false);
  });

  it("counts a park, a snooze and a settle of either kind as a mark, and the active override as none", () => {
    expect([parkedRow(1), snoozedRow(9, 1), settledRow(1, "manual"), settledRow(1, "auto")].map(hasMark)).toEqual([true, true, true, true]);
    expect(hasMark(activeRow())).toBe(false);
    expect(hasMark(null)).toBe(false);
  });

  it("counts a manual settle and the active override as manual marks, not an automatic settle", () => {
    expect(hasManualMark(settledRow(1, "manual"))).toBe(true);
    expect(hasManualMark(activeRow())).toBe(true);
    expect(hasManualMark(settledRow(1, "auto"))).toBe(false);
    expect(hasManualMark(parkedRow(1))).toBe(false);
    expect(hasManualMark(null)).toBe(false);
  });
});

describe("markShelf (rules 1 to 6)", () => {
  it("puts a thread with no row in Active (1)", () => {
    expect(markShelf(null, thread(), NOW)).toBe("active");
  });

  it("puts a busy thread in Active whatever its row says (2)", () => {
    for (const row of [parkedRow(NOW - HOUR), snoozedRow(NOW + HOUR, NOW - HOUR), settledRow(NOW - HOUR, "manual")]) {
      expect(markShelf(row, thread({ status: "active" }), NOW)).toBe("active");
      expect(markShelf(row, thread({ hasPendingInteraction: true }), NOW)).toBe("active");
    }
  });

  it("keeps a thread whose only sign of life is a running monitor out of the shelves", () => {
    expect(markShelf(parkedRow(NOW - HOUR), thread({ runtimeStatus: "active" }), NOW)).toBe("active");
  });

  it("parks a parked thread unless attention arrived after it was parked (3)", () => {
    const row = parkedRow(NOW - 10 * HOUR);
    expect(markShelf(row, thread({ latestAttentionAt: NOW - 20 * HOUR }), NOW)).toBe("parked");
    expect(markShelf(row, thread({ latestAttentionAt: NOW - 10 * HOUR }), NOW)).toBe("parked");
    expect(markShelf(row, thread({ latestAttentionAt: NOW - 9 * HOUR }), NOW)).toBe("active");
  });

  it("keeps a snoozed thread asleep until it wakes (4)", () => {
    const row = snoozedRow(NOW + HOUR, NOW - HOUR);
    expect(markShelf(row, thread(), NOW)).toBe("snoozed");
    expect(markShelf(row, thread(), NOW + HOUR)).toBe("active");
    expect(markShelf(row, thread({ latestAttentionAt: NOW - 30 * 60_000 }), NOW)).toBe("active");
  });

  it("settles a settled thread unless attention arrived after it was settled (5)", () => {
    const row = settledRow(NOW - 10 * HOUR, "manual");
    expect(markShelf(row, thread(), NOW)).toBe("settled");
    expect(markShelf(row, thread({ latestAttentionAt: NOW - HOUR }), NOW)).toBe("active");
  });

  it("puts everything else in Active (6)", () => {
    expect(markShelf(activeRow(), thread(), NOW)).toBe("active");
  });
});

describe("a question waiting below (lifted)", () => {
  it("puts a lifted thread in Active whatever its row says", () => {
    for (const row of [parkedRow(NOW - HOUR), snoozedRow(NOW + HOUR, NOW - HOUR), settledRow(NOW - HOUR, "manual")]) {
      expect(markShelf(row, thread(), NOW, true)).toBe("active");
      expect(markShelf(row, thread(), NOW)).not.toBe("active");
    }
  });

  it("shows a snoozed thread that still sleeps as woke by its child, and gives its row's own reason first", () => {
    const row = snoozedRow(NOW + 5 * HOUR, NOW - HOUR);
    expect(wakeReason(row, thread(), NOW, true)).toBe("child");
    expect(isWoke(row, thread(), NOW, true)).toBe(true);
    expect(wakeReason(row, thread(), NOW + 5 * HOUR, true)).toBe("time");
    expect(wakeReason(row, thread({ latestAttentionAt: NOW }), NOW, true)).toBe("attention");
    expect(wakeReason(row, thread(), NOW, false)).toBeNull();
  });

  it("shows no marker on a thread that is not snoozed, however it is lifted", () => {
    expect(wakeReason(parkedRow(1), thread(), NOW, true)).toBeNull();
    expect(wakeReason(settledRow(1, "manual"), thread(), NOW, true)).toBeNull();
    expect(wakeReason(null, thread(), NOW, true)).toBeNull();
  });

  it("returns a thread to its shelf with its row as it was once nothing waits below", () => {
    const parked = parkedRow(NOW - 10 * HOUR);
    const snoozed = snoozedRow(NOW + HOUR, NOW - HOUR);
    expect(shelfOf(parked, thread(), options({ lifted: true }))).toBe("active");
    expect(shelfOf(parked, thread(), options({ lifted: false }))).toBe("parked");
    expect(shelfOf(snoozed, thread(), options({ lifted: true }))).toBe("active");
    expect(shelfOf(snoozed, thread(), options())).toBe("snoozed");
  });

  it("keeps a lifted snoozed thread out of Working and Inactive", () => {
    const row = snoozedRow(NOW + HOUR, NOW - 90 * HOUR);
    expect(shelfOf(row, thread(), options({ lifted: true }))).toBe("active");
    expect(shelfOf(row, thread(), options({ lifted: true, workingShelf: true, tree: { working: true, needsYou: false } }))).toBe("active");
    // A tree that is working without anything in it needing the user, as when the asker is a pinned child.
    expect(shelfOf(null, thread(), options({ lifted: true, workingShelf: true, tree: { working: true, needsYou: false } }))).toBe("active");
    expect(shelfOf(null, thread(), options({ lifted: false, workingShelf: true, tree: { working: true, needsYou: false } }))).toBe("working");
    expect(shelfOf(null, thread(), options({ lifted: true }))).toBe("active");
    expect(shelfOf(null, thread(), options())).toBe("inactive");
  });

  it("names the threads with a question or approval waiting below them, not the asker itself", () => {
    const tree = [
      { id: "root", parentThreadId: null, ...thread() },
      { id: "kid", parentThreadId: "root", ...thread() },
      { id: "grandkid", parentThreadId: "kid", ...thread({ hasPendingInteraction: true }) },
      { id: "other", parentThreadId: null, ...thread() },
    ];
    expect([...liftedIds(tree)].sort()).toEqual(["kid", "root"]);
    expect(waitingBelow(tree, "root")?.id).toBe("grandkid");
    expect(waitingBelow(tree, "kid")?.id).toBe("grandkid");
    expect(waitingBelow(tree, "grandkid")).toBeUndefined();
    expect(waitingBelow(tree, "other")).toBeUndefined();
  });
});

describe("wake detection", () => {
  const row = snoozedRow(NOW + 5 * HOUR, NOW - HOUR);

  it("wakes at the time or on attention after the snooze, and not for a row that is not a snooze", () => {
    expect(wakeReason(row, thread(), NOW)).toBeNull();
    expect(wakeReason(row, thread(), NOW + 5 * HOUR)).toBe("time");
    expect(wakeReason(row, thread({ latestAttentionAt: NOW }), NOW)).toBe("attention");
    expect(wakeReason(parkedRow(1), thread(), NOW)).toBeNull();
    expect(wakeReason(null, thread(), NOW)).toBeNull();
    expect(isWoke(row, thread(), NOW + 6 * HOUR)).toBe(true);
  });

  it("stays woke after the time passed, so every window and a reload agree", () => {
    expect(isWoke(row, thread(), NOW + 100 * HOUR)).toBe(true);
  });

  it("finds the soonest wake still ahead", () => {
    expect(nextWakeAt([snoozedRow(NOW + 3, 0), snoozedRow(NOW + 1, 0), snoozedRow(NOW - 1, 0), parkedRow(1)], NOW)).toBe(NOW + 1);
    expect(nextWakeAt([parkedRow(1)], NOW)).toBeNull();
  });
});

describe("stale marks", () => {
  it("names the parked or settled mark attention made stale, and clears only it", () => {
    const parked = parkedRow(NOW - 10 * HOUR);
    const fresh = thread({ latestAttentionAt: NOW - HOUR });
    expect(staleMark(parked, fresh)).toBe("parked");
    expect(clearStaleMark(parked, fresh)).toMatchObject({ parkedAt: null });
    expect(staleMark(settledRow(NOW - 10 * HOUR, "auto"), fresh)).toBe("settled");
    expect(clearStaleMark(settledRow(NOW - 10 * HOUR, "auto"), fresh)).toMatchObject({ settledAt: null, settledKind: null });
    expect(staleMark(parked, thread())).toBeNull();
    expect(staleMark(snoozedRow(NOW + HOUR, NOW - 10 * HOUR), fresh)).toBeNull();
    expect(clearStaleMark(null, fresh)).toBeNull();
  });

  it("clears stale marks across rows, dropping a row that becomes empty", () => {
    const rows = new Map([
      ["parked", parkedRow(NOW - 10 * HOUR)],
      ["quiet", parkedRow(NOW - 10 * HOUR)],
      ["unknown", parkedRow(1)],
    ]);
    const threads = new Map([
      ["parked", { latestAttentionAt: NOW }],
      ["quiet", { latestAttentionAt: NOW - 20 * HOUR }],
    ]);
    expect([...clearStaleMarks(rows, threads)]).toEqual([["parked", null]]);
  });
});

describe("shelfOf", () => {
  it("puts a pinned thread on Pinned whatever its row says", () => {
    expect(shelfOf(settledRow(NOW - 10 * HOUR, "manual"), thread({ isPinned: true }), options())).toBe("pinned");
    expect(shelfOf(null, recent({ isPinned: true }), options())).toBe("pinned");
  });

  it("asks a window to clear the row of a pinned thread", () => {
    expect(shouldClearForPin(parkedRow(1), { isPinned: true })).toBe(true);
    expect(shouldClearForPin(null, { isPinned: true })).toBe(false);
    expect(shouldClearForPin(parkedRow(1), { isPinned: false })).toBe(false);
  });

  it("returns a parked thread with new attention to Active", () => {
    expect(shelfOf(parkedRow(NOW - 10 * HOUR), recent(), options())).toBe("active");
  });

  it("moves an idle thread to Inactive after the hours set, and not before", () => {
    expect(shelfOf(null, thread({ latestAttentionAt: NOW - 6 * HOUR, updatedAt: NOW - 6 * HOUR, createdAt: NOW - 6 * HOUR }), options())).toBe("inactive");
    expect(shelfOf(null, thread({ latestAttentionAt: NOW - 5 * HOUR, updatedAt: NOW - 5 * HOUR, createdAt: NOW - 5 * HOUR }), options())).toBe("active");
  });

  it("measures activity from the latest of created, updated and latest attention", () => {
    expect(shelfOf(null, thread({ updatedAt: NOW - HOUR }), options())).toBe("active");
    expect(shelfOf(null, thread({ createdAt: NOW - HOUR }), options())).toBe("active");
    expect(shelfOf(null, thread({ latestAttentionAt: NOW - HOUR }), options())).toBe("active");
  });

  it("leaves Inactive off when the setting is off", () => {
    expect(shelfOf(null, thread(), options({ inactiveShelf: false }))).toBe("active");
  });

  it("keeps a thread that asks a question in Active after 7 hours with Inactive at 6", () => {
    expect(shelfOf(null, thread({ hasPendingInteraction: true }), options())).toBe("active");
  });

  it("keeps a busy thread in Active and a woke thread out of Inactive", () => {
    expect(shelfOf(null, thread({ status: "active" }), options())).toBe("active");
    const woke = snoozedRow(NOW - 50 * HOUR, NOW - 60 * HOUR);
    expect(isWoke(woke, thread(), NOW)).toBe(true);
    expect(shelfOf(woke, thread(), options())).toBe("active");
  });

  it("moves a thread whose tree is working to Working, unless it is woke or something in the tree needs the user", () => {
    const working = recent({ status: "active" });
    expect(shelfOf(null, working, options({ workingShelf: true }))).toBe("working");
    expect(shelfOf(null, working, options({ workingShelf: false }))).toBe("active");
    expect(shelfOf(null, recent(), options({ workingShelf: true, tree: { working: true, needsYou: false } }))).toBe("working");
    expect(shelfOf(null, recent(), options({ workingShelf: true, tree: { working: true, needsYou: true } }))).toBe("active");
    const woke = snoozedRow(NOW - HOUR, NOW - 2 * HOUR);
    expect(shelfOf(woke, working, options({ workingShelf: true }))).toBe("active");
  });

  it("does not move a thread that needs the user to Working", () => {
    expect(
      shelfOf(null, recent({ status: "active", hasPendingInteraction: true }), options({ workingShelf: true })),
    ).toBe("active");
  });

  it("reads a tree's signals", () => {
    const a = thread({ status: "active" });
    const b = thread({ hasPendingInteraction: true });
    expect(treeSignals([thread(), a])).toEqual({ working: true, needsYou: false });
    expect(treeSignals([a, b])).toEqual({ working: true, needsYou: true });
  });

  it("puts settled, snoozed and parked threads on their shelves", () => {
    expect(shelfOf(settledRow(NOW - 10 * HOUR, "manual"), thread(), options())).toBe("settled");
    expect(shelfOf(snoozedRow(NOW + HOUR, NOW - HOUR), thread(), options())).toBe("snoozed");
    expect(shelfOf(parkedRow(NOW - HOUR), thread(), options())).toBe("parked");
  });
});

describe("bb's browser thread", () => {
  it("is a shelf thread as it is: the rules read its fields by their own names", () => {
    const asShelfThread = (browserThread: PluginSidebarThread): ShelfThread => browserThread;
    expect(asShelfThread).toBeTypeOf("function");
  });
});
