// The lifecycle actions: snooze, wake, park, resume, settle, un-settle, their
// undo, the cancel of a waiting settle and the clean-ups the list asks for.
// Each re-checks bb's thread data before it writes (busy, a time in the past;
// Settle waits for a busy tree instead), writes the lifecycle rows, and
// reports each row it changed with the row before, so the app can offer Undo.
// The module names no SDK: bb is reached through `ThreadGateway`.
import { randomUUID } from "node:crypto";
import { isBusy } from "../shared/busy";
import {
  activeRow,
  hasMark,
  hasNewAttention,
  isWaitingSettle,
  isWoke,
  parkedRow,
  sameRow,
  settledRow,
  shouldClearForPin,
  snoozedRow,
  waitingBelow,
  waitingSettleRow,
  withoutWaitingSettle,
  type LifecycleRow,
} from "../shared/lifecycle";
import { busyRefusal, childNeedsYouRefusal, SETTLE_UNDO_GONE, SNOOZE_ENDED, THREAD_GONE, TREE_CHANGED, type GatedAction } from "../shared/messages";
import { EMPTY_RECLAIM, reclaimNote, type ReclaimReport } from "../shared/reclaim-note";
import { snoozeTimeError } from "../shared/snooze";
import { ancestorIds, descendantIds, treeIds } from "../shared/thread-tree";
import type { LifecycleStore } from "./lifecycle-store";
import type { Reclaimer } from "./reclaim";
import { pinnedInOrder, type ServerThread, type ThreadGateway } from "./threads";
import { errorMessage } from "./error-message";

/** How long Undo stays available after a Settle's toast: the toast lasts 4 s, or 10 s with a reclaim note. */
const SETTLE_TOAST_MS = 4_000;
const SETTLE_TOAST_WITH_NOTE_MS = 10_000;
/** Slack for the answer to reach the window and the press to reach the server. */
const UNDO_SLACK_MS = 3_000;
const MAX_SETTLE_UNDOS = 50;

/** One thread's row before and after an action. */
export interface Change {
  threadId: string;
  before: LifecycleRow | null;
  after: LifecycleRow | null;
  /** The action unpinned the thread, and Undo pins it again. */
  unpinned: boolean;
}

export interface ActionResult {
  changes: Change[];
  reclaim: ReclaimReport;
  note: string | null;
}

/**
 * What Settle did: settled the tree, with the token its Undo takes, or, for a
 * tree with a busy thread, left a waiting settle on the thread, which Undo of
 * its changes takes back.
 */
export type SettleResult = (ActionResult & { waiting: false; undoToken: string; undoUntil: number }) | (ActionResult & { waiting: true });

/** Runs `write` in order with the other changes and publishes the records of the threads it passed to `changed`. */
export type ChangeRecords = <T>(write: (changed: (threadIds: Iterable<string>) => void) => Promise<T>) => Promise<T>;

export interface ActionDeps {
  lifecycle: LifecycleStore;
  threads: ThreadGateway;
  reclaim: Reclaimer;
  change: ChangeRecords;
  /** Told of each waiting settle Settle leaves, with the thread's tree as it read it then. */
  onWaiting?: (threadId: string, tree: readonly ServerThread[]) => void;
  now?: () => number;
  newToken?: () => string;
  warn?: (message: string) => void;
}

interface SettleSnapshotEntry extends Change {
  parentThreadId: string | null;
  pinNeighbors: { previous: string | null; next: string | null };
}

interface SettleSnapshot {
  threadId: string;
  expiresAt: number;
  entries: SettleSnapshotEntry[];
}

