/**
 * When a background command or subagent is due a check-in.
 *
 * A task stalls once it has had no output or progress for the no-output wait
 * W. While it stays stalled, each further check-in waits twice as long as the
 * one before (W, 2W, 4W…). A task that keeps printing or making progress gets
 * no turn of its own: once it has run 30 minutes, the thread's next keep-warm
 * also asks the agent to look at it, and again every 30 minutes after.
 */

export const ROUTINE_MS = 30 * 60_000;

/** One task's clocks. */
export interface TaskClock {
  startedAt: number;
  /** Last output (a command) or progress event (a subagent). */
  lastActivityAt: number;
  lastCheckInAt: number | null;
  /** Stalled check-ins sent since its last activity. */
  stalledStreak: number;
}

export type CheckInReason = "stalled" | "routine";

/** When the next stalled check-in falls due. */
export function stalledDueAt(clock: TaskClock, waitMs: number): number {
  const since = Math.max(clock.lastActivityAt, clock.lastCheckInAt ?? -Infinity);
  return since + waitMs * 2 ** clock.stalledStreak;
}

/** When the task is next folded into a keep-warm. */
export function routineDueAt(clock: TaskClock): number {
  return Math.max(clock.startedAt, clock.lastCheckInAt ?? -Infinity) + ROUTINE_MS;
}

/** Stalled: no output or progress for the no-output wait W. */
export function isStalled(clock: TaskClock, now: number, waitMs: number): boolean {
  return now - clock.lastActivityAt >= waitMs;
}

/** Whether `clock`'s task is due a check-in of its own at `now`: it has stalled. */
export function dueCheckIn(clock: TaskClock, now: number, waitMs: number): boolean {
  return now >= stalledDueAt(clock, waitMs);
}

/** Whether the thread's next keep-warm should ask about `clock`'s task: running 30 minutes since it was last looked at, and not stalled. */
export function foldDue(clock: TaskClock, now: number, waitMs: number): boolean {
  return !isStalled(clock, now, waitMs) && now >= routineDueAt(clock);
}

/** The clock after a check-in for `reason` was sent at `at`. */
export function afterCheckIn(clock: TaskClock, reason: CheckInReason, at: number): TaskClock {
  return { ...clock, lastCheckInAt: at, stalledStreak: reason === "stalled" ? clock.stalledStreak + 1 : 0 };
}

/** The clock after output or progress seen at `at`. */
export function afterActivity(clock: TaskClock, at: number): TaskClock {
  if (at <= clock.lastActivityAt) return clock;
  return { ...clock, lastActivityAt: at, stalledStreak: 0 };
}
