// One windowed list of items: every header stays mounted and only the rows in
// or near the view are, the rest standing in as one spacer per run. Positions
// come from the heights model, so nothing is measured. The list renders when
// its items or the mounted range change; a row renders when its own part of
// the model does.
import { memo, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { layoutItems } from "../model/layout";
import type { ListItem } from "../model/list-model";
import { REDUCED_MOTION_QUERY } from "../model/motion";
import { isToggleOnly, type RowPlace } from "../model/reorder";
import { keptIndexes, mountedIndexes, rangeKey, windowedNavValue, type NavTarget } from "../model/windowing";
import { useHeights, useListStore, useRows, useSelect } from "../store/hooks";
import { readRowPlaces, slideRows } from "./reorder/slide";
import { GroupHeader, LoadMore, ShelfHeader, WorktreeHeader } from "./ShelfParts";
import { ThreadRow } from "./rows/ThreadRow";
import { ViewTracker } from "./view-tracker";

/** The rows that stay mounted wherever the list is scrolled: the open thread's, the one being renamed, the one dragged. */
function useKeptKeys(): readonly string[] {
  const store = useListStore();
  const last = useRef<readonly string[]>([]);
  return useSelect(store, (state) => {
    const keys: string[] = [];
    const root = state.model?.openRootId;
    if (root !== null && root !== undefined) keys.push(`row:${root}`);
    if (state.ui.editingId !== null) keys.push(`row:${state.ui.editingId}`);
    if (state.ui.dragging !== null) keys.push(`row:${state.ui.dragging.unitKey}`);
    const previous = last.current;
    if (previous.length === keys.length && previous.every((key, index) => key === keys[index])) return previous;
    last.current = keys;
    return keys;
  });
}

export const ItemList = memo(function ItemList({ items, jumps }: { items: readonly ListItem[]; jumps: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const rows = useRows();
  const heights = useHeights();
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const layout = useMemo(() => layoutItems(items, rows, heights), [items, rows, heights]);
  const keptKeys = useKeptKeys();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const tracker = useRef<ViewTracker | null>(null);
  const kept = useMemo(() => keptIndexes(layout, { itemKeys: keptKeys }, jumps), [layout, keptKeys, jumps]);
  const view = tracker.current?.view ?? null;
  // What this render mounted, which a view change must move for the list to render again.
  const drawn = useRef({ layout, key: "" });
  drawn.current = { layout, key: rangeKey(layout, view) };
  const mounted = new Set(mountedIndexes(layout, view, kept));

  useLayoutEffect(() => {
    const list = root.current!;
    const own = new ViewTracker(list);
    tracker.current = own;
    const unsubscribe = own.subscribe((next) => {
      if (rangeKey(drawn.current.layout, next) !== drawn.current.key) rerender();
    });
    return () => {
      unsubscribe();
      tracker.current = null;
    };
  }, []);

  // When the items change other than by a shelf or group opening or closing,
  // or by group headers drawn or dropped around rows that keep their order
  // (Group by worktree turned on or off), the rows slide from where they were
  // to where they are now, as far as their header did not carry them.
  const places = useRef<Map<string, RowPlace>>(new Map());
  const rowOrder = items.map((item) => item.key).join(" ");
  const last = useRef({ order: rowOrder, items });
  useLayoutEffect(() => {
    const list = root.current!;
    if (last.current.order !== rowOrder && !isToggleOnly(last.current.items, items)) slideRows(list, places.current, reduced);
    last.current = { order: rowOrder, items };
    places.current = readRowPlaces(list);
    // What is above the list, or the list's own size, may have moved the view.
    tracker.current?.update();
  });

  const content: ReactNode[] = [];
  let spacer = { height: 0, nav: [] as NavTarget[], key: "" };
  const flush = () => {
    if (spacer.height === 0) return;
    content.push(<Spacer key={`spacer:${spacer.key}`} height={spacer.height} nav={spacer.nav} />);
    spacer = { height: 0, nav: [], key: "" };
  };
  layout.items.forEach((laid, index) => {
    const item = laid.item;
    if (item.kind === "row" && !mounted.has(index)) {
      if (spacer.height === 0) spacer.key = item.key;
      spacer.height += laid.size;
      const thread = rows.get(item.threadId)?.thread;
      if (thread !== undefined) spacer.nav.push({ threadId: thread.id, projectId: thread.projectId });
      return;
    }
    flush();
    switch (item.kind) {
      case "shelf":
        content.push(<ShelfHeader key={item.key} item={item} size={laid.size} gap={index > 0 ? heights.shelfGap : 0} />);
        break;
      case "group":
        content.push(<GroupHeader key={item.key} item={item} size={laid.size} />);
        break;
      case "worktree":
        content.push(<WorktreeHeader key={item.key} item={item} size={laid.size} />);
        break;
      case "more":
        content.push(<LoadMore key={item.key} item={item} size={laid.size} />);
        break;
      case "row":
        content.push(
          <div key={item.key} data-row-id={item.threadId} data-row-header={item.headers.at(-1)} style={{ height: laid.size }} className="relative">
            <ThreadRow threadId={item.threadId} />
          </div>,
        );
        break;
    }
  });
  flush();

  return (
    <div ref={root} data-item-list="" className="relative flex w-full min-w-0 flex-col">
      {content}
    </div>
  );
});

/** A run of rows that are not mounted: as tall as they are, naming their threads in order. */
function Spacer({ height, nav }: { height: number; nav: readonly NavTarget[] }) {
  return <div aria-hidden data-sidebar-windowed-nav={nav.length === 0 ? undefined : windowedNavValue(nav)} style={{ height }} />;
}
