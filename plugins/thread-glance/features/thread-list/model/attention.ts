// What needs attention, thread by thread. Collapsed groups, the header
// counters, the need-you filter and auto-reveal all read the set this
// builds. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ChildAttention } from "@/shared/preferences";
import { computeState, type Flag, type StateKind, type ThreadState } from "./state";

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

/**
 * How long a parent thread stays idle before a child's failure counts as
 * orphaned. bb reports a child's turn to its parent after a 2 s batch delay,
 * and the parent then has to start: a failure it is about to pick up never
 * reaches the need-you filter.
 */
export const ORPHAN_WAIT_MS = 5_000;

export interface ParentThread {
  thread: Pick<PluginSidebarThread, "latestAttentionAt">;
  state: Pick<ThreadState, "kind">;
  /** When the plugin server last saw the parent thread finish a turn, if it did. */
  finishedAt?: number;
  /**
   * When a window last saw the parent thread go from busy to idle, if one did;
   * null while that is not yet known, and no failure under it counts.
   */
  idleSince?: number | null;
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
 * When a child's failure becomes an orphaned failure, or null while it cannot:
 * the parent thread is idle and has not run or finished since the child
 * failed, and has stayed idle for `ORPHAN_WAIT_MS` from the later of the
 * failure and its last becoming idle. A busy parent thread, or one that
 * finished after the failure, is taken to know about it. The parent thread's
 * own clock is its last finish (`finishedAt`, or `latestAttentionAt` when it
 * failed): `updatedAt` also moves when someone merely opens or renames it.
 */
export function orphanedAt(
  thread: Pick<PluginSidebarThread, "latestAttentionAt" | "updatedAt">,
  flags: ReadonlySet<Flag>,
  parent: ParentThread,
): number | null {
  if (!flags.has("unread-failed") && !flags.has("queue-failed")) return null;
  if (!isParentIdle(parent) || parent.idleSince === null) return null;
  const parentActiveAt = Math.max(parent.thread.latestAttentionAt, parent.finishedAt ?? 0);
  const failedAt = failureTime(thread, flags);
  if (parentActiveAt > failedAt) return null;
  return Math.max(failedAt, parent.idleSince ?? 0) + ORPHAN_WAIT_MS;
}

/** Whether a child's failure is an orphaned failure at `now` (see `orphanedAt`). */
export function isOrphanedFailure(
  thread: Pick<PluginSidebarThread, "latestAttentionAt" | "updatedAt">,
  flags: ReadonlySet<Flag>,
  parent: ParentThread,
  now: number,
): boolean {
  const at = orphanedAt(thread, flags, parent);
  return at !== null && at <= now;
}

/** Which threads the list last saw busy, and when each last went from busy to idle. */
export interface IdleTracker {
  busy: ReadonlySet<string>;
  /** The busy threads that were running a turn. */
  working: ReadonlySet<string>;
  idleSince: Readonly<Record<string, number>>;
  /**
   * The threads this step saw go idle by a change bb sends the server no
   * event for, so a window reports it (see `isAnnounced`).
   */
  unannounced: readonly string[];
}

/**
 * Whether bb sends the server an event for a thread going from busy to
 * `now`. bb reports a turn ending, failing or waiting on you, so a change out
 * of a working turn is announced unless the turn was cut off by the machine
 * going offline. Every other change to idle, such as background work ending
 * or a queued message being cancelled, is not.
 */
export function isAnnounced(wasWorking: boolean, now: ThreadState): boolean {
  return wasWorking && now.kind !== "offline";
}

function stateOf(thread: PluginSidebarThread): ThreadState {
  return computeState(thread, { unread: false, hasDraft: false, scheduledAt: null, now: 0 });
}

/**
 * The tracker after the list sees `threads` at `at`: a thread busy before and
 * idle now went idle at `at`. A thread first seen idle has no time here; the
 * server's `idleAt` holds it.
 */
export function trackIdle(previous: IdleTracker | null, threads: readonly PluginSidebarThread[], at: number): IdleTracker {
  const busy = new Set<string>();
  const working = new Set<string>();
  const idleSince: Record<string, number> = {};
  const unannounced: string[] = [];
  for (const thread of threads) {
    const id = thread.id;
    const state = stateOf(thread);
    if (!isParentIdle({ thread, state })) {
      busy.add(id);
      if (state.kind === "working") working.add(id);
    } else if (previous?.busy.has(id)) {
      idleSince[id] = at;
      if (!isAnnounced(previous.working.has(id), state)) unannounced.push(id);
    } else if (previous?.idleSince[id] !== undefined) {
      idleSince[id] = previous.idleSince[id];
    }
  }
  return { busy, working, idleSince, unannounced };
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
