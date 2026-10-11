// How the threads of each shelf are ordered, and how Active is grouped by
// project. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { lastActivityAt, type LifecycleRow } from "@/shared/lifecycle";
import { sortByManualOrder } from "@/shared/manual-order";
import type { ActiveSort } from "../storage/device-state";

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pinned order is bb's pin order: `pinSortKey`, then newest pin first, newest thread first, id. */
export function comparePinned(a: PluginSidebarThread, b: PluginSidebarThread): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null && a.pinSortKey !== b.pinSortKey) {
    return a.pinSortKey < b.pinSortKey ? -1 : 1;
  }
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.createdAt - a.createdAt || byId(a, b);
}

/** Snoozed: the soonest wake first. */
export function sortSnoozed(threads: readonly PluginSidebarThread[], rows: (id: string) => LifecycleRow | null): PluginSidebarThread[] {
  const at = (thread: PluginSidebarThread) => rows(thread.id)?.snoozeUntil ?? Number.MAX_SAFE_INTEGER;
  return threads.slice().sort((a, b) => at(a) - at(b) || byId(a, b));
}

/** Parked: the most recently parked first. */
export function sortParked(threads: readonly PluginSidebarThread[], rows: (id: string) => LifecycleRow | null): PluginSidebarThread[] {
  const at = (thread: PluginSidebarThread) => rows(thread.id)?.parkedAt ?? 0;
  return threads.slice().sort((a, b) => at(b) - at(a) || byId(a, b));
}

/** Settled: the most recently settled first. */
export function sortSettled(threads: readonly PluginSidebarThread[], rows: (id: string) => LifecycleRow | null): PluginSidebarThread[] {
  const at = (thread: PluginSidebarThread) => rows(thread.id)?.settledAt ?? 0;
  return threads.slice().sort((a, b) => at(b) - at(a) || byId(a, b));
}

/**
 * Active's threads in the chosen sort. Manual order and Project start from the
 * manual order; Recent activity and Date created sort newest first and leave
 * the stored order alone.
 */
export function sortActive(threads: readonly PluginSidebarThread[], order: readonly string[], sort: ActiveSort): PluginSidebarThread[] {
  switch (sort) {
    case "activity":
      return threads.slice().sort((a, b) => lastActivityAt(b) - lastActivityAt(a) || byId(a, b));
    case "created":
      return threads.slice().sort((a, b) => b.createdAt - a.createdAt || byId(a, b));
    case "manual":
    case "project":
      return sortByManualOrder(threads, order);
  }
}

/** Whether the rows of Active can be dragged: only in Manual order and Project mode. */
export function canReorderActive(sort: ActiveSort): boolean {
  return sort === "manual" || sort === "project";
}

/** A run of Active's threads, loose or grouped under a project's header. */
export type ActiveEntry =
  | { kind: "thread"; thread: PluginSidebarThread }
  | { kind: "group"; projectId: string; threads: readonly PluginSidebarThread[] };

/**
 * Active in Project mode: a project with at least two threads becomes a group
 * sitting where its first thread sits, its threads in manual order; the other
 * projects' threads stay as lone rows in place.
 */
export function groupByProject(threads: readonly PluginSidebarThread[]): ActiveEntry[] {
  const members = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const list = members.get(thread.projectId);
    if (list === undefined) members.set(thread.projectId, [thread]);
    else list.push(thread);
  }
  const entries: ActiveEntry[] = [];
  const placed = new Set<string>();
  for (const thread of threads) {
    const list = members.get(thread.projectId)!;
    if (list.length < 2) {
      entries.push({ kind: "thread", thread });
    } else if (!placed.has(thread.projectId)) {
      placed.add(thread.projectId);
      entries.push({ kind: "group", projectId: thread.projectId, threads: list });
    }
  }
  return entries;
}

/** The thread ids of `entries` in the order they are drawn. */
export function flattenEntries(entries: readonly ActiveEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === "thread" ? [entry.thread.id] : entry.threads.map((thread) => thread.id)));
}
