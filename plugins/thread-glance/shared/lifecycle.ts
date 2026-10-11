// A thread's lifecycle row and the rules that turn it, with bb's thread data,
// into a shelf. Pure: the server stores the rows, the app and the server both
// apply the rules.
import * as z from "zod/mini";
import { hasQueuedMessage, isBusy, isWorking, type BusyInput } from "./busy";

const HOUR_MS = 60 * 60_000;

/**
 * What the server keeps for a thread the user has put somewhere. A thread
 * without a row follows the automatic rules. The marks are exclusive: every
 * writer here sets one and clears the others, and the shelf rules read them in
 * the order parked, snoozed, settled.
 */
export const lifecycleRowSchema = z.object({
  /** When the thread was settled; null when it is not. */
  settledAt: z.nullable(z.number()),
  /** Who settled it: "manual" by the user, "auto" by the server's pass. Null exactly when `settledAt` is. */
  settledKind: z.nullable(z.enum(["manual", "auto"])),
  /** When the thread was parked. */
  parkedAt: z.nullable(z.number()),
  /** When the snooze ends. A row whose time has passed is a Woke marker until the thread is opened or dismissed. */
  snoozeUntil: z.nullable(z.number()),
  /** When the snooze was set, to tell attention that came after it. */
  snoozedAt: z.nullable(z.number()),
  /** Set by Resume and Un-settle; lasts until the thread next starts a turn. */
  activeOverride: z.boolean(),
});
export type LifecycleRow = z.infer<typeof lifecycleRowSchema>;

export type SettledKind = NonNullable<LifecycleRow["settledKind"]>;

/** A row with no mark. The server stores no such row. */
export const EMPTY_ROW: LifecycleRow = Object.freeze({
  settledAt: null,
  settledKind: null,
  parkedAt: null,
  snoozeUntil: null,
  snoozedAt: null,
  activeOverride: false,
});

/** Whether the row carries no mark, so the thread follows the automatic rules. */
export function isEmptyRow(row: LifecycleRow): boolean {
  return (
    row.settledAt === null &&
    row.parkedAt === null &&
    row.snoozeUntil === null &&
    row.snoozedAt === null &&
    !row.activeOverride
  );
}

/** Whether two rows hold the same marks. */
export function sameRow(left: LifecycleRow | null | undefined, right: LifecycleRow | null | undefined): boolean {
  const a = left ?? EMPTY_ROW;
  const b = right ?? EMPTY_ROW;
  return (
    a.settledAt === b.settledAt &&
    a.settledKind === b.settledKind &&
    a.parkedAt === b.parkedAt &&
    a.snoozeUntil === b.snoozeUntil &&
    a.snoozedAt === b.snoozedAt &&
    a.activeOverride === b.activeOverride
  );
}

/** The row Park writes. */
export function parkedRow(now: number): LifecycleRow {
  return { ...EMPTY_ROW, parkedAt: now };
}

/** The row Snooze writes: wake at `until`, set at `now`. */
export function snoozedRow(until: number, now: number): LifecycleRow {
  return { ...EMPTY_ROW, snoozeUntil: until, snoozedAt: now };
}

/** The row Settle writes. */
export function settledRow(now: number, kind: SettledKind): LifecycleRow {
  return { ...EMPTY_ROW, settledAt: now, settledKind: kind };
}

/** The row Resume and Un-settle write. */
export function activeRow(): LifecycleRow {
  return { ...EMPTY_ROW, activeOverride: true };
}

/**
 * Whether the row is a mark the user set by hand: a manual settle or the
 * active override. Auto-settle leaves such a thread alone.
 */
export function hasManualMark(row: LifecycleRow | null | undefined): boolean {
  return row != null && (row.settledKind === "manual" || row.activeOverride);
}

/** Shelves, in the order the list draws them. */
export const SHELVES = ["pinned", "active", "working", "inactive", "snoozed", "parked", "settled"] as const;
export type Shelf = (typeof SHELVES)[number];

