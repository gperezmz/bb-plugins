// Thread trees: who attaches to whom, and what each tree
// carries. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  computeState,
  chipFlagsOf,
  hiddenThreadFlags,
  isQuietThread,
  isUnread,
  threadFlags,
  type Flag,
  type ThreadContext,
  type StateKind,
  type ThreadState,
} from "./state";
import { attentionFlagsOf, orphanedAt } from "./attention";
import { compareCreationAscending } from "./sort";
import { needsKindOf, rowNote, type RowNote } from "./notes";
import type { ThreadNotes } from "@/shared/contract";
import type { ChildAttention } from "@/shared/preferences";

/** States that keep a child out of an open tree's "N more child threads" fold with `childAttention` `blocked`: working, setting up, background work. */
const RUNNING: ReadonlySet<StateKind> = new Set<StateKind>(["working", "background"]);

/** Everything the list knows about one thread. */
export interface ThreadInfo {
  thread: PluginSidebarThread;
  state: ThreadState;
  unread: boolean;
  /** Own flags; for hidden threads only waits-on-you and unread-failed. */
  flags: ReadonlySet<Flag>;
  /** What it adds to the children chip of the threads above it (see `chipFlagsOf`). */
  chipFlags: ReadonlySet<Flag>;
  /**
   * The flags of this thread that make it need attention, for collapsed
   * groups, the counters, the need-you filter and auto-reveal: a child counts
   * less than a root.
   */
  attentionFlags: Set<Flag>;
  /** Quiet test for the thread alone. */
  quiet: boolean;
  /**
   * A quiet thread, as if no thread were focused: nothing to see behind a
   * tree's fold. A root, or any child when `childAttention` is
   * `everything`, takes the quiet test without the focused thread's exemption.
   * Otherwise a child is quiet unless it runs or needs attention, so finishing
   * unread folds it; an archived child is always quiet. The fold reads this,
   * so opening a thread never changes which children stay shown.
   */
  quietIgnoringOpen: boolean;
  isActive: boolean;
  /** The visible ancestor it attaches to, or null for a root. */
  parentId: string | null;
  /** Why it waits on you or failed, for the line under the row. */
  note: RowNote | null;
}

/** What a thread's descendants add up to, for its chip and folding. */
export interface Subtree {
  /** Descendants, depth-first in creation order, hidden ones included. */
  descendants: ThreadInfo[];
  /** Union of the descendants' Needs attention flags and working, archived ones left out. */
  flags: ReadonlySet<Flag>;
  /** Union of the descendants' `chipFlags`, archived ones left out: the chip's state. */
  chipFlags: ReadonlySet<Flag>;
  /** Visible descendants at any depth. */
  visibleCount: number;
  /** Visible direct children: the chip's number. */
  childCount: number;
  /** Every visible descendant is quiet, as if no thread were focused, so the subtree adds nothing to see when folded. */
  quietIgnoringOpen: boolean;
}

export interface ThreadTree {
  root: ThreadInfo;
  /** Descendants, depth-first in creation order, hidden ones included. */
  descendants: ThreadInfo[];
  /** Union of the descendants' Needs attention flags and working (the chip rollup). */
  descendantFlags: ReadonlySet<Flag>;
  /** The same over root and descendants (rollup, folder rows). */
  flags: ReadonlySet<Flag>;
  /** Needs attention flags over root and descendants: the tree needs attention when any is set. */
  attentionFlags: ReadonlySet<Flag>;
  /** Visible descendants: the chip's number. */
  visibleDescendantCount: number;
  /** Largest latestAttentionAt over the tree. */
  latestAttentionAt: number;
  /** Every thread quiet and the active thread not in it. */
  quiet: boolean;
  /**
   * The quiet test without the focused thread's exemption. A group's fold reads
   * this, so opening a thread never changes which roots stay shown.
   */
  quietIgnoringOpen: boolean;
  containsActive: boolean;
}

export interface Forest {
  infos: ReadonlyMap<string, ThreadInfo>;
  /** Visible child ids per parent id, creation order; hidden children included. */
  children: ReadonlyMap<string, readonly string[]>;
  trees: readonly ThreadTree[];
  treeOf: ReadonlyMap<string, ThreadTree>;
  /** The rollup under every thread with a row, by thread id. */
  subtrees: ReadonlyMap<string, Subtree>;
  /** The earliest moment after `now` a child's failure becomes an orphaned failure, or null for none. */
  nextOrphanAt: number | null;
}

