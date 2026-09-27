import { describe, expect, it } from "vitest";
import { afterActivity, afterCheckIn, dueCheckIn, type TaskClock } from "./checkins";
import { newStretch, plan, type KeeperInput } from "./keeper";

const MIN = 60_000;
const rates = { w: 10e-6, r: 0.5e-6, o: 25e-6 };

const base = (over: Partial<KeeperInput> = {}): KeeperInput => ({
  now: 59 * MIN,
  claudeCode: true,
  status: "idle",
  hasPendingInteraction: false,
  waiting: false,
  items: [],
  tasks: [],
  deadline: 59 * MIN,
  lifetimeMs: 60 * MIN,
  context: 300_000,
  rates,
  compactOn: true,
  line: 140_000,
  stretch: newStretch(0),
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
    ["skipped", { stretch: { ...newStretch(0), compactSkipped: true } }],
    ["compacted this stretch", { stretch: { ...newStretch(0), compactedAt: 1 } }],
  ] as [string, Partial<KeeperInput>][])("does nothing when %s", (_name, over) => {
    expect(plan(base(over)).action).toBeNull();
  });

  it("never compacts a waiting thread", () => {
    const waiting = base({ waiting: true, items: [{ kind: "queued", createdAt: 0 }] });
    expect(plan(waiting)).toMatchObject({ compactionDue: false, warmDue: true, action: { kind: "keep-warm" } });
    expect(plan({ ...waiting, checkIns: false })).toMatchObject({ compactionDue: false, warmDue: false, action: null });
  });
});

describe("plan: keep-warms and check-ins", () => {
  const waiting = (over: Partial<KeeperInput> = {}) =>
    base({ compactOn: false, waiting: true, items: [{ kind: "child", id: "thr_c", title: "c", startedAt: 0 }], ...over });

  it("keeps warm at the deadline", () => {
    expect(plan(waiting()).action).toEqual({ kind: "keep-warm" });
    expect(plan(waiting({ now: 10 * MIN }))).toMatchObject({ warmDue: true, nextWarmAt: 59 * MIN, action: null });
  });

  it("stops at the cost stop and after Skip", () => {
    expect(plan(waiting({ stretch: { ...newStretch(0), warmSpentUsd: rates.w * 300_000 } })).warmDue).toBe(false);
    expect(plan(waiting({ stretch: { ...newStretch(0), warmSkipped: true } })).warmDue).toBe(false);
    expect(plan(waiting({ hasPendingInteraction: true })).warmDue).toBe(false);
  });

  it("sends a stalled task a check-in before its deadline", () => {
    const clock: TaskClock = { startedAt: 0, lastActivityAt: 0, lastCheckInAt: null, stalledStreak: 0 };
    const p = plan(waiting({ now: 16 * MIN, tasks: [{ kind: "command", id: "b1", clock }] }));
    expect(p.action).toEqual({ kind: "check-in", tasks: [{ id: "b1", reason: "stalled" }] });
  });

  it("skips keep-warms for a scheduled message due after the cost stop", () => {
    // 20 keep-warms at one read each reach the stop; 59-minute intervals put it ~20 h out.
    const due = (h: number) => [{ kind: "scheduled" as const, dueAt: 59 * MIN + h * 3_600_000, createdAt: 0 }];
    expect(plan(waiting({ items: due(30) })).warmDue).toBe(false);
    expect(plan(waiting({ items: due(2) })).warmDue).toBe(true);
  });
});

describe("check-in clocks", () => {
  const W = 15 * MIN;
  it("doubles the wait while a task stays stalled", () => {
    let clock: TaskClock = { startedAt: 0, lastActivityAt: 0, lastCheckInAt: null, stalledStreak: 0 };
    expect(dueCheckIn(clock, W - 1, W)).toBeNull();
    expect(dueCheckIn(clock, W, W)).toBe("stalled");
    clock = afterCheckIn(clock, "stalled", W);
    expect(dueCheckIn(clock, W + 2 * W - 1, W)).toBeNull();
    expect(dueCheckIn(clock, W + 2 * W, W)).toBe("stalled");
    clock = afterCheckIn(clock, "stalled", 3 * W);
    expect(dueCheckIn(clock, 3 * W + 4 * W, W)).toBe("stalled");
    // Output resets the streak.
    clock = afterActivity(clock, 4 * W);
    expect(clock.stalledStreak).toBe(0);
  });

  it("checks in every 30 minutes on a task that keeps printing", () => {
    const clock: TaskClock = { startedAt: 0, lastActivityAt: 29 * MIN, lastCheckInAt: null, stalledStreak: 0 };
    expect(dueCheckIn(clock, 30 * MIN, W)).toBe("routine");
    expect(dueCheckIn(afterCheckIn(clock, "routine", 30 * MIN), 44 * MIN, W)).toBeNull();
  });

  it("sends the stalled check-in when both fall due", () => {
    const clock: TaskClock = { startedAt: 0, lastActivityAt: 10 * MIN, lastCheckInAt: null, stalledStreak: 0 };
    expect(dueCheckIn(clock, 30 * MIN, W)).toBe("stalled");
  });
});
