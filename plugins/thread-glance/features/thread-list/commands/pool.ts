// A bounded pool: runs a task per item, at most a number of them at once.

/**
 * Runs `task` for every item, never more than `limit` at once, starting each
 * as one before it settles. Resolves once every task has settled; a task
 * that rejects is its own caller's to report.
 */
export async function inPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await Promise.resolve()
        .then(() => task(item))
        .catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
