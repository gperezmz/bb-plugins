// Review in the Fleet chip's hover card opens the Fleet tab at what needs reviewing, which only the tab knows: the chip
// records the request here and opens the tab, and the tab takes it once its fleet has loaded, or at once where it is
// already open. A request lapses if no tab takes it in time.
import { useSyncExternalStore } from "react";

/** How long a recorded request stays good. */
export const REVIEW_REQUEST_TTL_MS = 10_000;

const requests = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records that the Fleet tab of `threadId` is to open at what needs reviewing. */
export function requestReview(threadId: string, nowMs: number = Date.now()): void {
  requests.set(threadId, nowMs + REVIEW_REQUEST_TTL_MS);
  for (const listener of [...listeners]) listener();
}

/** True once for a request recorded for `threadId` and not yet lapsed; the request is spent. */
export function takeReview(threadId: string, nowMs: number = Date.now()): boolean {
  const expires = requests.get(threadId);
  requests.delete(threadId);
  return expires !== undefined && expires > nowMs;
}

/** Whether a request for `threadId` waits to be taken, redrawing whoever reads it when one is recorded. */
export function useReviewRequested(threadId: string): boolean {
  return useSyncExternalStore(subscribe, () => requests.has(threadId));
}

/** Forgets every request. For tests. */
export function clearReviewRequests(): void {
  requests.clear();
}
