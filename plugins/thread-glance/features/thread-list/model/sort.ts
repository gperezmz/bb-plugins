// Sort order inside a group and in Pinned. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SortDirection, SortField } from "@/shared/preferences";

export interface SortOptions {
  field: SortField;
  direction: SortDirection;
  workingFirst: boolean;
}

/** What a comparator needs to know about a root beyond the thread itself. */
export interface SortKey {
  thread: PluginSidebarThread;
  /** Largest `latestAttentionAt` over the family. */
  familyAttention: number;
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
  const diff = b.familyAttention - a.familyAttention;
  if (diff !== 0) return diff;
  return byCreated(a, b);
}

/** `none` is bb's legacy value and reads as `updated`. */
export function effectiveSortField(field: SortField): Exclude<SortField, "none"> {
  return field === "none" ? "updated" : field;
}

/**
 * The comparator for roots in a group. Direction follows bb: `default` keeps
 * the field's natural direction (ascending for alpha, descending otherwise).
 * Working first keeps active threads on top whatever the direction.
 */
export function makeComparator(options: SortOptions): (a: SortKey, b: SortKey) => number {
  const field = effectiveSortField(options.field);
  const natural = field === "alpha" ? "ascending" : "descending";
  const sign = options.direction === "default" || options.direction === natural ? 1 : -1;
  const base = field === "alpha" ? byAlpha : field === "created" ? byCreated : byUpdated;
  return (a, b) => {
    if (field === "updated" && options.workingFirst) {
      const aActive = a.thread.status === "active";
      const bActive = b.thread.status === "active";
      if (aActive !== bActive) return aActive ? -1 : 1;
    }
    return sign * base(a, b);
  };
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

/** Children in Folded nesting: creation order. */
export function compareCreationAscending(a: PluginSidebarThread, b: PluginSidebarThread): number {
  const diff = a.createdAt - b.createdAt;
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
