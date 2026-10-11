// Running work a few items at a time. Pure.

/**
 * Runs `work` on `items`, `size` at a time, each batch finishing before the
 * next starts. Resolves to the results in the order of `items`; rejects with
 * the first failure of a batch.
 */
export async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  }
  return results;
}
