// Review opens the Fleet tab on a fleet at what needs reviewing, which only the tab knows: whatever offers Review records
// the request here, names the fleet to show and opens the tab, and the tab takes the request once that fleet has
// loaded, or at once where it is already open on it. It is a pending open (`pending-open.ts`), and lapses as one does.
import { useSyncExternalStore } from "react";
import { PENDING_OPEN_TTL_MS, PendingOpens } from "./pending-open";

/** How long a recorded request stays good. */
export const REVIEW_REQUEST_TTL_MS = PENDING_OPEN_TTL_MS;

/** By thread: the fleet to review. */
const requests = new PendingOpens<string>();

/** Records that the Fleet tab of `threadId` is to open `fleet` at what needs reviewing. A later request replaces it. */
export function requestReview(threadId: string, fleet: string, nowMs: number = Date.now()): void {
  requests.request(threadId, fleet, nowMs);
}

/** True once for a request recorded for `fleet` in `threadId` and not yet lapsed; the request is spent. */
export function takeReview(threadId: string, fleet: string, nowMs: number = Date.now()): boolean {
  if (requests.peek(threadId, nowMs) !== fleet) return false;
  return requests.take(threadId, nowMs) !== null;
}

/** Whether a request for `fleet` in `threadId` waits to be taken, redrawing whoever reads it when one is recorded. */
export function useReviewRequested(threadId: string, fleet: string): boolean {
  return useSyncExternalStore(requests.subscribe, () => requests.peek(threadId) === fleet);
}

/** Forgets every request. For tests. */
export function clearReviewRequests(): void {
  requests.clear();
}
