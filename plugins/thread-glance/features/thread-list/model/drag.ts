// Drag and drop outcomes. Pure: components report what was dropped
// where, and this decides what it means.
import type { OrganizationMode } from "@/shared/preferences";
import { itemIndexAt, type ListItems } from "./layout-items";

export interface DraggedThread {
  threadId: string;
  parentThreadId: string | null;
  sectionId: string | null;
  pinned: boolean;
}

export type DropTarget =
  | { kind: "thread"; threadId: string; zone: "before" | "middle" | "after"; inPinned: boolean }
  | { kind: "group"; groupId: string };

export type DropAction =
  | { type: "nest"; threadId: string; parentThreadId: string; unpinFirst: boolean }
  | { type: "move"; threadId: string; sectionId: string | null; detach: boolean }
  | { type: "detach"; threadId: string }
  | { type: "pin"; threadId: string }
  | { type: "unpin"; threadId: string }
  | { type: "reorder-pinned"; threadId: string; previousThreadId: string | null; nextThreadId: string | null }
  | { type: "blocked" }
  | { type: "unchanged" };

export interface DropContext {
  mode: OrganizationMode;
  /** Raw `parentThreadId` for every loaded thread. */
  parentOf: (threadId: string) => string | null;
  /** Pinned roots in Pinned's display order. */
  pinnedOrder: readonly string[];
}

/** True when `candidate` is `ancestorId` or one of its descendants. */
export function isInSubtree(
  candidate: string,
  ancestorId: string,
  parentOf: (threadId: string) => string | null,
): boolean {
  const seen = new Set<string>();
  let current: string | null = candidate;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parentOf(current);
  }
  return false;
}

function dropOnGroup(source: DraggedThread, groupId: string, context: DropContext): DropAction {
  if (groupId === "pinned") {
    return source.pinned ? { type: "unchanged" } : { type: "pin", threadId: source.threadId };
  }
  if (source.pinned) return { type: "unpin", threadId: source.threadId };
  if (context.mode === "chronological" && (groupId === "threads" || groupId.startsWith("section:"))) {
    const sectionId = groupId === "threads" ? null : groupId.slice("section:".length);
    if (sectionId === source.sectionId && source.parentThreadId === null) return { type: "unchanged" };
    return {
      type: "move",
      threadId: source.threadId,
      sectionId,
      detach: source.parentThreadId !== null,
    };
  }
  if (source.parentThreadId !== null) return { type: "detach", threadId: source.threadId };
  return { type: "unchanged" };
}

/** What dropping a thread on a target does, with bb's guards. */
export function resolveDrop(
  source: DraggedThread,
  target: DropTarget,
  context: DropContext & { groupOfThread: (threadId: string) => string },
): DropAction {
  if (target.kind === "group") return dropOnGroup(source, target.groupId, context);
  if (target.threadId === source.threadId) return { type: "unchanged" };
  if (target.zone === "middle") {
    if (isInSubtree(target.threadId, source.threadId, context.parentOf)) return { type: "blocked" };
    if (source.parentThreadId === target.threadId) return { type: "unchanged" };
    return {
      type: "nest",
      threadId: source.threadId,
      parentThreadId: target.threadId,
      unpinFirst: source.pinned,
    };
  }
  if (target.inPinned && context.pinnedOrder.includes(target.threadId)) {
    if (!source.pinned) return { type: "pin", threadId: source.threadId };
    const order = context.pinnedOrder.filter((id) => id !== source.threadId);
    const index = order.indexOf(target.threadId);
    const insertAt = target.zone === "before" ? index : index + 1;
    const previousThreadId = order[insertAt - 1] ?? null;
    const nextThreadId = order[insertAt] ?? null;
    const current = context.pinnedOrder.indexOf(source.threadId);
    if (
      (context.pinnedOrder[current - 1] ?? null) === previousThreadId &&
      (context.pinnedOrder[current + 1] ?? null) === nextThreadId
    ) {
      return { type: "unchanged" };
    }
    return { type: "reorder-pinned", threadId: source.threadId, previousThreadId, nextThreadId };
  }
  return dropOnGroup(source, context.groupOfThread(target.threadId), context);
}

/** What is under the pointer while dragging, and which half of its group for a group drop. */
export interface PointedTarget {
  target: DropTarget | null;
  /** For a group target: the pointer is in the upper or lower half of the group. */
  placement: "before" | "after";
}

const NOTHING: PointedTarget = { target: null, placement: "before" };

/**
 * The drop target at `y`, in px from the top of the first group, found from
 * the list's positions, so a row that is not mounted is a target too. A
 * dragged thread prefers the thread row under it, split into its top quarter,
 * middle half and bottom quarter, over the group around it; a dragged group
 * header targets whole groups. The gap above a header is no target.
 */
export function targetAt(layout: ListItems, y: number, dragged: "thread" | "group"): PointedTarget {
  const index = itemIndexAt(layout.items, y);
  if (index < 0) return NOTHING;
  const item = layout.items[index]!;
  if (item.kind === "header" && y < item.start + item.gap) return NOTHING;
  const group = layout.groups.find((extent) => extent.groupId === item.groupId);
  if (group === undefined) return NOTHING;
  const placement = y > group.top + (group.bottom - group.top) / 2 ? "after" : "before";
  if (dragged === "thread" && item.kind === "row" && item.row.type === "thread") {
    const ratio = (y - item.start) / Math.max(item.size, 1);
    const zone = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "middle";
    return { target: { kind: "thread", threadId: item.row.info.thread.id, zone, inPinned: item.groupId === "pinned" }, placement };
  }
  return { target: { kind: "group", groupId: item.groupId }, placement };
}
