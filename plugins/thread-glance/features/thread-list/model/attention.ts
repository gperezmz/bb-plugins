// What counts as "needs attention", thread by thread. The filter, its
// badge, the header counters, the urgency order and auto-reveal all read the
// set this builds. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildAttention } from "@/shared/preferences";
import { type Flag, type StateKind, type ThreadState } from "./state";

/** The flags that count for a thread nobody manages. Working is not one. */
export const ROOT_ATTENTION: ReadonlySet<Flag> = new Set<Flag>([
  "needs-you",
  "unread-failed",
  "queue-failed",
  "offline",
  "unread",
]);

/** States in which a manager is busy and may still deal with a failed child. */
const BUSY: ReadonlySet<StateKind> = new Set<StateKind>(["working", "background", "queued", "scheduled"]);

export interface Manager {
  thread: Pick<PluginSidebarThread, "latestAttentionAt">;
  state: Pick<ThreadState, "kind">;
  /** When the plugin server last saw the manager finish a turn, if it did. */
  finishedAt?: number;
}

/** A manager is idle when it is not working, setting up, running background work or holding a queued message. */
export function isManagerIdle(manager: Manager): boolean {
  return !BUSY.has(manager.state.kind);
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
 * A failure nobody is dealing with: the manager is idle and has not run or
 * finished since the child failed. A busy manager, or one that finished after
 * the failure, is taken to know about it. The manager's own clock is its last
 * finish (`finishedAt`, or `latestAttentionAt` when it failed): `updatedAt`
 * also moves when someone merely opens or renames it.
 */
export function isOrphanedFailure(
  thread: Pick<PluginSidebarThread, "latestAttentionAt" | "updatedAt">,
  flags: ReadonlySet<Flag>,
  manager: Manager,
): boolean {
  if (!flags.has("unread-failed") && !flags.has("queue-failed")) return false;
  if (!isManagerIdle(manager)) return false;
  const managerActiveAt = Math.max(manager.thread.latestAttentionAt, manager.finishedAt ?? 0);
  return managerActiveAt <= failureTime(thread, flags);
}

/**
 * The flags of one thread that count towards Needs attention. A root keeps
 * its own. A child counts when it waits on you or is offline, or when it
 * failed with an idle manager; a finished-unread child never does. With
 * `everything`, a child counts like a root.
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
  if (flags.has("needs-you")) kept.add("needs-you");
  if (flags.has("offline")) kept.add("offline");
  if (options.orphaned) {
    if (flags.has("unread-failed")) kept.add("unread-failed");
    if (flags.has("queue-failed")) kept.add("queue-failed");
  }
  return kept;
}

/** Whether a set of attention flags is worth an auto-reveal: it waits on you or failed. */
export function revealsOn(attention: ReadonlySet<Flag>, isRoot: boolean): boolean {
  if (attention.has("needs-you") || attention.has("unread-failed")) return true;
  return !isRoot && attention.has("queue-failed");
}
