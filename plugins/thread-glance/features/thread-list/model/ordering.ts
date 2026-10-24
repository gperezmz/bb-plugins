// How the threads of each shelf are ordered, and how Active is grouped by
// project and, within a project, by worktree. Pure.
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

/** One thing inside a project group: a thread, or the threads of a worktree under its branch. */
export type GroupMember =
  | { kind: "thread"; thread: PluginSidebarThread }
  | { kind: "worktree"; environmentId: string; branch: string; threads: readonly PluginSidebarThread[] };

/** A run of Active's threads, loose or grouped under a project's header. */
export type ActiveEntry =
  | { kind: "thread"; thread: PluginSidebarThread }
  | {
      kind: "group";
      projectId: string;
      /** The group's threads in the order drawn. */
      threads: readonly PluginSidebarThread[];
      members: readonly GroupMember[];
    };

/** The id of the bb worktree a thread runs in, or null for a thread in a plain checkout or with no environment. */
export function worktreeOf(thread: PluginSidebarThread): string | null {
  const environment = thread.environment;
  return environment?.isWorktree === true ? environment.id : null;
}

/**
 * A project's threads with the ones that share a bb worktree gathered: a
 * worktree with at least two threads becomes one member sitting where its
 * first thread sits, named by its branch; every other thread stays a member of
 * its own, in place.
 */
export function groupByWorktree(threads: readonly PluginSidebarThread[]): GroupMember[] {
  const shared = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const environmentId = worktreeOf(thread);
    if (environmentId === null) continue;
    const list = shared.get(environmentId);
    if (list === undefined) shared.set(environmentId, [thread]);
    else list.push(thread);
  }
  const members: GroupMember[] = [];
  const placed = new Set<string>();
  for (const thread of threads) {
    const environmentId = worktreeOf(thread);
    const list = environmentId === null ? undefined : shared.get(environmentId);
    if (environmentId === null || list === undefined || list.length < 2) {
      members.push({ kind: "thread", thread });
    } else if (!placed.has(environmentId)) {
      placed.add(environmentId);
      const environment = thread.environment!;
      members.push({ kind: "worktree", environmentId, branch: environment.branchName ?? environment.name ?? environmentId, threads: list });
    }
  }
  return members;
}

/** The threads of `members` in the order they are drawn. */
export function memberThreads(members: readonly GroupMember[]): PluginSidebarThread[] {
  return members.flatMap((member) => (member.kind === "thread" ? [member.thread] : member.threads));
}

/**
 * Active in Project mode: a project with at least two threads becomes a group
 * sitting where its first thread sits, its threads in manual order; the other
 * projects' threads stay as lone rows in place. With `byWorktree`, the
 * threads of a group that share a worktree are gathered into one member.
 */
export function groupByProject(threads: readonly PluginSidebarThread[], byWorktree = false): ActiveEntry[] {
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
      const grouped: GroupMember[] = byWorktree ? groupByWorktree(list) : list.map((member) => ({ kind: "thread", thread: member }));
      entries.push({ kind: "group", projectId: thread.projectId, threads: memberThreads(grouped), members: grouped });
    }
  }
  return entries;
}

/** The thread ids of `entries` in the order they are drawn. */
export function flattenEntries(entries: readonly ActiveEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === "thread" ? [entry.thread.id] : entry.threads.map((thread) => thread.id)));
}
