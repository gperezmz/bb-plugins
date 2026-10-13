// The fleet a manager thread's Fleet tab shows, remembered for each thread until bb's window reloads, so closing the
// tab or leaving the thread does not change it. A link that opens the Fleet tab for a fleet sets it, and the tab,
// open or mounting later, shows it; the panel's params stay the thread alone, so a thread keeps one Fleet tab.
import { useSyncExternalStore } from "react";

const shown = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Makes `fleet` the one the Fleet tab of `threadId` shows. */
export function showFleet(threadId: string, fleet: string): void {
  if (shown.get(threadId) === fleet) return;
  shown.set(threadId, fleet);
  for (const listener of [...listeners]) listener();
}

/** The fleet remembered for the Fleet tab of `threadId`; null where none is yet. */
export function shownFleetOf(threadId: string): string | null {
  return shown.get(threadId) ?? null;
}

/** The fleet remembered for the Fleet tab of `threadId`, redrawing whoever reads it when another is set. */
export function useShownFleet(threadId: string): string | null {
  return useSyncExternalStore(subscribe, () => shownFleetOf(threadId));
}

/** Forgets every fleet remembered. For tests. */
export function clearShownFleets(): void {
  shown.clear();
}
