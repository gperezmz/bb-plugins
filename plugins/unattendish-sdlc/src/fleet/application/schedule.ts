// Which fleets are due, the workflows that run behind a fleet's queue, and
// the retention the ledger keeps.
import { repoId } from "../domain/identity";
import { messageOf } from "../domain/redact";
import { effectiveInterval, isDue } from "../domain/registration";
import { pollFleet, type PollDeps } from "./poll";
import type { Store } from "./ports";
import { SerialQueue } from "./serial";

/** The ledger keeps what it saw for this long. */
export const RETENTION_MS = 30 * 24 * 3_600_000;

/**
 * Polls every fleet whose interval has run out, each behind any other work on
 * the same fleet. A fleet still being worked on is left to the next call.
 * Every poll starts before this returns; the promise it returns settles when
 * the polls it started have, and a caller that need not wait for them does not.
 */
export async function pollDue(deps: PollDeps, queue: SerialQueue): Promise<void> {
  const now = deps.clock.now().toISOString();
  const due = deps.store.listFleets().filter((fleet) => isDue(fleet.lastPolledAt, now, effectiveInterval(fleet.registration)));
  const started: Promise<void>[] = [];
  for (const fleet of due) {
    const key = repoId(fleet.registration.repo);
    if (queue.busy(key)) continue;
    started.push(queue.run(key, () => pollFleet(deps, key)).then(() => undefined, (error: unknown) => deps.log.warn(`polling ${key} failed: ${messageOf(error, deps.credentials.secrets())}`)));
  }
  await Promise.all(started);
}

/**
 * The manager's turn ended: reads the state of the items its manifest now
 * names, for every fleet it holds, so a change between now and the next poll
 * is a change. Each read runs behind other work on its fleet.
 */
export async function refreshFleetsOf(deps: PollDeps, queue: SerialQueue, threadId: string): Promise<void> {
  const held = deps.store.listFleets().filter((fleet) => fleet.registration.managerThreadId === threadId);
  await Promise.all(
    held.map((fleet) => {
      const key = repoId(fleet.registration.repo);
      return queue.run(key, () => pollFleet(deps, key, { stateOnly: true })).then(() => undefined, (error: unknown) => deps.log.warn(`reading ${key} after a turn failed: ${messageOf(error, deps.credentials.secrets())}`));
    }),
  );
}

/** Sets a fleet's poll interval, or back to the default with null. False, and nothing set, when no fleet holds the repository. */
export function setFleetInterval(deps: { readonly store: Store }, repo: string, intervalMs: number | null): boolean {
  if (deps.store.getFleet(repo) === null) return false;
  deps.store.setIntervalMs(repo, intervalMs);
  return true;
}

export function pruneLedger(deps: Pick<PollDeps, "store" | "clock">): void {
  deps.store.prune(new Date(deps.clock.now().getTime() - RETENTION_MS).toISOString());
}
