// Parent and child relations among threads. Pure; threads come from bb's
// browser payload or the server's thread data alike.

/** What the tree helpers read from a thread. */
export interface TreeThread {
  id: string;
  parentThreadId: string | null;
}

/** The ids of the threads below `rootId`, breadth first, without `rootId`. A parent cycle ends where it closes. */
export function descendantIds(threads: readonly TreeThread[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const siblings = children.get(thread.parentThreadId);
    if (siblings === undefined) children.set(thread.parentThreadId, [thread.id]);
    else siblings.push(thread.id);
  }
  const seen = new Set([rootId]);
  const found: string[] = [];
  for (let next = 0, queue = [rootId]; next < queue.length; next += 1) {
    for (const childId of children.get(queue[next]!) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      found.push(childId);
      queue.push(childId);
    }
  }
  return found;
}

/** `rootId` and the ids below it: the thread tree under that thread. */
export function treeIds(threads: readonly TreeThread[], rootId: string): string[] {
  return [rootId, ...descendantIds(threads, rootId)];
}

/** The ids above `threadId`, nearest first, as far as `byId` knows the parents. A parent cycle ends where it closes. */
export function ancestorIds(byId: ReadonlyMap<string, TreeThread>, threadId: string): string[] {
  const found: string[] = [];
  const seen = new Set([threadId]);
  for (let parentId = byId.get(threadId)?.parentThreadId ?? null; parentId !== null && !seen.has(parentId); ) {
    seen.add(parentId);
    found.push(parentId);
    parentId = byId.get(parentId)?.parentThreadId ?? null;
  }
  return found;
}
