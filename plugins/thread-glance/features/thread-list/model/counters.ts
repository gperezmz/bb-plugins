// Group header counters and the Needs attention filter test. Pure.
import type { Family } from "./families";

export interface Counters {
  needsYou: number;
  /** Unread-failed plus queue-failed threads. */
  failed: number;
  offline: number;
  working: number;
  unread: number;
}

export const EMPTY_COUNTERS: Counters = { needsYou: 0, failed: 0, offline: 0, working: 0, unread: 0 };

/**
 * Counts the threads in the families. A thread counts what its attention
 * flags say, so a child adds to needs-you, failed, offline and unread only as
 * the Child threads in Needs attention setting lets it; working counts every thread that runs. Hidden threads carry
 * only needs-you and unread-failed flags already; archived threads never count.
 */
export function countFamilies(families: readonly Family[]): Counters {
  const counters = { ...EMPTY_COUNTERS };
  for (const family of families) {
    for (const info of [family.root, ...family.descendants]) {
      if (info.thread.isArchived) continue;
      const flags = info.attention;
      if (flags.has("needs-you")) counters.needsYou += 1;
      if (flags.has("unread-failed") || flags.has("queue-failed")) counters.failed += 1;
      if (flags.has("offline")) counters.offline += 1;
      if (info.flags.has("working")) counters.working += 1;
      if (flags.has("unread")) counters.unread += 1;
    }
  }
  return counters;
}

export function addCounters(a: Counters, b: Counters): Counters {
  return {
    needsYou: a.needsYou + b.needsYou,
    failed: a.failed + b.failed,
    offline: a.offline + b.offline,
    working: a.working + b.working,
    unread: a.unread + b.unread,
  };
}

/** The Needs attention tooltip: short enough to read at a glance. */
export const ATTENTION_SUMMARY = "Waiting on you, failed, offline, or finished and unread. Child threads count only when stuck.";

/** What the Needs attention toggle keeps, in full, for its accessible description. */
export const ATTENTION_EXPLANATION =
  "Threads only you can move forward: a question, approval or plan review waiting on you; a machine that is offline; a failed thread or queued message; finished threads you haven't opened. For a child thread, only what waits on you or is offline, or a failure whose manager is idle (Filter settings can widen this).";

/**
 * Which counters a header draws. needs-you, failed and offline
 * always; working only while collapsed, since the rows show it otherwise;
 * unread only on the More trigger, where the rows are out of sight.
 */
export function visibleCounters(counters: Counters, where: { collapsed: boolean; more: boolean }): Counters {
  return {
    needsYou: counters.needsYou,
    failed: counters.failed,
    offline: counters.offline,
    working: where.collapsed || where.more ? counters.working : 0,
    unread: where.more ? counters.unread : 0,
  };
}
