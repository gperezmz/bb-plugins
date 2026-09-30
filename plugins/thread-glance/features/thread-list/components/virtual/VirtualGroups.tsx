// Groups over one window: every group's section and header stay mounted,
// and only the rows in or near the view are, the rest standing in as one
// spacer per run. Positions come from the heights model, so nothing is
// measured. The list re-renders when the mounted range changes; a group
// renders only when its own mounted rows do.
import { memo, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { PHONE_QUERY } from "../../model/heights";
import { firstRowFrom, itemsBetween, layoutItems, type ListItems } from "../../model/layout-items";
import { useGroups, useKeptRows, useLayout, type KeptRows } from "../../store/hooks";
import { DropFeedback } from "../drag/DropFeedback";
import { useDragSurface } from "../drag/DragLayer";
import { GroupSection } from "../GroupSection";
import { scrollParentOf, VIEW_MARGIN, ViewTracker, type View } from "./view";

const NO_ROWS: ReadonlySet<string> = new Set();

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
export const JUMP_ROWS = 9;

/** The kept rows' indices in `layout`, in order, and the jump keys' rows where `jumps`. */
function keptIndexes(layout: ListItems, kept: KeptRows, jumps: boolean): number[] {
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

function rangeKey(layout: ListItems, view: View | null): string {
  const range = view === null ? null : itemsBetween(layout.items, view.top - VIEW_MARGIN, view.top + view.height + VIEW_MARGIN);
  return range === null ? "" : `${range.first}:${range.last}`;
}

export const VirtualGroups = memo(function VirtualGroups({
  groupIds,
  inOverflow = false,
}: {
  groupIds: readonly string[];
  /** The More popover's hidden groups, over the popover's own scroll area. */
  inOverflow?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const groups = useGroups(groupIds);
  const { density, branchLine } = useLayout();
  const phone = useMediaQuery(PHONE_QUERY);
  const layout = useMemo(() => layoutItems(groups, { density, phone }), [groups, density, phone]);
  const kept = useKeptRows();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const tracker = useRef<ViewTracker | null>(null);
  const mounted = useRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  // Threads in the More popover take no key.
  const pinned = useMemo(() => keptIndexes(layout, kept, !inOverflow), [layout, kept, inOverflow]);
  const view = tracker.current?.view ?? null;
  // What this render mounted, which a view change must move for the list to render again.
  const drawn = useRef({ layout, key: "" });
  drawn.current = { layout, key: rangeKey(layout, view) };
  mounted.current = mountedByGroup(layout, mountedIndexes(layout, view, pinned), mounted.current);

  // Switching Density or Branch line keeps the first visible row where it
  // was on screen: its new top, less where the view was over the old one.
  const heights = `${density}:${branchLine}:${phone}`;
  const last = useRef({ heights, layout });
  const anchor = useRef<{ key: string; above: number } | null>(null);
  if (last.current.heights !== heights && tracker.current !== null) {
    const top = tracker.current.view.top;
    const first = firstRowFrom(last.current.layout.items, top);
    anchor.current = first === null ? null : { key: first.key, above: first.start - top };
  }
  last.current = { heights, layout };

  useLayoutEffect(() => {
    const list = root.current!;
    const own = new ViewTracker(list, scrollParentOf(list));
    tracker.current = own;
    const unsubscribe = own.subscribe((next) => {
      if (rangeKey(drawn.current.layout, next) !== drawn.current.key) rerender();
    });
    return () => {
      unsubscribe();
      tracker.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = tracker.current;
    if (view === null) return;
    const kept = anchor.current;
    anchor.current = null;
    if (kept !== null) {
      view.update();
      const index = layout.indexOf.get(kept.key);
      if (index !== undefined) view.scrollBy(layout.items[index]!.start - kept.above - view.view.top);
    }
    // What is above the list, or the list's own size, may have moved the view.
    view.update();
  });

  const press = useDragSurface(root, layout, !inOverflow);

  return (
    <div ref={root} data-sidebar-virtual-list="" {...press} className="relative flex w-full min-w-0 flex-col">
      <DropFeedback layout={layout} />
      {groupIds.map((id, index) => (
        <GroupSection key={id} groupId={id} gapAbove={index > 0} inOverflow={inOverflow} mounted={mounted.current.get(id) ?? NO_ROWS} />
      ))}
    </div>
  );
});
