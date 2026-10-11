// The list laid out as items, each at a position worked out from the heights
// model: shelf headers, group headers, rows and "Load more". Positions are in
// px from the top of the first item. Pure.
import type { Heights } from "./heights";
import type { CardKind, ListItem, RowView } from "./list-model";

export interface LayoutItem {
  item: ListItem;
  /** Unique across the list. */
  key: string;
  start: number;
  size: number;
}

export interface Layout {
  items: readonly LayoutItem[];
  /** Item index by key. */
  indexOf: ReadonlyMap<string, number>;
  /** Total height. */
  height: number;
}

/** The height of a card of this kind, its child lists not counted; a full card in a group has no project line. */
export function cardHeight(card: CardKind, heights: Heights, grouped = false): number {
  return card === "full" ? (grouped ? heights.groupedCard : heights.fullCard) : card === "folded" ? heights.foldedCard : heights.slimRow;
}

/** The height of a child row and the child lists open under it. */
function childHeight(rows: ReadonlyMap<string, RowView>, id: string, heights: Heights, depth: number): number {
  const row = rows.get(id);
  if (row === undefined || depth > 32) return heights.childRow;
  let height = heights.childRow;
  for (const childId of row.shownChildIds) height += childHeight(rows, childId, heights, depth + 1);
  return height;
}

/** A row of its own: its card, then the children listed under it. */
export function rowHeight(rows: ReadonlyMap<string, RowView>, id: string, heights: Heights): number {
  const row = rows.get(id);
  if (row === undefined) return 0;
  let height = cardHeight(row.card, heights, row.grouped);
  for (const childId of row.shownChildIds) height += childHeight(rows, childId, heights, 0);
  return height;
}

/** Lays `items` out; every shelf header but the first gets the gap above it, inside its size. */
export function layoutItems(items: readonly ListItem[], rows: ReadonlyMap<string, RowView>, heights: Heights): Layout {
  const laid: LayoutItem[] = [];
  const indexOf = new Map<string, number>();
  let cursor = 0;
  for (const item of items) {
    let size: number;
    switch (item.kind) {
      case "shelf":
        size = heights.shelfHeader + (laid.length > 0 ? heights.shelfGap : 0);
        break;
      case "group":
        size = heights.groupHeader;
        break;
      case "more":
        size = heights.loadMore;
        break;
      case "row":
        size = rowHeight(rows, item.threadId, heights);
        break;
    }
    indexOf.set(item.key, laid.length);
    laid.push({ item, key: item.key, start: cursor, size });
    cursor += size;
  }
  return { items: laid, indexOf, height: cursor };
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

/** The first and last index of the items intersecting `[top, bottom)`, or null for none. */
export function itemsBetween(items: readonly LayoutItem[], top: number, bottom: number): { first: number; last: number } | null {
  if (items.length === 0 || bottom <= top) return null;
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const item = items[middle]!;
    if (item.start + item.size <= top) low = middle + 1;
    else high = middle;
  }
  const first = low;
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