export interface LifecycleActions {
  snooze(threadId: string, until: number): Promise<ActionResult>;
  wake(threadId: string): Promise<ActionResult>;
  park(threadId: string): Promise<ActionResult>;
  resume(threadId: string): Promise<ActionResult>;
  settle(threadId: string): Promise<SettleResult>;
  undoSettle(threadId: string, undoToken: string): Promise<ActionResult>;
  unsettle(threadId: string): Promise<ActionResult>;
  /** Ends the thread's waiting settle, leaving the tree where it is; nothing when it has none. */
  cancelSettle(threadId: string): Promise<ActionResult>;
  undoLifecycle(changes: readonly Change[]): Promise<{ changes: Change[]; skipped: { threadId: string; reason: string }[] }>;
  dismissWoke(threadId: string): Promise<ActionResult>;
  clearPinned(threadId: string): Promise<ActionResult>;
}

const noReclaim = (changes: Change[]): ActionResult => ({ changes, reclaim: EMPTY_RECLAIM, note: null });

export function createLifecycleActions(deps: ActionDeps): LifecycleActions {
  const { lifecycle, threads, change } = deps;
  const now = deps.now ?? Date.now;
  const newToken = deps.newToken ?? randomUUID;
  const warn = deps.warn ?? (() => undefined);
  const settleUndos = new Map<string, SettleSnapshot>();
  let lastSettleAt = 0;

  const byIdOf = (snapshot: readonly ServerThread[]) => new Map(snapshot.map((thread) => [thread.id, thread]));

  async function requireThread(threadId: string): Promise<{ thread: ServerThread; snapshot: ServerThread[] }> {
    const snapshot = await threads.snapshot();
    const thread = byIdOf(snapshot).get(threadId);
    if (thread === undefined) throw new Error(THREAD_GONE);
    return { thread, snapshot };
  }

  /** Refuses the action when the thread itself has a question or approval waiting. */
  function refuseNeedsYou(action: GatedAction, thread: ServerThread): void {
    if (thread.hasPendingInteraction) throw new Error(busyRefusal(action, thread.title));
  }

  /** Refuses the action when a thread is busy. */
  function refuseBusy(action: GatedAction, tree: readonly ServerThread[]): void {
    const busy = tree.find((thread) => isBusy(thread));
    if (busy !== undefined) throw new Error(busyRefusal(action, busy.title));
  }

  /**
   * Refuses the action when a question or approval waits below the thread, at
   * any depth. Hidden threads are bb's helpers, which no one answers from the
   * list, so they neither wait for the user nor pass a chain on.
   */
  function refuseChildWaiting(action: GatedAction, snapshot: readonly ServerThread[], threadId: string): void {
    const waiting = waitingBelow(
      snapshot.filter((thread) => !thread.hidden),
      threadId,
    );
    if (waiting !== undefined) throw new Error(childNeedsYouRefusal(action, waiting.title));
  }

  /** Writes the rows, passes the touched threads to `changed`, and returns the changes. */
  function write(
    entries: readonly (readonly [string, LifecycleRow | null, boolean?])[],
    changed: (threadIds: Iterable<string>) => void,
  ): Change[] {
    const before = new Map(entries.map(([threadId]) => [threadId, lifecycle.get(threadId)]));
    const touched = new Set(lifecycle.putMany(entries.map(([threadId, row]) => [threadId, row] as const)));
    changed(touched);
    return entries.flatMap(([threadId, row, unpinned = false]): Change[] =>
      touched.has(threadId) || unpinned
        ? [{ threadId, before: before.get(threadId) ?? null, after: row === null ? null : lifecycle.get(threadId), unpinned }]
        : [],
    );
  }

  /** Runs Reclaim over what the changes left in a row. */
  async function reclaimAfter(changes: readonly Change[]): Promise<ActionResult> {
    const targets = changes.flatMap((entry) => (entry.after === null ? [] : [{ threadId: entry.threadId, row: entry.after }]));
    const reclaim = targets.length > 0 ? await deps.reclaim(targets) : EMPTY_RECLAIM;
    return { changes: [...changes], reclaim, note: reclaimNote(reclaim) };
  }

  /** Snooze and Park: both refuse a busy thread, unpin it, write one mark and reclaim. */
  async function setAside(action: "snooze" | "park", threadId: string, row: (at: number) => LifecycleRow, check?: (at: number) => void) {
    const changes = await change(async (changed) => {
      const at = now();
      check?.(at);
      const { thread, snapshot } = await requireThread(threadId);
      refuseBusy(action, [thread]);
      refuseChildWaiting(action, snapshot, threadId);
      if (thread.isPinned) await threads.unpin(threadId);
      return write([[threadId, row(at), thread.isPinned]], changed);
    });
    return reclaimAfter(changes);
  }

  /** The rows that reopen the ancestors of `threadId` that carry a parked, snoozed or settled mark. */
  function reopenEntries(snapshot: readonly ServerThread[], threadId: string): [string, null][] {
    return ancestorIds(byIdOf(snapshot), threadId).flatMap((ancestorId): [string, null][] => {
      const row = lifecycle.get(ancestorId);
      return hasMark(row) ? [[ancestorId, null]] : [];
    });
  }

  /** Puts pins back after a failed settle: only where nothing changed since, and with their place in bb's pin order. */
  async function restorePins(
    unpinned: readonly ServerThread[],
    before: ServerThread[],
    rowsBefore: ReadonlyMap<string, LifecycleRow | null>,
  ): Promise<string[]> {
    const failed: string[] = [];
    let current: Map<string, ServerThread>;
    try {
      current = byIdOf(await threads.snapshot());
    } catch {
      return unpinned.map((thread) => thread.title);
    }
    const order = pinnedInOrder(before);
    for (const original of [...unpinned].reverse()) {
      const now = current.get(original.id);
      if (now === undefined || now.isPinned || now.parentThreadId !== original.parentThreadId) continue;
      if (!sameRow(lifecycle.get(original.id), rowsBefore.get(original.id))) continue;
      try {
        await threads.pin(original.id);
        const index = order.findIndex((pinned) => pinned.id === original.id);
        await threads.reorderPinned(original.id, order[index - 1]?.id ?? null, order[index + 1]?.id ?? null);
      } catch {
        failed.push(original.title);
      }
    }
    return failed;
  }

  /** Keeps a Settle's snapshot until its Undo can no longer be pressed, and no more than a few at a time. */
  function rememberSettle(token: string, snapshot: SettleSnapshot): void {
    const at = now();
    for (const [held, entry] of settleUndos) if (entry.expiresAt <= at) settleUndos.delete(held);
    while (settleUndos.size >= MAX_SETTLE_UNDOS) settleUndos.delete(settleUndos.keys().next().value!);
    settleUndos.set(token, snapshot);
  }

  return {
    snooze: (threadId, until) =>
      setAside(
        "snooze",
        threadId,
        (at) => snoozedRow(until, at),
        (at) => {
          const reason = snoozeTimeError(until, at);
          if (reason !== null) throw new Error(reason);
        },
      ),

    park: (threadId) => setAside("park", threadId, parkedRow),

    async wake(threadId) {
      return noReclaim(
        await change(async (changed) => {
          const row = lifecycle.get(threadId);
          if (row === null || row.snoozeUntil === null) return [];
          return write([[threadId, null]], changed);
        }),
      );
    },

    async resume(threadId) {
      return noReclaim(
        await change(async (changed) => {
          await requireThread(threadId);
          return write([[threadId, activeRow()]], changed);
        }),
      );
    },

    async settle(threadId) {
      const settled = await change(async (changed) => {
        const first = await threads.snapshot();
        const firstById = byIdOf(first);
        if (!firstById.has(threadId)) throw new Error(THREAD_GONE);
        const ids = treeIds(first, threadId);
        const tree = ids.map((id) => firstById.get(id)!);
        refuseChildWaiting("settle", first, threadId);
        refuseNeedsYou("settle", firstById.get(threadId)!);
        // A busy tree is settled once it is idle: its attention moves meanwhile, which is no change to the tree.
        const waitedFor = tree.some((thread) => isBusy(thread));
        const rowsBefore = new Map(ids.map((id) => [id, lifecycle.get(id)]));
        const unpinned: ServerThread[] = [];
        try {
          // A tree that waits keeps its pins until the settle lands, so ending the wait leaves it as it was.
          for (const thread of waitedFor ? [] : tree) {
            if (!thread.isPinned) continue;
            await threads.unpin(thread.id);
            unpinned.push(thread);
          }
          const second = await threads.snapshot();
          const secondById = byIdOf(second);
          const currentIds = treeIds(second, threadId);
          const current = currentIds.flatMap((id) => (secondById.has(id) ? [secondById.get(id)!] : []));
          const same =
            current.length === tree.length &&
            current.every((thread) => {
              const was = firstById.get(thread.id);
              return (
                was !== undefined &&
                thread.parentThreadId === was.parentThreadId &&
                (waitedFor || !thread.isPinned) &&
                (waitedFor || !hasNewAttention(was.latestAttentionAt, thread.latestAttentionAt)) &&
                sameRow(lifecycle.get(thread.id), rowsBefore.get(thread.id))
              );
            });
          if (!same) throw new Error(TREE_CHANGED);
          refuseChildWaiting("settle", second, threadId);
          refuseNeedsYou("settle", secondById.get(threadId)!);
          if (waitedFor || current.some((thread) => isBusy(thread))) {
            const isUnpinned = (id: string) => unpinned.some((u) => u.id === id);
            const changes = write(
              [
                [threadId, waitingSettleRow(now(), lifecycle.get(threadId)), isUnpinned(threadId)] as const,
                ...unpinned.filter((u) => u.id !== threadId).map((u) => [u.id, lifecycle.get(u.id), true] as const),
              ],
              changed,
            );
            deps.onWaiting?.(threadId, current);
            return { waiting: true as const, changes, entries: [] };
          }
          const at = (lastSettleAt = Math.max(now(), lastSettleAt + 1));
          const order = pinnedInOrder(first);
          const changes = write(
            current.map((thread) => [thread.id, settledRow(at, "manual"), unpinned.some((u) => u.id === thread.id)] as const),
            changed,
          );
          const entries: SettleSnapshotEntry[] = changes.map((entry) => {
            const index = order.findIndex((pinned) => pinned.id === entry.threadId);
            return {
              ...entry,
              parentThreadId: secondById.get(entry.threadId)?.parentThreadId ?? null,
              pinNeighbors: { previous: order[index - 1]?.id ?? null, next: order[index + 1]?.id ?? null },
            };
          });
          return { waiting: false as const, changes, entries };
        } catch (error) {
          const failed = await restorePins(unpinned, first, rowsBefore);
          if (failed.length > 0) {
            const reason = errorMessage(error);
            throw new Error(`${reason}. Could not restore pins for: ${failed.join(", ")}`);
          }
          throw error;
        }
      });
      if (settled.waiting) return { ...noReclaim(settled.changes), waiting: true };
      const done = await reclaimAfter(settled.changes);
      const undoToken = newToken();
      const undoUntil = now() + (done.note === null ? SETTLE_TOAST_MS : SETTLE_TOAST_WITH_NOTE_MS) + UNDO_SLACK_MS;
      rememberSettle(undoToken, { threadId, expiresAt: undoUntil, entries: settled.entries });
      return { ...done, waiting: false, undoToken, undoUntil };
    },

    async cancelSettle(threadId) {
      return noReclaim(
        await change(async (changed) => {
          const row = lifecycle.get(threadId);
          return row !== null && isWaitingSettle(row) ? write([[threadId, withoutWaitingSettle(row)]], changed) : [];
        }),
      );
    },

    async undoSettle(threadId, undoToken) {
      const held = settleUndos.get(undoToken);
      if (held === undefined || held.threadId !== threadId || held.expiresAt <= now()) {
        settleUndos.delete(undoToken);
        throw new Error(SETTLE_UNDO_GONE);
      }
      settleUndos.delete(undoToken);
      return noReclaim(
        await change(async (changed) => {
          const byId = byIdOf(await threads.snapshot());
          const restoring: [string, LifecycleRow | null][] = [];
          const repin: SettleSnapshotEntry[] = [];
          for (const entry of held.entries) {
            const thread = byId.get(entry.threadId);
            // Keeps what changed since: a moved or pinned thread, new work, another mark.
            if (
              thread === undefined ||
              thread.parentThreadId !== entry.parentThreadId ||
              thread.isPinned ||
              isBusy(thread) ||
              !sameRow(lifecycle.get(entry.threadId), entry.after)
            ) {
              continue;
            }
            restoring.push([entry.threadId, entry.before]);
            if (entry.unpinned) repin.push(entry);
          }
          const changes = write(restoring, changed);
          for (const entry of repin) {
            try {
              await threads.pin(entry.threadId);
              await threads.reorderPinned(entry.threadId, entry.pinNeighbors.previous, entry.pinNeighbors.next);
            } catch (error) {
              warn(`could not pin ${entry.threadId} again: ${errorMessage(error)}`);
            }
          }
          return changes;
        }),
      );
    },

    async unsettle(threadId) {
      return noReclaim(
        await change(async (changed) => {
          const snapshot = await threads.snapshot();
          if (!snapshot.some((thread) => thread.id === threadId)) throw new Error(THREAD_GONE);
          const entries: [string, LifecycleRow | null][] = [[threadId, activeRow()]];
          // Settled descendants follow the automatic rules again; the user did not choose Active for each.
          for (const id of descendantIds(snapshot, threadId)) {
            if (lifecycle.get(id)?.settledAt != null) entries.push([id, null]);
          }
          entries.push(...reopenEntries(snapshot, threadId));
          return write(entries, changed);
        }),
      );
    },

    async undoLifecycle(changes) {
      const skipped: { threadId: string; reason: string }[] = [];
      const done = await change(async (changed) => {
        const at = now();
        const restoring: [string, LifecycleRow | null][] = [];
        const repin: string[] = [];
        for (const entry of changes) {
          if (!sameRow(lifecycle.get(entry.threadId), entry.after)) {
            skipped.push({ threadId: entry.threadId, reason: "It changed since." });
          } else if (entry.before?.snoozeUntil != null && entry.before.snoozeUntil <= at) {
            skipped.push({ threadId: entry.threadId, reason: SNOOZE_ENDED });
          } else {
            restoring.push([entry.threadId, entry.before]);
            if (entry.unpinned) repin.push(entry.threadId);
          }
        }
        const written = write(restoring, changed);
        if (repin.length > 0) {
          const byId = byIdOf(await threads.snapshot());
          for (const threadId of repin) {
            if (byId.get(threadId)?.isPinned !== false) continue;
            try {
              await threads.pin(threadId);
            } catch (error) {
              warn(`could not pin ${threadId} again: ${errorMessage(error)}`);
            }
          }
        }
        return written;
      });
      return { changes: done, skipped };
    },

    async dismissWoke(threadId) {
      return noReclaim(
        await change(async (changed) => {
          const row = lifecycle.get(threadId);
          if (row === null) return [];
          const byId = byIdOf(await threads.snapshot());
          const thread = byId.get(threadId);
          if (thread === undefined || !isWoke(row, thread, now())) return [];
          return write([[threadId, null]], changed);
        }),
      );
    },

    async clearPinned(threadId) {
      return noReclaim(
        await change(async (changed) => {
          if (lifecycle.get(threadId) === null) return [];
          const byId = byIdOf(await threads.snapshot());
          const thread = byId.get(threadId);
          if (thread === undefined || !shouldClearForPin(lifecycle.get(threadId), thread)) return [];
          return write([[threadId, null]], changed);
        }),
      );
    },
  };
}
