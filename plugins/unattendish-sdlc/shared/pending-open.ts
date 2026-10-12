// A manager's Fleet tab can only be opened from that thread's own view, so a card on
// the Fleets page records the wish here, navigates to the thread, and the Fleet chip
// mounting in that thread's header takes it. It lapses if the thread never mounts a chip.

/** How long a recorded wish stays good. */
export const PENDING_OPEN_TTL_MS = 10_000;

const wishes = new Map<string, number>();

/** Records that the Fleet tab of `threadId` is to be opened when that thread's header mounts. */
export function requestFleetTab(threadId: string, nowMs: number = Date.now()): void {
  wishes.set(threadId, nowMs + PENDING_OPEN_TTL_MS);
}

/** True once for a wish recorded for `threadId` and not yet lapsed; the wish is spent. */
export function takeFleetTab(threadId: string, nowMs: number = Date.now()): boolean {
  const expires = wishes.get(threadId);
  wishes.delete(threadId);
  return expires !== undefined && expires > nowMs;
}

/** Forgets every wish. For tests. */
export function clearFleetTabWishes(): void {
  wishes.clear();
}
