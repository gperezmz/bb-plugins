// Row windowing. Pure helpers; the observer lives in a hook.

export interface NavTarget {
  threadId: string;
  projectId: string;
}

/**
 * The value of `data-sidebar-windowed-nav` for an off-screen chunk:
 * `threadId:projectId` pairs in visual order, space-separated. This is an
 * undocumented host contract in bb 0.43.4; a test pins it.
 */
export function windowedNavValue(targets: readonly NavTarget[]): string {
  return targets.map((target) => `${target.threadId}:${target.projectId}`).join(" ");
}

/** Rows per windowed chunk. */
export const CHUNK_SIZE = 25;

/** Splits rows into fixed-size chunks, keeping their order. */
export function chunk<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
