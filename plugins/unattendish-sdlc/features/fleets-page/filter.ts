// The fleet the queue is filtered to, kept while the operator leaves the Fleets page and comes back, as opening a
// fleet's Fleet tab makes them: the page unmounts when bb goes to the manager's thread. This store is its one owner.
import { useSyncExternalStore } from "react";

let remembered: string | null = null;
const changed = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  changed.add(listener);
  return () => changed.delete(listener);
}

/** The fleet the queue is filtered to; null for every fleet. */
export const rememberedFilter = (): string | null => remembered;

/** Filters the queue to `fleet`, or to every fleet with null, redrawing whoever reads it. */
export function rememberFilter(fleet: string | null): void {
  remembered = fleet;
  for (const listener of [...changed]) listener();
}

/** The filter, redrawing whoever reads it when it changes. */
export function useQueueFilter(): string | null {
  return useSyncExternalStore(subscribe, rememberedFilter);
}
