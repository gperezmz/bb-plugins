// Row windowing: which items the list mounts for its view, and bb's contract
// for the rows it does not. Pure.
import { itemsBetween, type Layout } from "./layout";

/** Items are mounted this far above and below the view. */
const VIEW_MARGIN = 240;

/** The part of the list in view, in px from the top of its first item; 0 tall when nothing is. */
export interface View {
  top: number;
  height: number;
}

/** Rows that stay mounted wherever the list is scrolled: item keys. */
export interface KeptRows {
  itemKeys: readonly string[];
}

export interface NavTarget {
  threadId: string;
  projectId: string;
}

/**
 * The value of `data-sidebar-windowed-nav` on a spacer standing in for rows
 * that are not mounted: `threadId:projectId` pairs in visual order,
 * space-separated. This is an undocumented host contract in bb 0.46; a test
 * pins it.
 */
export function windowedNavValue(targets: readonly NavTarget[]): string {
  return targets.map((target) => `${target.threadId}:${target.projectId}`).join(" ");
}

/**
 * How many thread rows at the top of the list bb's jump keys reach. bb gives
 * them to the first mounted row links in DOM order and reads no spacer, so
 * the upper list keeps these rows mounted wherever it is scrolled.
 */
const JUMP_ROWS = 9;

/** The kept items' indices in `layout`: the jump keys' rows where `jumps`, and `kept`. */
export function keptIndexes(layout: Layout, kept: KeptRows, jumps: boolean): number[] {
  const indexes = new Set<number>();
  if (jumps) {
    for (let index = 0, found = 0; index < layout.items.length && found < JUMP_ROWS; index += 1) {
      if (layout.items[index]!.item.kind !== "row") continue;
      indexes.add(index);
      found += 1;
    }
  }
  for (const key of kept.itemKeys) {
    const index = layout.indexOf.get(key);
    if (index !== undefined) indexes.add(index);
  }
  return [...indexes];
}

/**
 * The indices mounted for `view`: every item intersecting it extended by the
 * margin above and below, then the kept ones, in order. An unknown view (null,
 * before the first read) mounts only the kept ones.
 */
export function mountedIndexes(layout: Layout, view: View | null, kept: readonly number[]): number[] {
  const indexes = new Set(kept);
  const range = view === null ? null : itemsBetween(layout.items, view.top - VIEW_MARGIN, view.top + view.height + VIEW_MARGIN);
  if (range !== null) for (let index = range.first; index <= range.last; index += 1) indexes.add(index);
  return [...indexes].sort((a, b) => a - b);
}

/** The mounted range for `view`, as a key that changes only when the range does. */
export function rangeKey(layout: Layout, view: View | null): string {
  const range = view === null ? null : itemsBetween(layout.items, view.top - VIEW_MARGIN, view.top + view.height + VIEW_MARGIN);
  return range === null ? "" : `${range.first}:${range.last}`;
}
