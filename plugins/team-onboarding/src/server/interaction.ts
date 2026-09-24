// Whether the engineer started the work in progress: a click in the page,
// not the schedule, RPC or the CLI. Only then may git use the
// machine's own credential helpers, which on a Mac can show a prompt.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<true>();

/** Runs `work` as started by the engineer. */
export function asEngineer<T>(work: () => Promise<T>): Promise<T> {
  return store.run(true, work);
}

/** Runs `work` as background work, even when an engineer's action started it. */
export function inBackground<T>(work: () => T): T {
  return store.exit(work);
}

export function byEngineer(): boolean {
  return store.getStore() === true;
}
