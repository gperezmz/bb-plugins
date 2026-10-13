// Answer… or Grant… on a toast opens the Fleets page at a row's composer, which only the page can open: the toast
// records the request here and goes to the page, and the page takes it once a view fetched after the request has
// loaded. It is a pending open (`pending-open.ts`): a mounted Fleets page holds it while its view loads, and lets it go
// when it unmounts first. Each request is numbered, so the page knows which view came after it.
import { useSyncExternalStore } from "react";
import { PendingOpens } from "./pending-open";

/** The row whose composer to open, with the words to name it by once it has left the Inbox. */
export interface ComposerTarget {
  readonly fleet: string;
  readonly rowId: string;
  readonly ref: string;
  readonly what: string;
}

export interface ComposerRequest extends ComposerTarget {
  /** Counts every request made; a view fetched once this was made is one the request may be judged on. */
  readonly seq: number;
}

/** The Fleets page is the one place a composer request is taken. */
const PAGE = "fleets-page";
const requests = new PendingOpens<ComposerRequest>();
let seq = 0;

/** Records that the Fleets page is to open the composer of `target`'s row. A later request replaces it. */
export function requestComposer(target: ComposerTarget, nowMs: number = Date.now()): void {
  seq += 1;
  requests.request(PAGE, { ...target, seq }, nowMs);
}

/** The number of the latest request made, kept once it is taken: a view fetched from here on came after it. */
export function composerRequestSeq(): number {
  return seq;
}

/** The request waiting to be taken, null where none waits or it lapsed. */
export function pendingComposerRequest(nowMs: number = Date.now()): ComposerRequest | null {
  return requests.peek(PAGE, nowMs);
}

/** Keeps the request waiting however long the page's view takes to load: a mounted Fleets page holds it. */
export function holdComposerRequest(nowMs: number = Date.now()): void {
  requests.hold(PAGE, nowMs);
}

/** Gives a held request back its lifetime, from now: the page holding it unmounted before it could take it. */
export function releaseComposerRequest(nowMs: number = Date.now()): void {
  requests.release(PAGE, nowMs);
}

/** Spends the request numbered `requestSeq`, where it is still the one waiting. */
export function takeComposerRequest(requestSeq: number, nowMs: number = Date.now()): void {
  if (requests.peek(PAGE, nowMs)?.seq === requestSeq) requests.take(PAGE, nowMs);
}

/** The request where a view fetched as of request `asOf` came after it, so it may be judged on that view; else null. */
export function requestOnView(request: ComposerRequest | null, asOf: number | null): ComposerRequest | null {
  return request !== null && asOf !== null && asOf >= request.seq ? request : null;
}

/** True where a fetch started as of request `failedAsOf` failed after `request` was made: the request is dropped. */
export function failsRequest(request: ComposerRequest, failedAsOf: number): boolean {
  return failedAsOf >= request.seq;
}

/** The request waiting to be taken, redrawing whoever reads it when one is made or taken. */
export function useComposerRequest(): ComposerRequest | null {
  return useSyncExternalStore(requests.subscribe, () => pendingComposerRequest());
}

/** The number of the latest request made, redrawing whoever reads it when another is made. */
export function useComposerRequestSeq(): number {
  return useSyncExternalStore(requests.subscribe, composerRequestSeq);
}

/** Forgets every request. For tests. */
export function clearComposerRequests(): void {
  requests.clear();
}
