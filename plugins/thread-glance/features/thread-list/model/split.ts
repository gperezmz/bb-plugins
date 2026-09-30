// bb's split panes as the list reads them: which threads they show, and
// each such thread's mini-map. Pure.
import type { PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { share } from "./share";

export interface MiniMapPane {
  paneId: string;
  rect: { x: number; y: number; width: number; height: number };
  isMe: boolean;
  isFocused: boolean;
}

/** Every thread a split pane shows: each is open, not only the focused one. */
export function openThreadIdsOf(layout: PluginSidebarSplitLayout | null): ReadonlySet<string> {
  return new Set(layout?.panes.flatMap((pane) => (pane.threadId === null ? [] : [pane.threadId])) ?? []);
}

/**
 * Each thread a pane shows, with the mini-map its row draws. A thread whose
 * mini-map is unchanged since `previous` keeps its array.
 */
export function miniMapsOf(
  layout: PluginSidebarSplitLayout | null,
  previous: ReadonlyMap<string, readonly MiniMapPane[]>,
): ReadonlyMap<string, readonly MiniMapPane[]> {
  const maps = new Map<string, readonly MiniMapPane[]>();
  if (layout === null) return maps;
  for (const threadId of openThreadIdsOf(layout)) {
    const panes = layout.panes.map((pane) => ({
      paneId: pane.paneId,
      rect: pane.rect,
      isMe: pane.threadId === threadId,
      isFocused: pane.isFocused,
    }));
    const before = previous.get(threadId);
    maps.set(threadId, before === undefined ? panes : share(before, panes));
  }
  return maps;
}
