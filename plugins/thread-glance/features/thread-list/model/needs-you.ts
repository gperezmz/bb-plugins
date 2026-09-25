// What needs you, thread by thread. The Needs you section, the header
// counters, the section's order and auto-reveal all read the set this
// builds. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildAttention } from "@/shared/preferences";
import type { Family } from "./families";
import { type Flag, type StateKind, type ThreadState } from "./state";

/** The flags that count for a root thread. Working is not one. */
export const ROOT_NEEDS_YOU: ReadonlySet<Flag> = new Set<Flag>([
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
 * The flags of one thread that make it need you. A root keeps its own. A
 * child counts when it waits on you or is offline, or for an orphaned
 * failure; a finished-unread child never does. With `everything`, a child
 * counts like a root.
 */
export function needsYouFlagsOf(
  flags: ReadonlySet<Flag>,
  options: { isRoot: boolean; mode: ChildAttention; orphaned: boolean },
): Set<Flag> {
  const kept = new Set<Flag>();
  if (options.isRoot || options.mode === "everything") {
    for (const flag of flags) if (ROOT_NEEDS_YOU.has(flag)) kept.add(flag);
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

/** Whether a set of Needs you flags is worth an auto-reveal: it waits on you or failed. */
export function revealsOn(needsYou: ReadonlySet<Flag>, isRoot: boolean): boolean {
  if (needsYou.has("waits-on-you") || needsYou.has("unread-failed")) return true;
  return !isRoot && needsYou.has("queue-failed");
}

/** What the section reads of a family. */
type SectionFamily = Pick<Family, "root" | "needsYouFlags">;

/**
 * Whether a family is in the Needs you section: one of its threads needs
 * you, or it is the family the section holds while one of its threads is open.
 */
export function inNeedsYou(family: SectionFamily, heldRootId: string | null): boolean {
  return family.needsYouFlags.size > 0 || family.root.thread.id === heldRootId;
}

/**
 * The family Needs you holds after a render, by its root's id: the open
 * thread's family, when it needs you now or was already held. Held, it stays
 * in the section after nothing in it needs you, until a thread outside it is
 * opened; a family that never needed you is not pulled in by opening it.
 */
export function holdNeedsYou(previous: string | null, openFamily: SectionFamily | undefined): string | null {
  if (openFamily === undefined) return null;
  return inNeedsYou(openFamily, previous) ? openFamily.root.thread.id : null;
}
