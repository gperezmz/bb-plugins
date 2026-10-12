// Which fleets are due, and the retention the ledger keeps.
import { repoId } from "../domain/identity";
import { effectiveInterval, isDue } from "../domain/registration";
import { pollFleet, type PollDeps } from "./poll";
import { SerialQueue } from "./serial";

/** The ledger keeps what it saw for this long. */
export const RETENTION_MS = 30 * 24 * 3_600_000;

/** Polls every fleet whose interval has run out, each in turn behind any poll or refresh of the same fleet. */
export async function pollDue(deps: PollDeps, queue: SerialQueue): Promise<void> {
  const now = deps.clock.now().toISOString();
  const due = deps.store.listFleets().filter((fleet) => isDue(fleet.lastPolledAt, now, effectiveInterval(fleet.registration)));
  await Promise.all(
    due.map((fleet) => {
      const key = repoId(fleet.registration.repo);
      return queue.run(key, () => pollFleet(deps, key)).catch((error: unknown) => deps.log.warn(`polling ${key} failed: ${error instanceof Error ? error.message : String(error)}`));
    }),
  );
}

export function pruneLedger(deps: Pick<PollDeps, "store" | "clock">): void {
  deps.store.prune(new Date(deps.clock.now().getTime() - RETENTION_MS).toISOString());
}
