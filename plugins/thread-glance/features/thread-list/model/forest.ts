// Which threads are rows of their own and which sit under a parent. A thread
// is under its parent's card when its parent is visible in the project scope
// and the thread is not pinned; every other visible thread in scope is a root,
// a row of its own. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { lastActivityAt, treeSignals, type TreeSignals } from "@/shared/lifecycle";
import type { Settings } from "@/shared/settings";
import { inScope, type Scope } from "./scope";

/** Most steps up a parent chain before it is taken for a cycle. */
const MAX_DEPTH = 64;

/** Threads that make it onto the list: not archived and not hidden. */
export function isListed(thread: PluginSidebarThread): boolean {
  return !thread.isArchived && thread.archivedAt === null && !thread.isHidden;
}

/** A thread that failed: its last turn ended in an error nobody has read, or a queued message failed to send. */
export function isFailed(thread: PluginSidebarThread): boolean {
  return thread.indicator === "unread-error" || thread.indicator === "queued-failed";
}

/** A thread that finished with news nobody has read. */
export function isDone(thread: PluginSidebarThread): boolean {
  return thread.indicator === "unread-success";
}

/** Counts of the threads in a subtree, for a children chip's glyph and tooltip. */
export interface SubtreeCounts {
  failed: number;
  needsYou: number;
  done: number;
  working: number;
}

const NO_COUNTS: SubtreeCounts = { failed: 0, needsYou: 0, done: 0, working: 0 };

/** The most urgent thing in a subtree, in the order the chip shows it. */
export type Urgency = "failed" | "needs-you" | "done" | "working";

export function urgencyOf(counts: SubtreeCounts): Urgency | null {
  if (counts.failed > 0) return "failed";
  if (counts.needsYou > 0) return "needs-you";
  if (counts.done > 0) return "done";
  if (counts.working > 0) return "working";
  return null;
}

/** What a parent's card knows about the threads under it. */
export interface ChildrenInfo {
  /** The direct children, sorted by the Child threads settings; pinned children are rows of their own and left out. */
  ids: readonly string[];
  /** Every thread below the parent, direct or not. */
  descendantCount: number;
  /** What the whole subtree below holds, the direct children included. */
  counts: SubtreeCounts;
  urgency: Urgency | null;
}

export interface Forest {
  /** Listed threads by id, any project. */
  byId: ReadonlyMap<string, PluginSidebarThread>;
  /** The rows of their own, in scope. */
  roots: readonly PluginSidebarThread[];
  /** Parents with children, by id. */
  children: ReadonlyMap<string, ChildrenInfo>;
  /** The tree signals of every root, over the root and everything below it. */
  treeOf: ReadonlyMap<string, TreeSignals>;
  /** The root each thread of the forest sits under (a root is its own). */
  rootOf: ReadonlyMap<string, string>;
  /** Each thread's parent when it sits under one. */
  parentOf: ReadonlyMap<string, string>;
}

/** The comparator of a parent's children under the Child threads settings. */
export function childComparator(settings: Pick<Settings, "childOrder" | "childDirection">) {
  const key = (thread: PluginSidebarThread) => (settings.childOrder === "created" ? thread.createdAt : lastActivityAt(thread));
  const sign = settings.childDirection === "oldest" ? 1 : -1;
  return (a: PluginSidebarThread, b: PluginSidebarThread) => sign * (key(a) - key(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Builds the forest of `threads` for a project scope (empty for all
 * projects). Threads that are archived or hidden are left out.
 */
export function buildForest(
  threads: readonly PluginSidebarThread[],
  scope: Scope,
  settings: Pick<Settings, "childOrder" | "childDirection">,
): Forest {
  const byId = new Map<string, PluginSidebarThread>();
  for (const thread of threads) if (isListed(thread)) byId.set(thread.id, thread);
  const inProjectScope = (thread: PluginSidebarThread) => inScope(scope, thread.projectId);

  // A thread sits under its parent when the parent is listed and in scope.
  const parentOf = new Map<string, string>();
  for (const thread of byId.values()) {
    const parentId = thread.parentThreadId;
    if (parentId === null || thread.isPinned) continue;
    const parent = byId.get(parentId);
    if (parent !== undefined && inProjectScope(parent)) parentOf.set(thread.id, parentId);
  }
  // A parent chain that never ends has no root: its first thread becomes one.
  for (const id of [...parentOf.keys()]) {
    let current: string | undefined = id;
    for (let depth = 0; current !== undefined; depth += 1) {
      if (depth > MAX_DEPTH) {
        parentOf.delete(id);
        break;
      }
      current = parentOf.get(current);
    }
  }

  const compare = childComparator(settings);
  const childThreads = new Map<string, PluginSidebarThread[]>();
  for (const [childId, parentId] of parentOf) {
    const list = childThreads.get(parentId);
    const child = byId.get(childId)!;
    if (list === undefined) childThreads.set(parentId, [child]);
    else list.push(child);
  }
  for (const list of childThreads.values()) list.sort(compare);

  const roots: PluginSidebarThread[] = [];
  for (const thread of byId.values()) if (inProjectScope(thread) && !parentOf.has(thread.id)) roots.push(thread);

  const children = new Map<string, ChildrenInfo>();
  const treeOf = new Map<string, TreeSignals>();
  const rootOf = new Map<string, string>();

  // Post-order over each root's subtree.
  const summarize = (thread: PluginSidebarThread, rootId: string, seen: Set<string>): { counts: SubtreeCounts; size: number; members: PluginSidebarThread[] } => {
    rootOf.set(thread.id, rootId);
    const kids = childThreads.get(thread.id) ?? [];
    const counts = { failed: 0, needsYou: 0, done: 0, working: 0 };
    const members: PluginSidebarThread[] = [];
    let size = 0;
    for (const kid of kids) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      const below = summarize(kid, rootId, seen);
      size += 1 + below.size;
      members.push(kid, ...below.members);
      counts.failed += below.counts.failed + (isFailed(kid) ? 1 : 0);
      counts.needsYou += below.counts.needsYou + (kid.hasPendingInteraction ? 1 : 0);
      counts.done += below.counts.done + (isDone(kid) ? 1 : 0);
      counts.working += below.counts.working + (treeSignals([kid]).working ? 1 : 0);
    }
    if (kids.length > 0) {
      children.set(thread.id, {
        ids: kids.map((kid) => kid.id),
        descendantCount: size,
        counts: counts.failed + counts.needsYou + counts.done + counts.working === 0 ? NO_COUNTS : counts,
        urgency: urgencyOf(counts),
      });
    }
    return { counts, size, members };
  };

  for (const root of roots) {
    const below = summarize(root, root.id, new Set([root.id]));
    treeOf.set(root.id, treeSignals([root, ...below.members]));
  }

  return { byId, roots, children, treeOf, rootOf, parentOf };
}
