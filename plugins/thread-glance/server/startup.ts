// Work done once per server start, in a background service because `bb.sdk`
// is bind-gated in the factory.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ChangeRecords } from "./actions";
import type { ArchivedThreads } from "./archived";
import { removeLegacyData } from "./legacy-cleanup";
import type { Database } from "./database";
import type { LifecycleStore } from "./lifecycle-store";
import type { OrderStore } from "./order-store";
import { reconcileState } from "./reconcile";
import type { ThreadGateway } from "./threads";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export interface StartupDeps {
  bb: Pick<BbPluginApi, "storage" | "log">;
  db: Database;
  threads: ThreadGateway;
  lifecycle: LifecycleStore;
  order: OrderStore;
  archived: ArchivedThreads;
  change: ChangeRecords;
  orderChanged(): void;
}

/**
 * Reads the threads bb has and brings the stored state in line with them:
 * `reconcileState`, then the archived set. Logs and returns on failure, so
 * the next start tries again.
 */
export async function reconcileWithBb(deps: StartupDeps): Promise<void> {
  try {
    const listing = Promise.all([deps.threads.snapshot(), deps.threads.archivedIds()]);
    deps.archived.listing(listing);
    const [snapshot, archivedIds] = await listing;
    deps.archived.replace(archivedIds);
    await deps.change(async (changed) => {
      const result = reconcileState({ lifecycle: deps.lifecycle, order: deps.order }, snapshot, archivedIds);
      changed(result.rows);
      if (result.orderChanged) deps.orderChanged();
    });
  } catch (error) {
    deps.bb.log.warn(`could not reconcile with bb's threads: ${errorMessage(error)}`);
  }
}

/**
 * The `startup` service: removes the earlier list's data, reconciles with
 * bb's threads once, then waits for `signal` to abort.
 */
export async function runStartup(deps: StartupDeps, signal: AbortSignal): Promise<void> {
  try {
    await removeLegacyData({ storage: deps.bb.storage, log: deps.bb.log }, deps.db);
  } catch (error) {
    deps.bb.log.warn(`could not remove the earlier list's data: ${errorMessage(error)}`);
  }
  await reconcileWithBb(deps);
  await waitForAbort(signal);
}
