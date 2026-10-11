// Which Hover card is open: one at a time in the window, so opening a row's
// closes any other's.
import { useSyncExternalStore } from "react";

let openId: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (next === openId) return;
  openId = next;
  for (const listener of [...listeners]) listener();
}

export function setHoverCardOpen(threadId: string, open: boolean): void {
  if (open) set(threadId);
  else if (openId === threadId) set(null);
}

/** Whether the thread's Hover card is the open one; a row renders only when its own answer changes. */
export function useHoverCardOpen(threadId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => openId === threadId,
    () => false,
  );
}

/** Closes whichever card is open, as the tests do between cases. */
export function closeHoverCards(): void {
  set(null);
}
