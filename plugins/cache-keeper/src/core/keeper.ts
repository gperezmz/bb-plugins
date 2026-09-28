/**
 * What Cache Keeper does to one thread on its own at a moment: compact it,
 * or check in on a stalled task. Keep-warms are planned for a whole thread
 * tree at once, in `tree.ts`.
 *
 * It acts only on an idle Claude Code thread with no pending interaction.
 * A compaction goes at the deadline, a minute before the cache expires, to a
 * thread that is not waiting; a deadline that passed more than that minute ago
 * is past acting on, since the cache is already cold. A check-in goes as soon
 * as a task has stalled, whatever the cost stop or Skip say.
 */
import { dueCheckIn, stalledDueAt, type TaskClock } from "./checkins";
import type { Rates } from "./line";
import { CACHE_MARGIN_MS } from "./transcript";
import type { TaskKind, WaitItem } from "./waiting";

/** The thread's idle stretch: from turning idle to the next turn that is not Cache Keeper's. */
export interface IdleStretch {
  startedAt: number;
  compactedAt: number | null;
  compactSkipped: boolean;
  warmSkipped: boolean;
  /** The real cost charged to its keep-warms and check-ins so far, with their share of the turns they forced above. */
  chargedUsd: number;
}

export const newIdleStretch = (at: number): IdleStretch => ({
  startedAt: at,
  compactedAt: null,
  compactSkipped: false,
  warmSkipped: false,
  chargedUsd: 0,
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
  tasks: readonly WatchedTask[];
  /** Null when the transcript has no request with a cache write yet. */
  deadline: number | null;
  context: number | null;
  compactOn: boolean;
  /** The thread's compaction line; null is "never". */
  line: number | null;
  stretch: IdleStretch | null;
  checkIns: boolean;
  waitMs: number;
}

export type KeeperAction = { kind: "compact" } | { kind: "check-in"; tasks: string[] };

export interface KeeperPlan {
  /** A compaction is due: every condition holds but the deadline. */
  compactionDue: boolean;
  action: KeeperAction | null;
  /** The next moment this thread's own rules fall due, for the timer. */
  wakeAt: number | null;
}

const NONE: KeeperPlan = { compactionDue: false, action: null, wakeAt: null };

/** How long after the deadline the cache is still warm enough to act: the margin the deadline leaves. */
const ACT_WINDOW_MS = CACHE_MARGIN_MS;

const inWindow = (now: number, deadline: number | null) => deadline !== null && now >= deadline && now < deadline + ACT_WINDOW_MS;

export function plan(input: KeeperInput): KeeperPlan {
  const { now, stretch } = input;
  if (!input.claudeCode || input.status !== "idle" || input.hasPendingInteraction) return NONE;
  if (input.waiting) {
    if (!input.checkIns || input.tasks.length === 0) return NONE;
    const due = input.tasks.filter((t) => dueCheckIn(t.clock, now, input.waitMs)).map((t) => t.id);
    const next = Math.min(...input.tasks.map((t) => stalledDueAt(t.clock, input.waitMs)));
    return { compactionDue: false, action: due.length > 0 ? { kind: "check-in", tasks: due } : null, wakeAt: next > now ? next : null };
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
    action: compactionDue && inWindow(now, input.deadline) ? { kind: "compact" } : null,
    wakeAt: compactionDue && input.deadline! > now ? input.deadline : null,
  };
}

/** The cost stop: one cold rewrite of the thread's own context at its own cache lifetime's write price. */
export const costStopUsd = (rates: Rates, context: number) => rates.w * context;

/**
 * Whether a thread's next keep-warm would take its charges in this idle
 * stretch past its cost stop. Without a price or a context the stop is
 * unknown, and it counts as reached.
 */
export function pastCostStop(chargedUsd: number, forecastUsd: number, rates: Rates | null, context: number | null): boolean {
  if (rates === null || context === null) return true;
  return chargedUsd + forecastUsd > costStopUsd(rates, context);
}

/**
 * Whether keep-warms are pointless because the only thing waited on is a
 * scheduled message due after the cost stop would be reached.
 */
export function scheduledBeyondStop(input: {
  items: readonly WaitItem[];
  chargedUsd: number;
  forecastUsd: number;
  rates: Rates | null;
  context: number | null;
  deadline: number | null;
  lifetimeMs: number | null;
}): boolean {
  const { items, rates, context, deadline, lifetimeMs, forecastUsd } = input;
  if (items.length === 0 || !items.every((i) => i.kind === "scheduled")) return false;
  if (rates === null || context === null || deadline === null || lifetimeMs === null || forecastUsd <= 0) return false;
  const left = costStopUsd(rates, context) - input.chargedUsd;
  const affordable = Math.max(0, Math.floor(left / forecastUsd));
  const interval = lifetimeMs - ACT_WINDOW_MS;
  // The cache stays warm until the last affordable keep-warm's cache expires.
  const stopAt = deadline + affordable * interval + ACT_WINDOW_MS;
  const due = Math.min(...items.map((i) => (i.kind === "scheduled" ? i.dueAt : Infinity)));
  return due > stopAt;
}
