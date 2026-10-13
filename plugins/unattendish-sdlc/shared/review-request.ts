// Review opens the Fleet tab on a fleet at what needs reviewing, which only the tab knows: whatever offers Review records
// the request here, names the fleet to show and opens the tab, and the tab takes the request once that fleet has
// loaded, or at once where it is already open on it. A request lapses if no tab takes it in time.
import { useSyncExternalStore } from "react";

/** How long a recorded request stays good. */
export const REVIEW_REQUEST_TTL_MS = 10_000;

/** By thread: the fleet to review and when the request lapses. */
const requests = new Map<string, { readonly fleet: string; readonly expires: number }>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records that the Fleet tab of `threadId` is to open `fleet` at what needs reviewing. A later request replaces it. */
export function requestReview(threadId: string, fleet: string, nowMs: number = Date.now()): void {
  requests.set(threadId, { fleet, expires: nowMs + REVIEW_REQUEST_TTL_MS });
  for (const listener of [...listeners]) listener();
}

/** True once for a request recorded for `fleet` in `threadId` and not yet lapsed; the request is spent. */
export function takeReview(threadId: string, fleet: string, nowMs: number = Date.now()): boolean {
  const request = requests.get(threadId);
  if (request === undefined || request.fleet !== fleet) return false;
  requests.delete(threadId);
  return request.expires > nowMs;
}

/** Whether a request for `fleet` in `threadId` waits to be taken, redrawing whoever reads it when one is recorded. */
export function useReviewRequested(threadId: string, fleet: string): boolean {
  return useSyncExternalStore(subscribe, () => requests.get(threadId)?.fleet === fleet);
}

/** Forgets every request. For tests. */
export function clearReviewRequests(): void {
  requests.clear();
}
