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
import type { ServerThread, ThreadGateway, ThreadPresence } from "./threads";
import { errorMessage } from "./error-message";

/** Lookups of threads missing from the listing in flight at once. */
const STRAY_LOOKUP_CONCURRENCY = 8;

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
 * The threads that have stored state but are missing from the listing, which
 * bb still has: one created while the listing was read, or one a page
 * boundary skipped. Rejects when bb cannot say, so nothing is forgotten on
 * a guess.
 */
async function findStrays(
  deps: StartupDeps,
  snapshot: readonly ServerThread[],
  archivedIds: ReadonlySet<string>,
): Promise<{ threads: (ServerThread | ThreadPresence)[]; archivedIds: Set<string> }> {
  const listed = new Set([...snapshot.map((thread) => thread.id), ...archivedIds]);
  const missing = [...new Set([...deps.lifecycle.all().keys(), ...deps.order.get()])].filter((id) => !listed.has(id));
  const threads: (ServerThread | ThreadPresence)[] = [...snapshot];
  const archived = new Set(archivedIds);
  for (let start = 0; start < missing.length; start += STRAY_LOOKUP_CONCURRENCY) {
    const found = await Promise.all(missing.slice(start, start + STRAY_LOOKUP_CONCURRENCY).map((id) => deps.threads.find(id)));
    for (const thread of found) {
      if (thread === undefined) continue;
      if (thread.archived) archived.add(thread.id);
      else threads.push(thread);
    }
  }
  return { threads, archivedIds: archived };
}

/**
 * Reads the threads bb has and brings the stored state in line with them:
 * `reconcileState`, then the archived set. What the listing missed is asked
 * of bb one thread at a time before anything is forgotten, inside the change
 * that writes, so no thread created meanwhile is forgotten either. Logs and
 * returns on failure, so the next start tries again.
 */
export async function reconcileWithBb(deps: StartupDeps): Promise<void> {
  try {
    const listing = Promise.all([deps.threads.snapshot(), deps.threads.archivedIds()]);
    deps.archived.listing(listing);
    const [snapshot, archivedIds] = await listing;
    deps.archived.replace(archivedIds);
    await deps.change(async (changed) => {
      const known = await findStrays(deps, snapshot, archivedIds);
      const result = reconcileState({ lifecycle: deps.lifecycle, order: deps.order }, known.threads, known.archivedIds);
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
