// What needs attention, thread by thread. The Needs attention section, the header
// counters, the section's order and auto-reveal all read the set this
// builds. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildAttention } from "@/shared/preferences";
import type { Family } from "./families";
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

/** What the section reads of a family. */
type SectionFamily = Pick<Family, "root" | "attentionFlags">;

/** What Needs attention remembers between renders: the family it holds, and the family that was open. */
export interface AttentionHold {
  /** The root of the family held in the section, if any. */
  heldRootId: string | null;
  /** The root of the family the open thread belonged to at the last render, if any. */
  openRootId: string | null;
}

export const NO_HOLD: AttentionHold = { heldRootId: null, openRootId: null };

/**
 * Whether a family is in the Needs attention section: it is the held family, or one
 * of its threads needs attention and none of them is open. Nothing moves while you
 * are inside a family, so the open family only enters by being judged when
 * opened (see `holdAttention`).
 */
export function inAttention(family: SectionFamily, heldRootId: string | null, openRootId: string | null): boolean {
  const rootId = family.root.thread.id;
  if (rootId === heldRootId) return true;
  return family.attentionFlags.size > 0 && rootId !== openRootId;
}

/**
 * The hold after a render. A family is judged when a thread in it is opened
 * from outside it: it is held if something in it needs attention then, and it stays
 * held while one of its threads is open, after nothing in it needs attention any
 * more, until a thread outside it is opened. A family that does not need attention
 * when opened is not pulled in later, whatever happens in it; nor is one
 * that never needed you. Opening another thread of the open family judges
 * nothing again.
 */
export function holdAttention(previous: AttentionHold, openFamily: SectionFamily | undefined): AttentionHold {
  if (openFamily === undefined) return NO_HOLD;
  const openRootId = openFamily.root.thread.id;
  if (openRootId === previous.openRootId) {
    return { heldRootId: previous.heldRootId === openRootId ? openRootId : null, openRootId };
  }
  return { heldRootId: openFamily.attentionFlags.size > 0 ? openRootId : null, openRootId };
}
