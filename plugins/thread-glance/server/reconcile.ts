// Brings the stored state in line with the threads bb has: forgets what
// belongs to threads that are gone, clears the marks attention made stale, and
// lists every visible thread in Manual order.
import { clearStaleMarks, heldIds, holdAttention, type HoldThread, type LifecycleRow, type ShelfThread } from "../shared/lifecycle";
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

/** A thread as the hold rules read it; the parent and the pending question are absent for a thread bb was only asked about. */
export type HoldCandidate = Pick<ShelfThread, "latestAttentionAt"> & {
  id: string;
  parentThreadId?: string | null;
  hasPendingInteraction?: boolean;
};

/**
 * The rows whose mark a waiting question holds, with the attention their
 * threads just had set aside, and the ids of the threads held (`turnsHeld`
 * adds threads whose turn began while one waited). `threads` are the visible
 * ones; a thread that is missing a field the rule reads is left out.
 */
export function holdRows(
  rows: ReadonlyMap<string, LifecycleRow>,
  threads: readonly HoldCandidate[],
  turnsHeld: ReadonlySet<string> = new Set(),
): { rows: [string, LifecycleRow][]; held: Set<string> } {
  const known = threads.filter((thread): thread is HoldThread => thread.parentThreadId !== undefined && thread.hasPendingInteraction !== undefined);
  const byId = new Map(known.map((thread) => [thread.id, thread]));
  const held = heldIds(rows, known, turnsHeld);
  const changed = [...held].flatMap((threadId): [string, LifecycleRow][] => {
    const row = rows.get(threadId)!;
    const next = holdAttention(row, byId.get(threadId)!.latestAttentionAt);
    return next === row ? [] : [[threadId, next]];
  });
  return { rows: changed, held };
}

/**
 * `threads` are the threads bb has that are not archived, hidden ones
 * included; `archivedIds` the archived ones. Rows of threads in neither are
 * forgotten, the attention a waiting question holds back is set aside, stale
 * marks cleared, and the manual order holds exactly the visible threads, new
 * ones at the top.
 */
export function reconcileState(
  stores: { lifecycle: LifecycleStore; order: OrderStore },
  threads: readonly (HoldCandidate & Pick<ShelfThread, "createdAt"> & { hidden: boolean })[],
  archivedIds: ReadonlySet<string>,
): ReconcileResult {
  const live = new Set([...threads.map((thread) => thread.id), ...archivedIds]);
  const rows = new Set(stores.lifecycle.prune(live));
  for (const threadId of stores.lifecycle.putMany(holdRows(stores.lifecycle.all(), threads.filter((thread) => !thread.hidden)).rows)) rows.add(threadId);
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
