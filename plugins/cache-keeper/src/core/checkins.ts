/**
 * When a background command or subagent is due a check-in.
 *
 * A task stalls once it has had no output or progress for the no-output wait
 * W. While it stays stalled, each further check-in waits twice as long as the
 * one before (W, 2W, 4W…). While it keeps printing or making progress, it gets
 * a routine check-in every 30 minutes of running. A check-in restarts both
 * clocks; when both fall due together the stalled one is sent.
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

/** When the next routine check-in falls due. */
export function routineDueAt(clock: TaskClock): number {
  return Math.max(clock.startedAt, clock.lastCheckInAt ?? -Infinity) + ROUTINE_MS;
}

/** Quiet for the wait: no output or progress for W. */
export function isQuiet(clock: TaskClock, now: number, waitMs: number): boolean {
  return now - clock.lastActivityAt >= waitMs;
}

/** The check-in `clock` is due at `now`, or null. */
export function dueCheckIn(clock: TaskClock, now: number, waitMs: number): CheckInReason | null {
  if (now >= stalledDueAt(clock, waitMs)) return "stalled";
  if (!isQuiet(clock, now, waitMs) && now >= routineDueAt(clock)) return "routine";
  return null;
}

/** The earliest time a check-in could fall due, for the banner's countdown. */
export function nextCheckInAt(clock: TaskClock, now: number, waitMs: number): number {
  const stalled = stalledDueAt(clock, waitMs);
  const routine = routineDueAt(clock);
  return isQuiet(clock, now, waitMs) ? stalled : Math.min(stalled, routine);
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
