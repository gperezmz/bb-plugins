// Answer… or Grant… on a toast opens the Fleets page at a row's composer, which only the page can open: the toast
// records the request here and goes to the page, and the page takes it once a view fetched after the request has
// loaded, or at once where it is already open. Each request is numbered, so the page knows which view came after it.
// A request lapses if no Fleets page holds it in time.
import { useSyncExternalStore } from "react";

/** How long a recorded request stays good before a Fleets page holds it. */
export const COMPOSER_REQUEST_TTL_MS = 10_000;

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

let seq = 0;
let pending: { readonly request: ComposerRequest; readonly expires: number } | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records that the Fleets page is to open the composer of `target`'s row. A later request replaces it. */
export function requestComposer(target: ComposerTarget, nowMs: number = Date.now()): void {
  seq += 1;
  pending = { request: { ...target, seq }, expires: nowMs + COMPOSER_REQUEST_TTL_MS };
  changed();
}

/** The number of the latest request made, kept once it is taken: a view fetched from here on came after it. */
export function composerRequestSeq(): number {
  return seq;
}

/** The request waiting to be taken, null where none waits or it lapsed before a page held it. */
export function pendingComposerRequest(nowMs: number = Date.now()): ComposerRequest | null {
  if (pending === null || pending.expires <= nowMs) return null;
  return pending.request;
}

/** Keeps the request waiting however long the page's view takes to load: a mounted Fleets page holds it. */
export function holdComposerRequest(nowMs: number = Date.now()): void {
  if (pending !== null && pendingComposerRequest(nowMs) !== null) pending = { request: pending.request, expires: Infinity };
}

/** Spends the request numbered `requestSeq`, where it is still the one waiting. */
export function takeComposerRequest(requestSeq: number): void {
  if (pending?.request.seq !== requestSeq) return;
  pending = null;
  changed();
}

/** The request waiting to be taken, redrawing whoever reads it when one is made or taken. */
export function useComposerRequest(): ComposerRequest | null {
  return useSyncExternalStore(subscribe, () => pendingComposerRequest());
}

/** The number of the latest request made, redrawing whoever reads it when another is made. */
export function useComposerRequestSeq(): number {
  return useSyncExternalStore(subscribe, composerRequestSeq);
}

/** Forgets every request. For tests. */
export function clearComposerRequests(): void {
  pending = null;
}
