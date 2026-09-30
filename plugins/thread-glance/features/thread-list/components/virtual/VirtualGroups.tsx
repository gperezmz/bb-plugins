// Groups over one window: every group's section and header stay mounted,
// and only the rows in or near the view are, the rest standing in as one
// spacer per run. Positions come from the heights model, so nothing is
// measured. The list re-renders when the mounted range changes; a group
// renders only when its own mounted rows do.
import { memo, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { PHONE_QUERY } from "../../model/heights";
import { firstRowFrom, layoutItems } from "../../model/layout-items";
import { keptIndexes, mountedByGroup, mountedIndexes, NO_ROWS, rangeKey } from "../../model/windowing";
import { useGroups, useKeptRows, useLayout } from "../../store/hooks";
import { DropFeedback } from "../drag/DropFeedback";
import { useDragSurface } from "../drag/DragLayer";
import { GroupSection } from "../GroupSection";
import { scrollParentOf, ViewTracker } from "./view";

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
  const keptAt = useMemo(() => keptIndexes(layout, kept, !inOverflow), [layout, kept, inOverflow]);
  const view = tracker.current?.view ?? null;
  // What this render mounted, which a view change must move for the list to render again.
  const drawn = useRef({ layout, key: "" });
  drawn.current = { layout, key: rangeKey(layout, view) };
  mounted.current = mountedByGroup(layout, mountedIndexes(layout, view, keptAt), mounted.current);

  // Switching Density or Branch line keeps the first visible row where it
  // was on screen: its new top, less where the view was over the old one.
  const heights = `${density}:${branchLine}:${phone}`;
  const last = useRef({ heights, layout });
  const steady = useRef<{ key: string; above: number } | null>(null);
  if (last.current.heights !== heights && tracker.current !== null) {
    const top = tracker.current.view.top;
    const first = firstRowFrom(last.current.layout.items, top);
    steady.current = first === null ? null : { key: first.key, above: first.start - top };
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
    const own = tracker.current;
    if (own === null) return;
    const row = steady.current;
    steady.current = null;
    if (row !== null) {
      own.update();
      const index = layout.indexOf.get(row.key);
      if (index !== undefined) own.scrollBy(layout.items[index]!.start - row.above - own.view.top);
    }
    // What is above the list, or the list's own size, may have moved the view.
    own.update();
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
