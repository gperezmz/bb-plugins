import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

/** The part of a navigation item the phone layout is decided on. */
export type LayoutItem = Pick<ExperimentalSidebarNavigationItem, "isVisible" | "action">;

/** Where each navigation item goes on a phone. */
export interface PocketLayout<Item extends LayoutItem> {
  /** Every visible item but New thread and search, in bb's order. */
  iconRow: Item[];
  /** New thread, when visible. */
  newThread: Item | null;
  /** Search, when visible. */
  search: Item | null;
  /** Every hidden item, in bb's order; "…" is drawn only when it has one. */
  overflow: Item[];
}

/**
 * Places bb's navigation items in the icon row, the New thread line and "…".
 *
 * `isVisible` is bb's reading of `sidebar.visiblePluginPanels`, the same one
 * bb's own navigation filters on, and `items` already come in the order of
 * `sidebar.pluginPanelOrder`.
 *
 * @param items Every navigation item bb reports, visible and hidden.
 * @returns The items grouped by where they are drawn.
 */
export function pocketLayout<Item extends LayoutItem>(items: readonly Item[]): PocketLayout<Item> {
  const layout: PocketLayout<Item> = { iconRow: [], newThread: null, search: null, overflow: [] };
  for (const item of items) {
    if (!item.isVisible) layout.overflow.push(item);
    else if (item.action.kind === "new-thread") layout.newThread ??= item;
    else if (item.action.kind === "search-threads") layout.search ??= item;
    else layout.iconRow.push(item);
  }
  return layout;
}
