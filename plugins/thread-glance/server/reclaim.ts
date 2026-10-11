// Reclaim: after a park, snooze or settle, stop what the thread no longer
// needs. This module is the seam the lifecycle actions call; `createReclaimer`
// is where the runtime stop and the terminal closing are built.
import type { LifecycleRow } from "../shared/lifecycle";
import { EMPTY_RECLAIM, type ReclaimReport } from "../shared/reclaim-note";

/** A thread to reclaim and the row the action wrote for it, which it must still hold. */
export interface ReclaimTarget {
  threadId: string;
  row: LifecycleRow;
}

/**
 * Reclaims the threads and reports what it did. The caller has written their
 * rows; an implementation reclaims a thread only while it is still unpinned,
 * not busy, and its row still equals `row`. It never rejects the action: a
 * failure reports less.
 */
export type Reclaimer = (targets: readonly ReclaimTarget[]) => Promise<ReclaimReport>;

/** The reclaimer until Reclaim is built: reclaims nothing. */
export const createReclaimer = (): Reclaimer => async () => EMPTY_RECLAIM;
