// Brings the stored state in line with the threads bb has: forgets what
// belongs to threads that are gone, clears the marks attention made stale, and
// lists every visible thread in Manual order.
import { clearStaleMarks, type ShelfThread } from "../shared/lifecycle";
import { reconcileOrder } from "../shared/manual-order";
import type { LifecycleStore } from "./lifecycle-store";
import type { OrderStore } from "./order-store";

export interface ReconcileResult {
  /** Threads whose lifecycle row changed or went. */
  rows: string[];
  /** Whether the manual order changed. */
  orderChanged: boolean;
}

/** The lifecycle rows to clear because attention made their parked or settled mark stale, for threads in `threads`. */
export function clearStaleRows(
  lifecycle: LifecycleStore,
  threads: ReadonlyMap<string, Pick<ShelfThread, "latestAttentionAt">>,
): string[] {
  return lifecycle.putMany(clearStaleMarks(lifecycle.all(), threads));
}

/**
 * `threads` are the threads bb has that are not archived, hidden ones
 * included; `archivedIds` the archived ones. Rows of threads in neither are
 * forgotten, stale marks cleared, and the manual order holds exactly the
 * visible threads, new ones at the top.
 */
export function reconcileState(
  stores: { lifecycle: LifecycleStore; order: OrderStore },
  threads: readonly (Pick<ShelfThread, "latestAttentionAt" | "createdAt"> & { id: string; hidden: boolean })[],
  archivedIds: ReadonlySet<string>,
): ReconcileResult {
  const live = new Set([...threads.map((thread) => thread.id), ...archivedIds]);
  const rows = new Set(stores.lifecycle.prune(live));
  for (const threadId of clearStaleRows(stores.lifecycle, new Map(threads.map((thread) => [thread.id, thread])))) {
    rows.add(threadId);
  }
  const before = stores.order.get();
  stores.order.replace(reconcileOrder(before, threads.filter((thread) => !thread.hidden)));
  const after = stores.order.get();
  return {
    rows: [...rows],
    orderChanged: before.length !== after.length || before.some((threadId, index) => threadId !== after[index]),
  };
}