export interface ForestInputs extends ThreadContext {
  threads: readonly PluginSidebarThread[];
  draftIds: ReadonlySet<string>;
  scheduled: Readonly<Record<string, number>>;
  now: number;
  /** Server notes per thread id; absent until loaded. */
  notes?: Readonly<Record<string, ThreadNotes>>;
  /** Which children can need attention; `blocked` when absent. */
  childAttention?: ChildAttention;
  /** When this list last saw each thread go from busy to idle (see `trackIdle`). */
  idleSince?: Readonly<Record<string, number>>;
  /** The server's `idleAt` stamps: when any window last saw each thread go idle. */
  idleAt?: Readonly<Record<string, number>>;
  /** False until the stamps have loaded: no failure counts as orphaned before then. */
  stampsLoaded?: boolean;
}

function isPinned(thread: PluginSidebarThread): boolean {
  return thread.pinnedAt !== null || thread.isPinned;
}

/**
 * The visible loaded ancestor a thread attaches to, or null when it is
 * a root. A pinned thread with no pinned ancestor is a root. Cycles end
 * the walk and make the thread a root.
 */
export function attachParent(
  thread: PluginSidebarThread,
  byId: ReadonlyMap<string, PluginSidebarThread>,
): string | null {
  const seen = new Set<string>([thread.id]);
  let parentId = thread.parentThreadId;
  let attach: string | null = null;
  let pinnedAncestor = false;
  while (parentId !== null) {
    if (seen.has(parentId)) return null;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    if (!parent.isHidden) {
      attach ??= parent.id;
      if (isPinned(parent)) pinnedAncestor = true;
    }
    parentId = parent.parentThreadId;
  }
  if (!thread.isHidden && isPinned(thread) && !pinnedAncestor) return null;
  return attach;
}

/**
 * When a thread last went idle, as this list or any window saw it; null while
 * the stamps that may hold it have not loaded.
 */
function idleSinceOf(id: string, inputs: ForestInputs): number | null | undefined {
  if (inputs.stampsLoaded === false) return null;
  const seen = inputs.idleSince?.[id];
  const stamped = inputs.idleAt?.[id];
  if (seen === undefined) return stamped;
  return stamped === undefined ? seen : Math.max(seen, stamped);
}

