// When each working thread was first seen working. bb says that a thread
// works, not since when, so the list keeps its own stamp: the first sight of
// a thread working stamps it, the first sight of it idle clears it, and a
// stamp last confirmed too long ago (the window was closed, or asleep)
// starts again. Pure; the store keeps the stamps and writes them to the
// device.

export interface WorkingStamp {
  /** When the thread was first seen working in this stretch of work. */
  since: number;
  /** When it was last seen working. */
  seenAt: number;
}

export type WorkingStamps = Readonly<Record<string, WorkingStamp>>;

/** A stamp not confirmed for this long is a pause: the next sight starts a new one. */
export const WORKING_PAUSE_MS = 10 * 60_000;

/** A stamp is confirmed (and written) no more often than this. */
export const WORKING_CONFIRM_MS = 60_000;

/** The most stamps kept on a device. */
export const MAX_WORKING_STAMPS = 500;

export const NO_STAMPS: WorkingStamps = {};

/**
 * The stamps after seeing `workingIds` at `now`: threads not working lose
 * theirs. Returns `stamps` itself when nothing changed.
 */
export function observeWorking(stamps: WorkingStamps, workingIds: Iterable<string>, now: number): WorkingStamps {
  const next: Record<string, WorkingStamp> = {};
  let changed = false;
  let count = 0;
  for (const id of workingIds) {
    if (count >= MAX_WORKING_STAMPS) break;
    count += 1;
    const held = stamps[id];
    if (held === undefined || now - held.seenAt > WORKING_PAUSE_MS) {
      next[id] = { since: now, seenAt: now };
      changed = true;
    } else if (now - held.seenAt >= WORKING_CONFIRM_MS) {
      next[id] = { since: held.since, seenAt: now };
      changed = true;
    } else {
      next[id] = held;
    }
  }
  if (!changed && count === Object.keys(stamps).length) return stamps;
  return next;
}

/** The stamps in a stored value, ignoring anything malformed. */
export function readWorkingStamps(stored: unknown): WorkingStamps {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return NO_STAMPS;
  const stamps: Record<string, WorkingStamp> = {};
  for (const [id, value] of Object.entries(stored)) {
    if (Object.keys(stamps).length >= MAX_WORKING_STAMPS) break;
    if (value === null || typeof value !== "object") continue;
    const { since, seenAt } = value as Record<string, unknown>;
    if (typeof since === "number" && Number.isFinite(since) && typeof seenAt === "number" && Number.isFinite(seenAt)) {
      stamps[id] = { since, seenAt };
    }
  }
  return stamps;
}
