// Group header counters. Pure.
import type { Family } from "./families";

export interface Counters {
  waitsOnYou: number;
  /** Unread-failed plus queue-failed threads. */
  failed: number;
  offline: number;
  working: number;
  unread: number;
}

export const EMPTY_COUNTERS: Counters = { waitsOnYou: 0, failed: 0, offline: 0, working: 0, unread: 0 };

/**
 * Counts the threads in the families. A thread counts what its Needs attention
 * flags say, so a child adds to waits-on-you, failed, offline and unread only
 * as "Needs attention counts every child" lets it; working counts every thread that
 * runs. Hidden threads carry only waits-on-you and unread-failed flags
 * already; archived threads never count.
 */
export function countFamilies(families: readonly Family[]): Counters {
  const counters = { ...EMPTY_COUNTERS };
  for (const family of families) {
    for (const info of [family.root, ...family.descendants]) {
      if (info.thread.isArchived) continue;
      const flags = info.attention;
      if (flags.has("waits-on-you")) counters.waitsOnYou += 1;
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
    waitsOnYou: a.waitsOnYou + b.waitsOnYou,
    failed: a.failed + b.failed,
    offline: a.offline + b.offline,
    working: a.working + b.working,
    unread: a.unread + b.unread,
  };
}

/**
 * Which counters a header draws. waits-on-you, failed and offline
 * always; working only while collapsed, since the rows show it otherwise;
 * unread only on the More trigger, where the rows are out of sight.
 */
export function visibleCounters(counters: Counters, where: { collapsed: boolean; more: boolean }): Counters {
  return {
    waitsOnYou: counters.waitsOnYou,
    failed: counters.failed,
    offline: counters.offline,
    working: where.collapsed || where.more ? counters.working : 0,
    unread: where.more ? counters.unread : 0,
  };
}
