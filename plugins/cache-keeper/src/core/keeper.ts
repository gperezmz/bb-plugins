/**
 * What Cache Keeper does to one thread, and what it shows, at a moment.
 *
 * It acts only on an idle Claude Code thread with no pending interaction,
 * and only at its deadline: a minute before the cache expires. A thread that
 * is waiting gets keep-warms and check-ins; one that is not may be compacted.
 * A deadline that passed more than that minute ago is past acting on: the
 * cache is already cold.
 */
import { dueCheckIn, nextCheckInAt, type CheckInReason, type TaskClock } from "./checkins";
import type { Rates } from "./line";
import { CACHE_MARGIN_MS } from "./transcript";
import type { TaskKind, WaitItem } from "./waiting";

/** The thread's idle stretch: from turning idle to the next turn Cache Keeper did not cause. */
export interface IdleStretch {
  startedAt: number;
  compactedAt: number | null;
  compactSkipped: boolean;
  warmSkipped: boolean;
  /** Estimated spend on keep-warms and check-ins in this stretch. */
  warmSpentUsd: number;
}

export const newIdleStretch = (at: number): IdleStretch => ({
  startedAt: at,
  compactedAt: null,
  compactSkipped: false,
  warmSkipped: false,
  warmSpentUsd: 0,
});

/** A background task Cache Keeper watches, with its clocks. */
export interface WatchedTask {
  kind: TaskKind;
  id: string;
  clock: TaskClock;
}

export interface KeeperInput {
  now: number;
  claudeCode: boolean;
  status: string;
  hasPendingInteraction: boolean;
  waiting: boolean;
  /** What it waits on, for the scheduled-message rule. */
  items: readonly WaitItem[];
  tasks: readonly WatchedTask[];
  /** Null when the transcript has no request with a cache write yet. */
  deadline: number | null;
  lifetimeMs: number | null;
  context: number | null;
  rates: Rates | null;
  compactOn: boolean;
  /** The thread's compaction line; null is "never". */
  line: number | null;
  stretch: IdleStretch | null;
  checkIns: boolean;
  waitMs: number;
}

export type KeeperAction =
  | { kind: "compact" }
  | { kind: "keep-warm" }
  | { kind: "check-in"; tasks: { id: string; reason: CheckInReason }[] };

export interface KeeperPlan {
  /** A compaction is due: every condition holds but the deadline. */
  compactionDue: boolean;
  /** A keep-warm or check-in is due. */
  warmDue: boolean;
  /** When the next keep-warm or check-in is sent, while one is due. */
  nextWarmAt: number | null;
  action: KeeperAction | null;
}

const NONE: KeeperPlan = { compactionDue: false, warmDue: false, nextWarmAt: null, action: null };

/** How long after the deadline the cache is still warm enough to act: the margin the deadline leaves. */
const ACT_WINDOW_MS = CACHE_MARGIN_MS;

/** Estimated cost of one keep-warm: a cache read of the context. */
export const keepWarmUsd = (rates: Rates, context: number) => rates.r * context;

/** The cost stop: a cold rewrite of the context. */
export const costStopUsd = (rates: Rates, context: number) => rates.w * context;

const inWindow = (now: number, deadline: number | null) => deadline !== null && now >= deadline && now < deadline + ACT_WINDOW_MS;

/**
 * Whether keep-warms are pointless because the only thing waited on is a
 * scheduled message due after the cost stop would be reached.
 */
function scheduledBeyondStop(input: KeeperInput): boolean {
  const { items, rates, context, deadline, lifetimeMs, stretch } = input;
  if (items.length === 0 || !items.every((i) => i.kind === "scheduled")) return false;
  if (rates === null || context === null || deadline === null || lifetimeMs === null) return false;
  const each = keepWarmUsd(rates, context);
  if (each <= 0) return false;
  const left = costStopUsd(rates, context) - (stretch?.warmSpentUsd ?? 0);
  const affordable = Math.max(0, Math.ceil(left / each));
  const interval = lifetimeMs - ACT_WINDOW_MS;
  // The cache stays warm until the last affordable keep-warm's cache expires.
  const stopAt = deadline + Math.max(0, affordable - 1) * interval + interval;
  const due = Math.min(...items.map((i) => (i.kind === "scheduled" ? i.dueAt : Infinity)));
  return due > stopAt;
}

export function plan(input: KeeperInput): KeeperPlan {
  const { now, stretch } = input;
  if (!input.claudeCode || input.status !== "idle" || input.hasPendingInteraction) return NONE;
  if (input.waiting) {
    if (!input.checkIns || stretch === null || stretch.warmSkipped) return NONE;
    if (input.rates !== null && input.context !== null && stretch.warmSpentUsd >= costStopUsd(input.rates, input.context)) return NONE;
    if (scheduledBeyondStop(input)) return NONE;
    const due = input.tasks
      .map((t) => ({ id: t.id, reason: dueCheckIn(t.clock, now, input.waitMs) }))
      .filter((t): t is { id: string; reason: CheckInReason } => t.reason !== null);
    const nextCheckIn = Math.min(...input.tasks.map((t) => nextCheckInAt(t.clock, now, input.waitMs)));
    const warmCandidates = [nextCheckIn];
    if (input.deadline !== null && now < input.deadline + ACT_WINDOW_MS) warmCandidates.push(input.deadline);
    const next = Math.min(...warmCandidates);
    const nextWarmAt = Number.isFinite(next) ? next : null;
    let action: KeeperAction | null = null;
    if (due.length > 0) action = { kind: "check-in", tasks: due };
    else if (inWindow(now, input.deadline)) action = { kind: "keep-warm" };
    return { compactionDue: false, warmDue: true, nextWarmAt, action };
  }

  const compactionDue =
    input.compactOn &&
    stretch !== null &&
    stretch.compactedAt === null &&
    !stretch.compactSkipped &&
    input.context !== null &&
    input.line !== null &&
    input.context >= input.line &&
    input.deadline !== null &&
    now < input.deadline + ACT_WINDOW_MS;
  return {
    compactionDue,
    warmDue: false,
    nextWarmAt: null,
    action: compactionDue && inWindow(now, input.deadline) ? { kind: "compact" } : null,
  };
}
