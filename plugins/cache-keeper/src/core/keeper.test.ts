import { describe, expect, it } from "vitest";
import { afterActivity, afterCheckIn, dueCheckIn, foldDue, type TaskClock } from "./checkins";
import { newIdleStretch, pastCostStop, plan, scheduledBeyondStop, type KeeperInput } from "./keeper";

const MIN = 60_000;
const rates = { w: 10e-6, r: 0.5e-6, o: 25e-6 };

const base = (over: Partial<KeeperInput> = {}): KeeperInput => ({
  now: 59 * MIN,
  claudeCode: true,
  status: "idle",
  hasPendingInteraction: false,
  waiting: false,
  tasks: [],
  deadline: 59 * MIN,
  context: 300_000,
  compactOn: true,
  line: 140_000,
  stretch: newIdleStretch(0),
  checkIns: true,
  waitMs: 15 * MIN,
  ...over,
});

describe("plan: compaction", () => {
  it("compacts at the deadline an idle thread over its line", () => {
    expect(plan(base())).toMatchObject({ compactionDue: true, action: { kind: "compact" } });
  });

  it("is due but waits before the deadline", () => {
    expect(plan(base({ now: 30 * MIN }))).toMatchObject({ compactionDue: true, action: null });
  });

  it("does not send once the cache has gone cold", () => {
    expect(plan(base({ now: 60 * MIN }))).toMatchObject({ compactionDue: false, action: null });
  });

  it.each([
    ["switched off", { compactOn: false }],
    ["under the line", { context: 100_000 }],
    ["line never", { line: null }],
    ["working", { status: "active" }],
    ["pending interaction", { hasPendingInteraction: true }],
    ["another provider", { claudeCode: false }],
    ["skipped", { stretch: { ...newIdleStretch(0), compactSkipped: true } }],
    ["compacted this stretch", { stretch: { ...newIdleStretch(0), compactedAt: 1 } }],
  ] as [string, Partial<KeeperInput>][])("does nothing when %s", (_name, over) => {
    expect(plan(base(over)).action).toBeNull();
  });

  it("never compacts a waiting thread", () => {
    expect(plan(base({ waiting: true }))).toMatchObject({ compactionDue: false, action: null });
  });

  it("wakes at the deadline of a compaction due", () => {
    expect(plan(base({ now: 30 * MIN })).wakeAt).toBe(59 * MIN);
  });
});

describe("plan: check-ins", () => {
  const clock: TaskClock = { startedAt: 0, lastActivityAt: 0, lastCheckInAt: null, stalledStreak: 0 };
  const waiting = (over: Partial<KeeperInput> = {}) => base({ compactOn: false, waiting: true, tasks: [{ kind: "command", id: "b1", clock }], ...over });

  it("checks in on a stalled task as soon as it stalls, whatever Skip says", () => {
    expect(plan(waiting({ now: 14 * MIN }))).toMatchObject({ action: null, wakeAt: 15 * MIN });
    expect(plan(waiting({ now: 15 * MIN, stretch: { ...newIdleStretch(0), warmSkipped: true } })).action).toEqual({ kind: "check-in", tasks: ["b1"] });
  });

  it("does not check in while working, on a question, or with the setting off", () => {
    expect(plan(waiting({ now: 16 * MIN, status: "active" })).action).toBeNull();
    expect(plan(waiting({ now: 16 * MIN, hasPendingInteraction: true })).action).toBeNull();
    expect(plan(waiting({ now: 16 * MIN, checkIns: false })).action).toBeNull();
  });
});

describe("the cost stop", () => {
  it("stops once charges and the next keep-warm's forecast pass one cold rewrite of the context", () => {
    const stop = rates.w * 300_000;
    expect(pastCostStop(stop - 0.2, 0.1, rates, 300_000)).toBe(false);
    expect(pastCostStop(stop - 0.05, 0.1, rates, 300_000)).toBe(true);
    expect(pastCostStop(100, 1, null, 300_000)).toBe(false);
  });

  it("skips keep-warms for a scheduled message due after the cost stop", () => {
    // A read of 300k each: 20 keep-warms reach the stop, 59-minute intervals put it ~20 h out.
    const input = (h: number) => ({
      items: [{ kind: "scheduled" as const, dueAt: 59 * MIN + h * 3_600_000, createdAt: 0 }],
      chargedUsd: 0,
      forecastUsd: rates.r * 300_000,
      rates,
      context: 300_000,
      deadline: 59 * MIN,
      lifetimeMs: 60 * MIN,
    });
    expect(scheduledBeyondStop(input(30))).toBe(true);
    expect(scheduledBeyondStop(input(2))).toBe(false);
  });
});

describe("check-in clocks", () => {
  const W = 15 * MIN;
  it("doubles the wait while a task stays stalled", () => {
    let clock: TaskClock = { startedAt: 0, lastActivityAt: 0, lastCheckInAt: null, stalledStreak: 0 };
    expect(dueCheckIn(clock, W - 1, W)).toBe(false);
    expect(dueCheckIn(clock, W, W)).toBe(true);
    clock = afterCheckIn(clock, "stalled", W);
    expect(dueCheckIn(clock, W + 2 * W - 1, W)).toBe(false);
    expect(dueCheckIn(clock, W + 2 * W, W)).toBe(true);
    clock = afterCheckIn(clock, "stalled", 3 * W);
    expect(dueCheckIn(clock, 3 * W + 4 * W, W)).toBe(true);
    // Output resets the streak.
    clock = afterActivity(clock, 4 * W);
    expect(clock.stalledStreak).toBe(0);
  });

  it("folds a task that keeps printing into a keep-warm every 30 minutes, and never sends it a turn of its own", () => {
    const clock: TaskClock = { startedAt: 0, lastActivityAt: 29 * MIN, lastCheckInAt: null, stalledStreak: 0 };
    expect(foldDue(clock, 29 * MIN, W)).toBe(false);
    expect(foldDue(clock, 30 * MIN, W)).toBe(true);
    expect(dueCheckIn(clock, 30 * MIN, W)).toBe(false);
    expect(foldDue(afterCheckIn(clock, "routine", 30 * MIN), 44 * MIN, W)).toBe(false);
  });

  it("checks in on a stalled task rather than folding it", () => {
    const clock: TaskClock = { startedAt: 0, lastActivityAt: 10 * MIN, lastCheckInAt: null, stalledStreak: 0 };
    expect(foldDue(clock, 30 * MIN, W)).toBe(false);
    expect(dueCheckIn(clock, 30 * MIN, W)).toBe(true);
  });
});
