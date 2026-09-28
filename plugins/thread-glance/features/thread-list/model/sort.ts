// Sort order inside a group and in Pinned. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SortDirection, SortField } from "@/shared/preferences";

export interface SortOptions {
  field: SortField;
  direction: SortDirection;
}

/** What a comparator needs to know about a root beyond the thread itself. */
export interface SortKey {
  thread: PluginSidebarThread;
  /** Largest `latestAttentionAt` over the tree. */
  treeAttention: number;
}

function byCreated(a: SortKey, b: SortKey): number {
  const diff = b.thread.createdAt - a.thread.createdAt;
  if (diff !== 0) return diff;
  return a.thread.id < b.thread.id ? -1 : a.thread.id > b.thread.id ? 1 : 0;
}

function byAlpha(a: SortKey, b: SortKey): number {
  const diff = a.thread.displayTitle.localeCompare(b.thread.displayTitle);
  if (diff !== 0) return diff;
  return a.thread.id.localeCompare(b.thread.id);
}

function byUpdated(a: SortKey, b: SortKey): number {
  const diff = b.treeAttention - a.treeAttention;
  if (diff !== 0) return diff;
  return byCreated(a, b);
}

/** `none` is bb's legacy value and reads as `updated`. */
export function effectiveSortField(field: SortField): Exclude<SortField, "none"> {
  return field === "none" ? "updated" : field;
}

/** A field's own direction: A–Z for names, newest first for dates. */
export function naturalDirection(field: SortField): "ascending" | "descending" {
  return effectiveSortField(field) === "alpha" ? "ascending" : "descending";
}

/** The direction the list is sorted in: a saved `default` reads as the field's own. */
export function effectiveDirection(field: SortField, direction: SortDirection): "ascending" | "descending" {
  return direction === "default" ? naturalDirection(field) : direction;
}

/** The comparator for roots in a group. */
export function makeComparator(options: SortOptions): (a: SortKey, b: SortKey) => number {
  const field = effectiveSortField(options.field);
  const sign = effectiveDirection(field, options.direction) === naturalDirection(field) ? 1 : -1;
  const base = field === "alpha" ? byAlpha : field === "created" ? byCreated : byUpdated;
  return (a, b) => sign * base(a, b);
}

/** Pinned order: pinSortKey, then pinnedAt desc, createdAt desc, id. */
export function comparePinned(a: PluginSidebarThread, b: PluginSidebarThread): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null && a.pinSortKey !== b.pinSortKey) {
    return a.pinSortKey < b.pinSortKey ? -1 : 1;
  }
  const pinned = (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
  if (pinned !== 0) return pinned;
  const created = b.createdAt - a.createdAt;
  if (created !== 0) return created;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Children under a chip: creation order. */
export function compareCreationAscending(a: PluginSidebarThread, b: PluginSidebarThread): number {
  const diff = a.createdAt - b.createdAt;
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