/** What the shelf rules read from a thread, from bb's browser payload or the server's thread data. */
export interface ShelfThread extends BusyInput {
  isPinned: boolean;
  /** bb's latest-attention time for the thread, epoch ms. */
  latestAttentionAt: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Whether attention arrived after a moment: bb's latest-attention time moved
 * past it. The comparison every rule below uses.
 */
export function hasNewAttention(since: number, latestAttentionAt: number): boolean {
  return latestAttentionAt > since;
}

export type WakeReason = "time" | "attention";

/**
 * Why a snoozed thread has woken, or null while it still sleeps (and for a
 * row that is not a snooze): its wake time has come, or attention arrived
 * after the snooze was set. The row stays until the thread is opened or the
 * marker dismissed, so every window and a reload read the same answer.
 */
export function wakeReason(
  row: LifecycleRow | null | undefined,
  thread: Pick<ShelfThread, "latestAttentionAt">,
  now: number,
): WakeReason | null {
  if (row == null || row.snoozeUntil === null) return null;
  if (row.snoozedAt !== null && hasNewAttention(row.snoozedAt, thread.latestAttentionAt)) return "attention";
  return row.snoozeUntil <= now ? "time" : null;
}

/** Whether the thread has a Woke marker. */
export function isWoke(
  row: LifecycleRow | null | undefined,
  thread: Pick<ShelfThread, "latestAttentionAt">,
  now: number,
): boolean {
  return wakeReason(row, thread, now) !== null;
}

/** The shelves the row's marks alone can put a thread on. */
export type MarkShelf = "active" | "parked" | "snoozed" | "settled";

/**
 * The shelf rules 1 to 6, without pinning and without the Working and
 * Inactive split of Active:
 * 1. no row: Active;
 * 2. busy: Active;
 * 3. parked: Parked, unless attention arrived after it was parked;
 * 4. snoozed: Snoozed, unless it woke;
 * 5. settled: Settled, unless attention arrived after it was settled;
 * 6. otherwise Active.
 */
export function markShelf(
  row: LifecycleRow | null | undefined,
  thread: ShelfThread,
  now: number,
): MarkShelf {
  if (row == null) return "active";
  if (isBusy(thread)) return "active";
  if (row.parkedAt !== null && !hasNewAttention(row.parkedAt, thread.latestAttentionAt)) return "parked";
  if (row.snoozeUntil !== null && !isWoke(row, thread, now)) return "snoozed";
  if (row.settledAt !== null && !hasNewAttention(row.settledAt, thread.latestAttentionAt)) return "settled";
  return "active";
}

/**
 * The mark attention has made stale: "parked" or "settled" when attention
 * arrived after it, so the server clears it and the thread is on the
 * automatic rules again. A snooze is not cleared this way; it becomes a Woke
 * marker.
 */
export function staleMark(
  row: LifecycleRow | null | undefined,
  thread: Pick<ShelfThread, "latestAttentionAt">,
): "parked" | "settled" | null {
  if (row == null) return null;
  if (row.parkedAt !== null && hasNewAttention(row.parkedAt, thread.latestAttentionAt)) return "parked";
  if (row.settledAt !== null && hasNewAttention(row.settledAt, thread.latestAttentionAt)) return "settled";
  return null;
}

/** The row with its stale mark cleared, or null when nothing is stale. */
export function clearStaleMark(
  row: LifecycleRow | null | undefined,
  thread: Pick<ShelfThread, "latestAttentionAt">,
): LifecycleRow | null {
  const stale = staleMark(row, thread);
  if (row == null || stale === null) return null;
  return stale === "parked" ? { ...row, parkedAt: null } : { ...row, settledAt: null, settledKind: null };
}

/**
 * Whether a window that sees this thread should ask the server to clear its
 * row. Pin is bb's own action and wins over any row, so a pinned thread with
 * a row has the row cleared and, once unpinned, follows the automatic rules.
 */
export function shouldClearForPin(row: LifecycleRow | null | undefined, thread: Pick<ShelfThread, "isPinned">): boolean {
  return thread.isPinned && row != null;
}

/** What a thread's tree says about the thread's own shelf. */
export interface TreeSignals {
  /** Some thread in the tree is working (see `isWorking`). */
  working: boolean;
  /** Some thread in the tree has a question or approval pending. */
  needsYou: boolean;
}

/** The tree signals of threads that make up one tree. */
export function treeSignals(tree: readonly BusyInput[]): TreeSignals {
  return {
    working: tree.some((thread) => isWorking(thread)),
    needsYou: tree.some((thread) => thread.hasPendingInteraction),
  };
}

export interface ShelfOptions {
  now: number;
  /** The Working shelf setting. */
  workingShelf: boolean;
  /** The Inactive shelf setting. */
  inactiveShelf: boolean;
  /** Hours before inactive. */
  hoursBeforeInactive: number;
  /** The thread's tree; absent, the thread alone is its tree. */
  tree?: TreeSignals;
}

/** The latest of created, updated and latest attention: a thread's last activity. */
export function lastActivityAt(thread: Pick<ShelfThread, "createdAt" | "updatedAt" | "latestAttentionAt">): number {
  return Math.max(thread.createdAt, thread.updatedAt, thread.latestAttentionAt);
}

/**
 * The shelf a thread is on. A pinned thread is on Pinned whatever its row
 * says. Otherwise `markShelf` decides, and a thread left in Active moves to
 * Working when the setting is on and its tree is working, unless it is woke or
 * something in the tree needs the user; or to Inactive when the setting is on,
 * it is not busy and has had no activity for the hours set, unless it needs
 * the user or is woke.
 */
export function shelfOf(row: LifecycleRow | null | undefined, thread: ShelfThread, options: ShelfOptions): Shelf {
  if (thread.isPinned) return "pinned";
  const marked = markShelf(row, thread, options.now);
  if (marked !== "active") return marked;
  const woke = isWoke(row, thread, options.now);
  const tree = options.tree ?? treeSignals([thread]);
  if (options.workingShelf && tree.working && !woke && !tree.needsYou) return "working";
  if (
    options.inactiveShelf &&
    !isBusy(thread) &&
    !woke &&
    !thread.hasPendingInteraction &&
    !hasQueuedMessage(thread) &&
    options.now - lastActivityAt(thread) >= options.hoursBeforeInactive * HOUR_MS
  ) {
    return "inactive";
  }
  return "active";
}

/**
 * Rows to clear because their thread has left them behind: a stale parked or
 * settled mark. Returns the cleared row for each thread whose row changed.
 */
export function clearStaleMarks(
  rows: ReadonlyMap<string, LifecycleRow>,
  threads: ReadonlyMap<string, Pick<ShelfThread, "latestAttentionAt">>,
): Map<string, LifecycleRow | null> {
  const cleared = new Map<string, LifecycleRow | null>();
  for (const [threadId, row] of rows) {
    const thread = threads.get(threadId);
    if (thread === undefined) continue;
    const next = clearStaleMark(row, thread);
    if (next !== null) cleared.set(threadId, isEmptyRow(next) ? null : next);
  }
  return cleared;
}

/** The soonest wake time among the rows still in the future, for a timer; null when none. */
export function nextWakeAt(rows: Iterable<LifecycleRow>, now: number): number | null {
  let soonest: number | null = null;
  for (const row of rows) {
    if (row.snoozeUntil !== null && row.snoozeUntil > now && (soonest === null || row.snoozeUntil < soonest)) {
      soonest = row.snoozeUntil;
    }
  }
  return soonest;
}

/** The longest delay `setTimeout` takes; a longer one fires at once. */
export const MAX_TIMER_MS = 2_147_483_647;
