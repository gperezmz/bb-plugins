// Row windowing: which rows the list mounts for its view, and bb's contract
// for the rows it does not. Pure.
import { itemsBetween, type ListItems } from "./layout-items";

/** Rows are mounted this far above and below the view. */
const VIEW_MARGIN = 240;

/** The part of the list in view, in px from the top of its first group; 0 tall when nothing is. */
export interface View {
  top: number;
  height: number;
}

/** Rows that stay mounted wherever the list is scrolled, as thread ids and as `groupId/rowKey` keys. */
export interface KeptRows {
  threadIds: readonly string[];
  itemKeys: readonly string[];
}

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

/** No rows mounted. */
export const NO_ROWS: ReadonlySet<string> = new Set();

/** The row keys mounted in each group, each group's set kept while it holds. */
export function mountedByGroup(
  layout: ListItems,
  indexes: readonly number[],
  previous: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, ReadonlySet<string>> {
  const fresh = new Map<string, Set<string>>();
  for (const index of indexes) {
    const item = layout.items[index];
    if (item?.kind !== "row") continue;
    let rows = fresh.get(item.groupId);
    if (rows === undefined) fresh.set(item.groupId, (rows = new Set()));
    rows.add(item.row.key);
  }
  const result = new Map<string, ReadonlySet<string>>();
  for (const { groupId } of layout.groups) {
    const rows = fresh.get(groupId);
    const before = previous.get(groupId) ?? NO_ROWS;
    if (rows === undefined) result.set(groupId, before.size === 0 ? before : NO_ROWS);
    else result.set(groupId, before.size === rows.size && [...rows].every((key) => before.has(key)) ? before : rows);
  }
  return result;
}

/**
 * How many thread rows at the top of the list bb's jump keys reach. bb 0.44
 * gives them to the first mounted row links in DOM order and reads no
 * spacer, so the main list keeps these rows mounted wherever it is scrolled.
 */
const JUMP_ROWS = 9;

/** The kept rows' indices in `layout`, in order, and the jump keys' rows where `jumps`. */
export function keptIndexes(layout: ListItems, kept: KeptRows, jumps: boolean): number[] {
  const indexes = new Set<number>();
  if (jumps) {
    for (let index = 0, found = 0; index < layout.items.length && found < JUMP_ROWS; index += 1) {
      const item = layout.items[index]!;
      if (item.kind !== "row" || item.row.type !== "thread") continue;
      indexes.add(index);
      found += 1;
    }
  }
  for (const id of kept.threadIds) for (const index of layout.indicesOf.get(id) ?? []) indexes.add(index);
  for (const key of kept.itemKeys) {
    const index = layout.indexOf.get(key);
    if (index !== undefined) indexes.add(index);
  }
  return [...indexes];
}

/**
 * The indices mounted for `view`: every item intersecting it extended by the
 * margin above and below, then the kept rows, in order. An unknown view
 * (null, before the first read) mounts only the kept rows.
 */
export function mountedIndexes(layout: ListItems, view: View | null, kept: readonly number[]): number[] {
  const indexes = new Set(kept);
  const range = view === null ? null : itemsBetween(layout.items, view.top - VIEW_MARGIN, view.top + view.height + VIEW_MARGIN);
  if (range !== null) for (let index = range.first; index <= range.last; index += 1) indexes.add(index);
  return [...indexes].sort((a, b) => a - b);
}

/** The mounted range for `view`, as a key that changes only when the range does. */
export function rangeKey(layout: ListItems, view: View | null): string {
  const range = view === null ? null : itemsBetween(layout.items, view.top - VIEW_MARGIN, view.top + view.height + VIEW_MARGIN);
  return range === null ? "" : `${range.first}:${range.last}`;
}
