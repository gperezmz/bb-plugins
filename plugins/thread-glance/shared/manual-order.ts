// Manual order: one list of thread ids that Active, Working and Inactive
// follow. The server stores it; these pure helpers change it. An id can appear
// once, and a thread missing from the list sorts above the listed ones, newest
// first, so a thread the list has not heard of yet still appears at the top.

/** `order` without repeated ids, keeping each id's first place. */
export function dedupeOrder(order: readonly string[]): string[] {
  return [...new Set(order)];
}

/** `order` with the ids it lacks put at the top, in the sequence given. */
export function insertAtTop(order: readonly string[], threadIds: readonly string[]): string[] {
  const listed = new Set(order);
  const added = dedupeOrder(threadIds).filter((threadId) => !listed.has(threadId));
  return added.length === 0 ? [...order] : [...added, ...order];
}

/**
 * `order` after the threads of `subset` were put in a new sequence. The places
 * the subset's members held in `order` are refilled with them in the new
 * sequence, so threads outside the subset keep their places. Ids of `subset`
 * that `order` does not list are ignored.
 */
export function applySubsetOrder(order: readonly string[], subset: readonly string[]): string[] {
  const listed = new Set(order);
  const sequence = dedupeOrder(subset).filter((threadId) => listed.has(threadId));
  const members = new Set(sequence);
  let next = 0;
  return order.map((threadId) => (members.has(threadId) ? sequence[next++]! : threadId));
}

/** What the order helpers read from a thread. */
export interface OrderedThread {
  id: string;
  createdAt: number;
}

/**
 * `order` reconciled with the live threads: ids of threads that are gone are
 * dropped, and live threads the list lacks go to the top, newest first.
 */
export function reconcileOrder(order: readonly string[], live: readonly OrderedThread[]): string[] {
  const liveIds = new Set(live.map((thread) => thread.id));
  const kept = dedupeOrder(order).filter((threadId) => liveIds.has(threadId));
  const listed = new Set(kept);
  const missing = live
    .filter((thread) => !listed.has(thread.id))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map((thread) => thread.id);
  return [...missing, ...kept];
}

/** `threads` sorted by `order`; those it lacks come first, newest first. */
export function sortByManualOrder<T extends OrderedThread>(threads: readonly T[], order: readonly string[]): T[] {
  const place = new Map(order.map((threadId, index) => [threadId, index]));
  const unlisted = threads
    .filter((thread) => !place.has(thread.id))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const listed = threads.filter((thread) => place.has(thread.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  return [...unlisted, ...listed];
}

/**
 * `ids` with `threadId` moved one place up (-1) or down (1), or null when it
 * is not there or already first or last. A keyboard move uses it on the
 * threads that share the row's list.
 */
export function moveByOne(ids: readonly string[], threadId: string, direction: -1 | 1): string[] | null {
  const from = ids.indexOf(threadId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const moved = [...ids];
  [moved[from], moved[to]] = [moved[to]!, moved[from]!];
  return moved;
}
