// Which threads bb holds as archived, as far as the server has heard: the
// startup listing, then `thread.archived` and `thread.unarchived`. `sync`
// leaves their thread records out; the records themselves stay stored.

export interface ArchivedThreads {
  /** Whether `threadId` is archived; false for every thread until the startup listing arrived. */
  has(threadId: string): boolean;
  archive(threadId: string): void;
  unarchive(threadId: string): void;
  /**
   * Takes the startup listing of archived threads. Events that arrived while
   * it was read win over it: a thread archived since is kept, and one
   * unarchived or deleted since is left out.
   */
  replace(threadIds: Iterable<string>): void;
}

export function createArchivedThreads(): ArchivedThreads {
  const archived = new Set<string>();
  // What events said since the server started, which a listing read before
  // them cannot overrule.
  const heard = new Map<string, boolean>();
  return {
    has: (threadId) => archived.has(threadId),
    archive(threadId) {
      heard.set(threadId, true);
      archived.add(threadId);
    },
    unarchive(threadId) {
      heard.set(threadId, false);
      archived.delete(threadId);
    },
    replace(threadIds) {
      archived.clear();
      for (const threadId of threadIds) if (heard.get(threadId) !== false) archived.add(threadId);
      for (const [threadId, isArchived] of heard) if (isArchived) archived.add(threadId);
    },
  };
}
