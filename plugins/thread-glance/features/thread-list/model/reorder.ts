// The rules of reordering, apart from the pointer and the DOM: when a press
// becomes a drag, where the dragged unit goes, how fast the list scrolls, how
// far a row slides, and what a keyboard move announces. Pure.
import { applySubsetOrder, insertAtTop, moveByOne } from "@/shared/manual-order";
import type { ListModel, ReorderList } from "./list-model";

/** The pointer must move this far before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 6;
/** The list scrolls while the pointer is this close to an edge. */
export const AUTOSCROLL_EDGE_PX = 48;
/** The fastest scroll, per animation frame. */
export const AUTOSCROLL_MAX_PX = 14;
/** The slide of the rows a drag moves aside. */
export const SLIDE_MS = 150;

/** One of a list's children, top to bottom: a shelf or group header, or a row, with its top in px from the list's top. */
export type ListUnit = { kind: "header"; key: string; top: number } | { kind: "row"; id: string; top: number };

/** Where a row sits: under which header, its top from the list's top, and its top from that header's top. */
export interface RowPlace {
  header: string | null;
  top: number;
  belowHeader: number;
}

/** The place of each row in `units`, by row id. */
export function rowPlaces(units: Iterable<ListUnit>): Map<string, RowPlace> {
  const places = new Map<string, RowPlace>();
  let header: string | null = null;
  let headerTop = 0;
  for (const unit of units) {
    if (unit.kind === "header") {
      header = unit.key;
      headerTop = unit.top;
    } else places.set(unit.id, { header, top: unit.top, belowHeader: unit.top - headerTop });
  }
  return places;
}

/**
 * How far a row slides into its new place, in px from it: the distance it
 * moved that its header did not carry it. A row under the same header as
 * before slides only by its move within that header, so rows a shelf or group
 * opening or closing pushes along move with their header and do not slide; a
 * row now under another header slides from where it was.
 */
export function slideDelta(was: RowPlace, now: RowPlace): number {
  return was.header === now.header ? was.belowHeader - now.belowHeader : was.top - now.top;
}

export interface PressStart {
  x: number;
  y: number;
  button: number;
  pointerType: string;
}

/**
 * Whether a press that has moved to (`x`, `y`) is a drag: the left button, not
 * touch, at least 6 px away, more vertically than sideways (sideways is left
 * to bb's drag-to-split).
 */
export function isDrag(start: PressStart, x: number, y: number): boolean {
  if (start.button !== 0 || start.pointerType === "touch") return false;
  const dx = x - start.x;
  const dy = y - start.y;
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx);
}

/** A scroll area's edges on screen. */
export interface Edges {
  top: number;
  bottom: number;
}

/** Pixels to scroll this frame: negative up, positive down, 0 away from the edges; faster the closer the pointer. */
export function autoScrollStep(pointerY: number, edges: Edges): number {
  const intoTop = AUTOSCROLL_EDGE_PX - (pointerY - edges.top);
  if (intoTop > 0) return -Math.min(AUTOSCROLL_MAX_PX, (Math.min(intoTop, AUTOSCROLL_EDGE_PX) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX);
  const intoBottom = AUTOSCROLL_EDGE_PX - (edges.bottom - pointerY);
  if (intoBottom > 0) return Math.min(AUTOSCROLL_MAX_PX, (Math.min(intoBottom, AUTOSCROLL_EDGE_PX) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_PX);
  return 0;
}

/** `keys` with `key` moved to `index` (clamped); the same array when it is already there. */
export function moveKeyTo(keys: readonly string[], key: string, index: number): readonly string[] {
  const from = keys.indexOf(key);
  if (from < 0) return keys;
  const to = Math.max(0, Math.min(keys.length - 1, index));
  if (to === from) return keys;
  const moved = keys.filter((entry) => entry !== key);
  moved.splice(to, 0, key);
  return moved;
}

/** What the pointer is over, as the drag sees it. */
export type Hover =
  | { kind: "unit"; unitKey: string }
  /** Empty space above the first or below the last unit of the list. */
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "none" };

/** The unit keys after the pointer moves over `hover`: the dragged unit takes the place of the unit it enters. */
export function afterHover(keys: readonly string[], draggedKey: string, hover: Hover): readonly string[] {
  switch (hover.kind) {
    case "unit":
      return hover.unitKey === draggedKey ? keys : moveKeyTo(keys, draggedKey, keys.indexOf(hover.unitKey));
    case "edge":
      return moveKeyTo(keys, draggedKey, hover.edge === "first" ? 0 : keys.length - 1);
    case "none":
      return keys;
  }
}

/**
 * The unit of list `listKey` that the row or group `hitKey` belongs to: the
 * unit itself, or the group unit a row in a group is part of.
 */
export function unitInList(model: ListModel, hitKey: string, listKey: string): string | null {
  let key: string | undefined = hitKey;
  for (let steps = 0; key !== undefined && steps < 4; steps += 1) {
    const place = model.reorderOf.get(key);
    if (place === undefined) return null;
    if (place.listKey === listKey) return place.unitKey;
    key = place.listKey;
  }
  return null;
}

/** The thread ids of a list's units in the order given: what a write sends. */
export function idsOfUnits(list: ReorderList, unitKeys: readonly string[]): string[] {
  const byKey = new Map(list.units.map((unit) => [unit.key, unit]));
  return unitKeys.flatMap((key) => byKey.get(key)?.ids ?? []);
}

/** The manual order after `subsetIds` were put in a new sequence, threads the order lacks counted in at the top. */
export function orderAfterReorder(order: readonly string[], subsetIds: readonly string[]): string[] {
  return applySubsetOrder(insertAtTop(order, subsetIds), subsetIds);
}

/** The neighbours bb's pin order call names for `threadId` in `ids`. */
export function pinNeighbours(ids: readonly string[], threadId: string): { previousThreadId: string | null; nextThreadId: string | null } {
  const index = ids.indexOf(threadId);
  return { previousThreadId: ids[index - 1] ?? null, nextThreadId: ids[index + 1] ?? null };
}

/** A keyboard move: the new sequence, and the sentence the live region reads. */
export type KeyboardMove =
  | { moved: true; unitKeys: readonly string[]; announcement: string }
  | { moved: false; announcement: string };

/** Alt+Arrow on a unit: one slot up or down within its list, announced. */
export function keyboardMove(list: ReorderList, unitKey: string, direction: -1 | 1): KeyboardMove {
  const keys = list.units.map((unit) => unit.key);
  const title = list.units.find((unit) => unit.key === unitKey)?.title ?? unitKey;
  const moved = moveByOne(keys, unitKey, direction);
  if (moved === null) {
    return { moved: false, announcement: `${title} is already ${direction === -1 ? "first" : "last"} in ${list.label}` };
  }
  return {
    moved: true,
    unitKeys: moved,
    announcement: `${title} moved to ${moved.indexOf(unitKey) + 1} of ${moved.length} in ${list.label}`,
  };
}
