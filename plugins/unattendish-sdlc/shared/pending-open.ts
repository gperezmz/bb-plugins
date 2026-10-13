// What one view asks of another that is not mounted yet, or has not loaded what the request is about: a link records
// the request here and navigates, and the view it names takes it once it can act on it. Every such request lives in a
// `PendingOpens`, so each lapses the same way: unless taken within `PENDING_OPEN_TTL_MS`, or held by a view mounted to
// take it. The Fleet tab's wish below is one; Review (`review-request.ts`) and a row's composer (`composer-request.ts`)
// are the others.

/** How long a recorded request stays good unless a mounted view holds it. */
export const PENDING_OPEN_TTL_MS = 10_000;

/** Requests of one kind, by where each is taken: one per key, a later request replacing it. */
export class PendingOpens<T> {
  private readonly requests = new Map<string, { readonly value: T; readonly expires: number }>();
  private readonly listeners = new Set<() => void>();

  /** Records `value` for `key`, replacing any request waiting there. */
  request(key: string, value: T, nowMs: number = Date.now()): void {
    this.requests.set(key, { value, expires: nowMs + PENDING_OPEN_TTL_MS });
    this.changed();
  }

  /** The request waiting for `key`; null where none waits or it lapsed. */
  peek(key: string, nowMs: number = Date.now()): T | null {
    const request = this.requests.get(key);
    return request === undefined || request.expires <= nowMs ? null : request.value;
  }

  /** The request waiting for `key`, spent; null where none waits or it lapsed. */
  take(key: string, nowMs: number = Date.now()): T | null {
    const value = this.peek(key, nowMs);
    if (this.requests.delete(key)) this.changed();
    return value;
  }

  /** Keeps the request for `key` waiting while a view mounted to take it waits for what it needs. */
  hold(key: string, nowMs: number = Date.now()): void {
    const value = this.peek(key, nowMs);
    if (value !== null) this.requests.set(key, { value, expires: Infinity });
  }

  /** Gives a held request for `key` back its lifetime, from now, once the view holding it goes. */
  release(key: string, nowMs: number = Date.now()): void {
    const request = this.requests.get(key);
    if (request?.expires === Infinity) this.requests.set(key, { value: request.value, expires: nowMs + PENDING_OPEN_TTL_MS });
  }

  /** Calls `listener` whenever a request is recorded or spent; returns its removal, as `useSyncExternalStore` takes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Forgets every request. For tests. */
  clear(): void {
    this.requests.clear();
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

// A manager's Fleet tab can only be opened from that thread's own view, so a card on the Fleets page records the wish
// here, navigates to the thread, and the Fleet chip mounting in that thread's header takes it.
const fleetTabs = new PendingOpens<true>();

/** Records that the Fleet tab of `threadId` is to be opened when that thread's header mounts. */
export function requestFleetTab(threadId: string, nowMs: number = Date.now()): void {
  fleetTabs.request(threadId, true, nowMs);
}

/** True once for a wish recorded for `threadId` and not yet lapsed; the wish is spent. */
export function takeFleetTab(threadId: string, nowMs: number = Date.now()): boolean {
  return fleetTabs.take(threadId, nowMs) !== null;
}

/** Forgets every wish. For tests. */
export function clearFleetTabWishes(): void {
  fleetTabs.clear();
}
