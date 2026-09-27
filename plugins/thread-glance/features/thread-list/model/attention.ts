// What needs attention, thread by thread. The Needs attention section, the header
// counters, the section's order and auto-reveal all read the set this
// builds. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildAttention } from "@/shared/preferences";
import type { ThreadTree, Forest } from "./trees";
import { type Flag, type StateKind, type ThreadState } from "./state";

/** The flags that count for a root thread. Working is not one. */
export const ROOT_ATTENTION: ReadonlySet<Flag> = new Set<Flag>([
  "waits-on-you",
  "unread-failed",
  "queue-failed",
  "offline",
  "unread",
]);

/** States in which a parent thread is busy and may still deal with a failed child. */
const BUSY: ReadonlySet<StateKind> = new Set<StateKind>(["working", "background", "queued", "scheduled"]);

export interface ParentThread {
  thread: Pick<PluginSidebarThread, "latestAttentionAt">;
  state: Pick<ThreadState, "kind">;
  /** When the plugin server last saw the parent thread finish a turn, if it did. */
  finishedAt?: number;
}

/** A parent thread is idle when it is not working, setting up, running background work or holding a queued message. */
export function isParentIdle(parent: ParentThread): boolean {
  return !BUSY.has(parent.state.kind);
}

/** When the thread's failure happened: an error bumps `latestAttentionAt`, a failed queue only `updatedAt`. */
export function failureTime(
  thread: Pick<PluginSidebarThread, "latestAttentionAt" | "updatedAt">,
  flags: ReadonlySet<Flag>,
): number {
  let at = 0;
  if (flags.has("unread-failed")) at = Math.max(at, thread.latestAttentionAt);
  if (flags.has("queue-failed")) at = Math.max(at, thread.updatedAt);
  return at;
}

/**
 * An orphaned failure: the parent thread is idle and has not run or
 * finished since the child failed. A busy parent thread, or one that
 * finished after the failure, is taken to know about it. The parent thread's
 * own clock is its last finish (`finishedAt`, or `latestAttentionAt` when it
 * failed): `updatedAt` also moves when someone merely opens or renames it.
 */
export function isOrphanedFailure(
  thread: Pick<PluginSidebarThread, "latestAttentionAt" | "updatedAt">,
  flags: ReadonlySet<Flag>,
  parent: ParentThread,
): boolean {
  if (!flags.has("unread-failed") && !flags.has("queue-failed")) return false;
  if (!isParentIdle(parent)) return false;
  const parentActiveAt = Math.max(parent.thread.latestAttentionAt, parent.finishedAt ?? 0);
  return parentActiveAt <= failureTime(thread, flags);
}

/**
 * The flags of one thread that make it need attention. A root keeps its own. A
 * child counts when it waits on you or is offline, or for an orphaned
 * failure; a finished-unread child never does. With `everything`, a child
 * counts like a root.
 */
export function attentionFlagsOf(
  flags: ReadonlySet<Flag>,
  options: { isRoot: boolean; mode: ChildAttention; orphaned: boolean },
): Set<Flag> {
  const kept = new Set<Flag>();
  if (options.isRoot || options.mode === "everything") {
    for (const flag of flags) if (ROOT_ATTENTION.has(flag)) kept.add(flag);
    return kept;
  }
  if (flags.has("waits-on-you")) kept.add("waits-on-you");
  if (flags.has("offline")) kept.add("offline");
  if (options.orphaned) {
    if (flags.has("unread-failed")) kept.add("unread-failed");
    if (flags.has("queue-failed")) kept.add("queue-failed");
  }
  return kept;
}

/** Whether a set of Needs attention flags is worth an auto-reveal: it waits on you or failed. */
export function revealsOn(attention: ReadonlySet<Flag>, isRoot: boolean): boolean {
  if (attention.has("waits-on-you") || attention.has("unread-failed")) return true;
  return !isRoot && attention.has("queue-failed");
}

/** What the section reads of a tree. */
export type SectionTree = Pick<ThreadTree, "root" | "attentionFlags" | "latestAttentionAt">;

/** What Needs attention remembers between renders: the tree it holds, and the tree that was open. */
export interface AttentionHold {
  /**
   * The tree held in the section, if any, as it was when opened. The section
   * orders it by this, so nothing that happens inside it moves it.
   */
  held: SectionTree | null;
  /** The root of the tree the open thread belonged to at the last render, if any. */
  openRootId: string | null;
}

export const NO_HOLD: AttentionHold = { held: null, openRootId: null };

/**
 * Whether a tree is in the Needs attention section: it is the held tree, or one
 * of its threads needs attention and none of them is open. Nothing moves while you
 * are inside a tree, so the open tree only enters by being judged when
 * opened (see `holdAttention`).
 */
export function inAttention(tree: SectionTree, heldRootId: string | null, openRootId: string | null): boolean {
  const rootId = tree.root.thread.id;
  if (rootId === heldRootId) return true;
  return tree.attentionFlags.size > 0 && rootId !== openRootId;
}

/**
 * Whether a tree is attended: held in the section with nothing in it needing
 * attention any more. It keeps its place and draws and counts as in its home group.
 */
export function isAttended(tree: SectionTree, heldRootId: string | null): boolean {
  return tree.root.thread.id === heldRootId && tree.attentionFlags.size === 0;
}

/**
 * The hold after a render. A tree is judged when a thread in it is opened
 * from outside it: it is held if something in it needs attention then, and it stays
 * held while one of its threads is open, after nothing in it needs attention any
 * more, until none of its threads is open. An attended tree whose open thread
 * is archived counts as closed. A tree that does not need attention
 * when opened is not pulled in later, whatever happens in it; nor is one
 * that never needed attention. Opening another thread of the open tree judges
 * nothing again.
 */
export function holdAttention(
  previous: AttentionHold,
  forest: Pick<Forest, "infos" | "treeOf">,
  activeThreadId: string | null,
): AttentionHold {
  if (activeThreadId === null) return NO_HOLD;
  const openTree = forest.treeOf.get(activeThreadId);
  if (openTree === undefined) return NO_HOLD;
  const openRootId = openTree.root.thread.id;
  if (openRootId === previous.openRootId) {
    const archived = forest.infos.get(activeThreadId)?.thread.isArchived ?? false;
    const held = previous.held?.root.thread.id === openRootId && !(archived && openTree.attentionFlags.size === 0);
    return held ? previous : { held: null, openRootId };
  }
  return { held: openTree.attentionFlags.size > 0 ? openTree : null, openRootId };
}