export function buildForest(inputs: ForestInputs): Forest {
  const byId = new Map(inputs.threads.map((thread) => [thread.id, thread]));
  const infos = new Map<string, ThreadInfo>();
  for (const thread of inputs.threads) {
    const unread = isUnread(thread, inputs);
    const state = computeState(thread, {
      unread,
      hasDraft: inputs.draftIds.has(thread.id),
      scheduledAt: inputs.scheduled[thread.id] ?? null,
      now: inputs.now,
      needsKind: needsKindOf(inputs.notes?.[thread.id]),
    });
    const flags = threadFlags(thread, unread);
    const isActive = thread.id === inputs.activeThreadId;
    infos.set(thread.id, {
      thread,
      state,
      unread,
      flags: thread.isHidden ? hiddenThreadFlags(flags) : flags,
      chipFlags: chipFlagsOf(flags, thread.isHidden),
      attentionFlags: new Set<Flag>(),
      quiet: isQuietThread(state, unread, isActive),
      quietIgnoringOpen: false,
      isActive,
      parentId: attachParent(thread, byId),
      note: rowNote(thread, inputs.notes?.[thread.id]),
    });
  }

  const mode = inputs.childAttention ?? "blocked";
  let nextOrphanAt: number | null = null;
  for (const info of infos.values()) {
    const parent = info.parentId === null ? undefined : infos.get(info.parentId);
    const orphaned =
      parent === undefined
        ? null
        : orphanedAt(info.thread, info.flags, {
            ...parent,
            finishedAt: inputs.finishedAt[parent.thread.id],
            idleSince: idleSinceOf(parent.thread.id, inputs),
          });
    if (orphaned !== null && orphaned > inputs.now) nextOrphanAt = Math.min(nextOrphanAt ?? orphaned, orphaned);
    info.attentionFlags = attentionFlagsOf(info.flags, {
      isRoot: parent === undefined,
      mode,
      orphaned: orphaned !== null && orphaned <= inputs.now,
    });
    info.quietIgnoringOpen =
      parent === undefined || mode === "everything"
        ? isQuietThread(info.state, info.unread, false)
        : info.thread.isArchived || (!RUNNING.has(info.state.kind) && info.attentionFlags.size === 0);
  }

  const children = new Map<string, string[]>();
  const roots: ThreadInfo[] = [];
  for (const info of infos.values()) {
    if (info.parentId === null) {
      // A hidden thread with no visible ancestor has no row and no tree.
      if (!info.thread.isHidden) roots.push(info);
      continue;
    }
    const list = children.get(info.parentId) ?? [];
    list.push(info.thread.id);
    children.set(info.parentId, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => compareCreationAscending(byId.get(a)!, byId.get(b)!));
  }

  // Each thread's subtree, once: descendants depth-first, and what they add up to.
  const subtrees = new Map<string, Subtree>();
  const subtreeOf = (id: string, path: Set<string>): Subtree => {
    const cached = subtrees.get(id);
    if (cached !== undefined) return cached;
    const descendants: ThreadInfo[] = [];
    const flags = new Set<Flag>();
    const chipFlags = new Set<Flag>();
    let visibleCount = 0;
    let childCount = 0;
    let quietIgnoringOpen = true;
    path.add(id);
    for (const childId of children.get(id) ?? []) {
      if (path.has(childId)) continue;
      const child = infos.get(childId)!;
      const below = subtreeOf(childId, path);
      descendants.push(child, ...below.descendants);
      if (!child.thread.isArchived) {
        for (const flag of child.attentionFlags) flags.add(flag);
        if (child.flags.has("working")) flags.add("working");
        for (const flag of child.chipFlags) chipFlags.add(flag);
      }
      for (const flag of below.flags) flags.add(flag);
      for (const flag of below.chipFlags) chipFlags.add(flag);
      if (child.thread.isHidden ? child.attentionFlags.size > 0 : !child.quietIgnoringOpen) quietIgnoringOpen = false;
      if (!child.thread.isHidden) {
        visibleCount += 1;
        childCount += 1;
      }
      visibleCount += below.visibleCount;
      if (!below.quietIgnoringOpen) quietIgnoringOpen = false;
    }
    path.delete(id);
    const subtree: Subtree = { descendants, flags, chipFlags, visibleCount, childCount, quietIgnoringOpen };
    subtrees.set(id, subtree);
    return subtree;
  };
  for (const id of infos.keys()) subtreeOf(id, new Set());

  const trees: ThreadTree[] = [];
  const treeOf = new Map<string, ThreadTree>();
  for (const root of roots) {
    const { descendants, flags: descendantFlags, visibleCount: visibleDescendantCount } = subtrees.get(root.thread.id)!;
    let latestAttentionAt = root.thread.latestAttentionAt;
    let quiet = root.quiet;
    let quietIgnoringOpen = isQuietThread(root.state, root.unread, false);
    let containsActive = root.isActive;
    const attentionFlags = new Set<Flag>();
    for (const info of descendants) {
      if (!info.thread.isArchived) for (const flag of info.attentionFlags) attentionFlags.add(flag);
      latestAttentionAt = Math.max(latestAttentionAt, info.thread.latestAttentionAt);
      if (info.isActive) containsActive = true;
      if (info.thread.isHidden) {
        if (info.attentionFlags.size > 0) quiet = quietIgnoringOpen = false;
      } else {
        if (!info.quiet) quiet = false;
        // A child reads as its own fold does, so with `blocked` an unread child
        // does not keep an old tree out of the group's fold.
        if (!info.quietIgnoringOpen) quietIgnoringOpen = false;
      }
    }
    const flags = new Set<Flag>(descendantFlags);
    if (!root.thread.isArchived) {
      for (const flag of root.attentionFlags) {
        flags.add(flag);
        attentionFlags.add(flag);
      }
      if (root.flags.has("working")) flags.add("working");
    }
    const tree: ThreadTree = {
      root,
      descendants,
      descendantFlags,
      flags,
      attentionFlags,
      visibleDescendantCount,
      latestAttentionAt,
      quiet: quiet && !containsActive,
      quietIgnoringOpen,
      containsActive,
    };
    trees.push(tree);
    treeOf.set(root.thread.id, tree);
    for (const info of descendants) treeOf.set(info.thread.id, tree);
  }
  return { infos, children, trees, treeOf, subtrees, nextOrphanAt };
}

/**
 * Whether any thread in the trees is unread, descendants, hidden and
 * archived threads included: the threads Mark all read marks, so it is
 * offered only when this holds.
 */
export function anyUnread(trees: readonly ThreadTree[]): boolean {
  return trees.some((tree) => tree.root.unread || tree.descendants.some((info) => info.unread));
}

/** Ids from `id` up to (not including) `stopAt`, nearest first. */
export function ancestorsOf(
  id: string,
  infos: ReadonlyMap<string, ThreadInfo>,
  stopAt: string | null = null,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>([id]);
  let current = infos.get(id)?.parentId ?? null;
  while (current !== null && current !== stopAt && !seen.has(current)) {
    path.push(current);
    seen.add(current);
    current = infos.get(current)?.parentId ?? null;
  }
  return path;
}
