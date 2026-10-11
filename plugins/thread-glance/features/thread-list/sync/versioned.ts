// A whole value the server publishes with its version: a window keeps the
// highest version within one epoch, and a new epoch replaces what it held.
import type { Versioned } from "@/shared/signals";

/** Whether `incoming` should replace `held`. */
export function isNewer<T>(held: Versioned<T> | null, incoming: Versioned<T>): boolean {
  return held === null || held.epoch !== incoming.epoch || incoming.version > held.version;
}

/** The newer of the two. */
export function newer<T>(held: Versioned<T> | null, incoming: Versioned<T>): Versioned<T> {
  return isNewer(held, incoming) ? incoming : (held as Versioned<T>);
}
