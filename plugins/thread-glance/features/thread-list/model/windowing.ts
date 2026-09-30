// Row windowing: bb's contract for rows that are not mounted. Pure.

export interface NavTarget {
  threadId: string;
  projectId: string;
}

/**
 * The value of `data-sidebar-windowed-nav` on a spacer standing in for rows
 * that are not mounted: `threadId:projectId` pairs in visual order,
 * space-separated. This is an undocumented host contract in bb 0.43.4; a test
 * pins it.
 */
export function windowedNavValue(targets: readonly NavTarget[]): string {
  return targets.map((target) => `${target.threadId}:${target.projectId}`).join(" ");
}
