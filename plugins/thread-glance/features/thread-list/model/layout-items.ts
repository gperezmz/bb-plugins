// The list laid out as items, each at a position worked out from the heights
// model: every group's header, its rows, and "No threads" under an empty
// group. Positions are in px from the top of the first group. Pure.
import { EMPTY_GROUP_HEIGHT, GROUP_GAP_PX, headerHeight, rowHeight, type HeightContext } from "./heights";
import type { GroupView, Row } from "./view";

interface ItemBase {
  /** Unique across the list: the group's id, then what the item is. */
  key: string;
  groupId: string;
  start: number;
  size: number;
}

export type LayoutItem =
  | (ItemBase & {
      kind: "header";
      /** Space above the header, part of `size`: every group's but the first. */
      gap: number;
    })
  | (ItemBase & { kind: "row"; row: Row })
  | (ItemBase & { kind: "empty" });

/** Where one group sits: its items, and its extent without the gap above it. */
export interface GroupExtent {
  groupId: string;
  /** Index of its header item. */
  first: number;
  /** Index of its last item. */
  last: number;
  top: number;
  bottom: number;
}

export interface ListItems {
  items: readonly LayoutItem[];
  groups: readonly GroupExtent[];
  /** The height of every group together. */
  total: number;
  /** Item index by key. */
  indexOf: ReadonlyMap<string, number>;
  /** Indices of every thread row, by thread id: a thread may show in more than one group. */
  indicesOf: ReadonlyMap<string, readonly number[]>;
}

/** A row's key in the list: its group, then its key within the group. */
export function itemKeyOf(groupId: string, rowKey: string): string {
  return `${groupId}/${rowKey}`;
}

/** A group draws "No threads": open, with no rows and no tree behind a fold. */
export function drawsEmpty(group: Pick<GroupView, "rows" | "collapsed" | "rootIds">): boolean {
  return group.rows.length === 0 && !group.collapsed && group.rootIds.length === 0;
}

/** Lays `groups` out in order, from the heights model. */
export function layoutItems(groups: readonly GroupView[], context: HeightContext): ListItems {
  const items: LayoutItem[] = [];
  const extents: GroupExtent[] = [];
  let cursor = 0;
  groups.forEach((group, index) => {
    const groupId = group.descriptor.id;
    const gap = index > 0 ? GROUP_GAP_PX[context.density] : 0;
    const first = items.length;
    const header = headerHeight(context);
    items.push({ kind: "header", key: `${groupId}/header`, groupId, start: cursor, size: gap + header, gap });
    const top = cursor + gap;
    cursor = top + header;
    for (const row of group.rows) {
      const size = rowHeight(row, context);
      items.push({ kind: "row", key: itemKeyOf(groupId, row.key), groupId, row, start: cursor, size });
      cursor += size;
    }
    if (drawsEmpty(group)) {
      items.push({ kind: "empty", key: `${groupId}/empty`, groupId, start: cursor, size: EMPTY_GROUP_HEIGHT });
      cursor += EMPTY_GROUP_HEIGHT;
    }
    extents.push({ groupId, first, last: items.length - 1, top, bottom: cursor });
  });
  const indexOf = new Map<string, number>();
  const indicesOf = new Map<string, number[]>();
  items.forEach((item, index) => {
    indexOf.set(item.key, index);
    if (item.kind !== "row" || item.row.type !== "thread") return;
    const id = item.row.info.thread.id;
    const known = indicesOf.get(id);
    if (known === undefined) indicesOf.set(id, [index]);
    else known.push(index);
  });
  return { items, groups: extents, total: cursor, indexOf, indicesOf };
}

/** The index of the item at `y`, or -1 above the first and past the last. */
export function itemIndexAt(items: readonly LayoutItem[], y: number): number {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = items[middle]!;
    if (y < item.start) high = middle - 1;
    else if (y >= item.start + item.size) low = middle + 1;
    else return middle;
  }
  return -1;
}

/** The first row whose bottom is below `y`: the row a view starting at `y` shows first. */
export function firstRowFrom(items: readonly LayoutItem[], y: number): LayoutItem | null {
  const at = Math.max(itemIndexAt(items, y), 0);
  for (let index = at; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "row" && item.start + item.size > y) return item;
  }
  return null;
}

/** The first and last index of the items intersecting `[top, bottom)`, or null for none. */
export function itemsBetween(items: readonly LayoutItem[], top: number, bottom: number): { first: number; last: number } | null {
  if (items.length === 0 || bottom <= top) return null;
  // The first item ending below `top`.
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const item = items[middle]!;
    if (item.start + item.size <= top) low = middle + 1;
    else high = middle;
  }
  const first = low;
  // The last item starting above `bottom`.
  low = first;
  high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (items[middle]!.start < bottom) low = middle + 1;
    else high = middle;
  }
  const last = low - 1;
  return first <= last ? { first, last } : null;
}
