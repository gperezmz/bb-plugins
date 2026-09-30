// Which threads bb holds as archived, as far as the server has heard: the
// startup listing, then `thread.archived` and `thread.unarchived`. `sync`
// leaves their thread records out; the records themselves stay stored.

export interface ArchivedThreads {
  /** Whether `threadId` is archived; false for every thread until the startup listing arrived. */
  has(threadId: string): boolean;
  /**
   * Resolves once the startup listing arrived or failed, or at once when no
   * listing is under way, and after LISTING_WAIT_MS at most, so a full `sync`
   * right after a server start leaves out what the listing names.
   */
  listed(): Promise<void>;
  /** Marks the startup listing under way until `listing` settles. */
  listing(listing: Promise<unknown>): void;
  archive(threadId: string): void;
  unarchive(threadId: string): void;
  /**
   * Takes the startup listing of archived threads. Events that arrived while
   * it was read win over it: a thread archived since is kept, and one
   * unarchived or deleted since is left out.
   */
  replace(threadIds: Iterable<string>): void;
}

/** Longest a full `sync` waits for the startup listing; past it, archived records go out with the rest. */
const LISTING_WAIT_MS = 3_000;

export function createArchivedThreads(): ArchivedThreads {
  const archived = new Set<string>();
  let pending: Promise<void> | null = null;
  // What events said since the server started, which a listing read before
  // them cannot overrule.
  const heard = new Map<string, boolean>();
  return {
    has: (threadId) => archived.has(threadId),
    listed() {
      if (pending === null) return Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, LISTING_WAIT_MS)));
      return Promise.race([pending, waited]).finally(() => clearTimeout(timer));
    },
    listing(listing) {
      const current: Promise<void> = listing.then(
        () => {
          if (pending === current) pending = null;
        },
        () => {
          if (pending === current) pending = null;
        },
      );
      pending = current;
    },
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
