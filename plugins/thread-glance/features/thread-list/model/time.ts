// Row age and working timer. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Stamps } from "@/shared/signals";
import type { ThreadInfo } from "./trees";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** `now`, `5m`, `3h`, `2d` or `4w`. */
export function formatDuration(ms: number): string {
  const elapsed = Math.max(0, ms);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
}

/** When the thread last finished: max(latestAttentionAt, finishedAt ?? createdAt). */
function lastFinishedAt(
  thread: Pick<PluginSidebarThread, "id" | "latestAttentionAt" | "createdAt">,
  finishedAt: Readonly<Record<string, number>>,
): number {
  return Math.max(thread.latestAttentionAt, finishedAt[thread.id] ?? thread.createdAt);
}

export interface TrailingTime {
  text: string;
  label: string;
  /** A working timer is drawn in the working tone, a wait and an age muted. */
  kind: "timer" | "waiting" | "age";
}

/**
 * The trailing slot: the wait for a thread that waits on you, time since
 * start for a working row, else the age. A working row whose start wasn't
 * stamped, or a waiting one with no `pendingAt`, shows nothing.
 */
export function trailingTime(
  thread: Pick<PluginSidebarThread, "id" | "latestAttentionAt" | "createdAt">,
  working: boolean,
  stamps: { startedAt: Readonly<Record<string, number>>; finishedAt: Readonly<Record<string, number>> },
  now: number,
  /**
   * When the thread started waiting on you, if it is: bb reports such a
   * thread as active, but it isn't working, so it gets no working timer.
   */
  waitingSince?: number | null,
): TrailingTime | null {
  if (waitingSince !== undefined) {
    if (waitingSince === null) return null;
    const elapsed = formatDuration(now - waitingSince);
    const text = elapsed === "now" ? "<1m" : elapsed;
    return { text, label: `Waiting on you for ${text === "<1m" ? "less than a minute" : text}`, kind: "waiting" };
  }
  if (working) {
    const started = stamps.startedAt[thread.id];
    if (started === undefined) return null;
    const elapsed = formatDuration(now - started);
    // "now" would read like "finished now"; a timer says "<1m".
    const text = elapsed === "now" ? "<1m" : elapsed;
    return { text, label: `Working for ${text === "<1m" ? "less than a minute" : text}`, kind: "timer" };
  }
  const text = formatDuration(now - lastFinishedAt(thread, stamps.finishedAt));
  return { text, label: text === "now" ? "Finished just now" : `Finished ${text} ago`, kind: "age" };
}

/**
 * What a row's Trailing slot shows: nothing for an archived thread, the wait
 * for one that waits on you, else `trailingTime`.
 */
export function rowTime(
  info: Pick<ThreadInfo, "thread" | "state" | "flags">,
  stamps: Pick<Stamps, "startedAt" | "finishedAt" | "pendingAt">,
  now: number,
): TrailingTime | null {
  const thread = info.thread;
  if (thread.archivedAt !== null || thread.isArchived) return null;
  const waitingSince = info.state.kind === "waits-on-you" ? (stamps.pendingAt[thread.id] ?? null) : undefined;
  return trailingTime(thread, info.flags.has("working"), stamps, now, waitingSince);
}

/**
 * When the thread last finished, or null while it never has: it is working,
 * waiting for you, or has no finish on record.
 */
export function finishedAtFor(
  thread: Pick<PluginSidebarThread, "id" | "status" | "latestAttentionAt" | "hasPendingInteraction" | "parentThreadId" | "createdAt">,
  finishedAt: Readonly<Record<string, number>>,
): number | null {
  if (thread.status !== "idle" && thread.status !== "error") return null;
  if (thread.hasPendingInteraction) return null;
  const stamped = finishedAt[thread.id];
  if (stamped !== undefined) return Math.max(stamped, thread.latestAttentionAt);
  // bb bumps a root's attention when it finishes; a child's only on failure.
  if (thread.latestAttentionAt > thread.createdAt && (thread.parentThreadId === null || thread.status === "error")) {
    return thread.latestAttentionAt;
  }
  return null;
}

/** "since 5m" for the hover card, or null when the state has no stamp. */
export function stateSince(
  kind: string,
  threadId: string,
  stamps: {
    startedAt: Readonly<Record<string, number>>;
    finishedAt: Readonly<Record<string, number>>;
    pendingAt: Readonly<Record<string, number>>;
  },
  now: number,
): string | null {
  const at =
    kind === "working"
      ? stamps.startedAt[threadId]
      : kind === "waits-on-you"
        ? stamps.pendingAt[threadId]
        : kind === "idle" || kind === "unread" || kind === "done-unseen" || kind === "failed"
          ? stamps.finishedAt[threadId]
          : undefined;
  if (at === undefined) return null;
  return formatDuration(now - at);
}

/**
 * The widest texts `trailingTime` gives up to 99 weeks, one per unit. The
 * trailing slot is as wide as the widest of them, so times line up down the
 * list; an older row widens its own.
 */
export const TRAILING_SLOT_SIZERS = ["now", "<1m", "59m", "23h", "6d", "99w"] as const;
