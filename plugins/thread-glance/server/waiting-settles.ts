// Waiting settles: a Settle chosen for a thread tree while a thread in it was
// busy, kept in the thread's lifecycle row. The server looks at each one
// whenever bb announces a thread event and every few seconds while any waits,
// and settles the tree once no thread in it is busy, or ends the settle where
// `waitingSettleVerdict` says. The module names no SDK: bb is reached through
// `ThreadGateway`.
import { hasQueuedMessage } from "../shared/busy";
import { isWaitingSettle, settledRow, withoutWaitingSettle, type LifecycleRow } from "../shared/lifecycle";
import { treeIds } from "../shared/thread-tree";
import { waitingSettleVerdict, type TurnRecord, type WaitingSettleVerdict } from "../shared/waiting-settle";
import type { ChangeRecords } from "./actions";
import { errorMessage } from "./error-message";
import type { LifecycleStore } from "./lifecycle-store";
import type { Reclaimer } from "./reclaim";
import { createSerialQueue } from "./serial";
import type { ServerThread, ThreadGateway } from "./threads";

/** How often the server looks at the waiting settles while any waits, for the work bb announces no event for. */
export const POLL_MS = 5_000;
/**
 * How long a tree stays idle before its settle lands. A child's turn that
 * ends starts bb's notification turn on its parent a moment later, and the
 * settle should not land in between.
 */
export const IDLE_GRACE_MS = 5_000;

/** What a thread event tells the waiting settles about one thread. */
export interface WaitingSettleEvent {
  threadId: string;
  /** Turns the event itself reports, such as a failure or a message the user queued, beside those bb recorded. */
  turns?: readonly TurnRecord[];
}

export interface WaitingSettles {
  /**
   * Notes a settle Settle just left waiting, with its tree as Settle read it:
   * messages already queued there were the user's before they chose it, so
   * the turns they start do not end it.
   */
  chosen(threadId: string, tree: readonly ServerThread[]): void;
  /**
   * Looks at every waiting settle now: settles each tree that has been idle
   * for `IDLE_GRACE_MS`, unpinning it first, and ends each settle that a pin,
   * a question, a turn of the user's or a failure ended. `event` names a
   * thread whose recorded turns are read at once rather than only before a
   * landing. Checks run one at a time, and those asked for while one waits to
   * start share it.
   */
  check(event?: WaitingSettleEvent): Promise<void>;
  /** `check` without waiting for it; a failure is logged. */
  poke(event?: WaitingSettleEvent): void;
  /** Checks every `POLL_MS` while a settle waits, until `signal` aborts. */
  run(signal: AbortSignal): Promise<void>;
}

export interface WaitingSettlesDeps {
  lifecycle: LifecycleStore;
  threads: Pick<ThreadGateway, "snapshot" | "turnsSince" | "unpin" | "pin">;
  reclaim: Reclaimer;
  change: ChangeRecords;
  now?: () => number;
  /** Resolves after `ms`, or once `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  warn?: (message: string) => void;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** The waiting rows: thread id and the time its settle was chosen. */
function waitingRows(lifecycle: LifecycleStore): [string, number][] {
  return [...lifecycle.all()].flatMap(([threadId, row]): [string, number][] =>
    isWaitingSettle(row) ? [[threadId, row.waitingSettleAt]] : [],
  );
}

export function createWaitingSettles(deps: WaitingSettlesDeps): WaitingSettles {
  const { lifecycle, threads, change } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const warn = deps.warn ?? (() => undefined);
  const inOrder = createSerialQueue();
  /** When each waiting settle's tree was first seen idle, since it last was busy. In memory: a restart waits the grace again. */
  const idleSince = new Map<string, number>();
  /**
   * The threads of each waiting settle's tree that had a message queued when
   * it was chosen, whose turns asked for by the user do not end it. In memory:
   * after a restart such a turn ends it.
   */
  const queuedAtChoice = new Map<string, ReadonlySet<string>>();

  /** The tree of `rootId` as `byId` has it, or null when bb no longer lists the thread. */
  const treeOf = (snapshot: readonly ServerThread[], byId: ReadonlyMap<string, ServerThread>, rootId: string) =>
    byId.has(rootId) ? treeIds(snapshot, rootId).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) : null;

  /** The turns the threads recorded after `since` that bear on `rootId`'s settle, or null when bb could not say for one of them. */
  async function turnsOf(rootId: string, ids: readonly string[], since: number): Promise<TurnRecord[] | null> {
    const queued = queuedAtChoice.get(rootId) ?? new Set<string>();
    try {
      const perThread = await Promise.all(ids.map((id) => threads.turnsSince(id, since)));
      return perThread.flatMap((turns, index) =>
        queued.has(ids[index]!) ? turns.filter((turn) => turn.kind !== "requested" || !turn.byUser) : turns,
      );
    } catch (error) {
      warn(`could not read the turns of a waiting settle's tree: ${errorMessage(error)}`);
      return null;
    }
  }

  /** What becomes of the settle on `rootId`, waiting since `since`, read from bb now; `null` leaves it for the next check. */
  async function decide(
    rootId: string,
    since: number,
    snapshot: readonly ServerThread[],
    byId: ReadonlyMap<string, ServerThread>,
    events: readonly WaitingSettleEvent[],
  ): Promise<WaitingSettleVerdict | "gone" | null> {
    const tree = treeOf(snapshot, byId, rootId);
    if (tree === null) return "gone";
    const inTree = new Set(tree.map((thread) => thread.id));
    const touched = events.filter((event) => inTree.has(event.threadId));
    // A never-run thread's queued message is the first of a spawn, which bb records as the user's whoever spawned it.
    const spawning = (threadId: string) => byId.get(threadId)?.status === "pending";
    const reported = touched.flatMap((event) =>
      (event.turns ?? []).filter((turn) => !(turn.kind === "requested" && turn.byUser && spawning(event.threadId))),
    );
    let verdict = waitingSettleVerdict(tree, since, reported);
    const toRead = [...new Set(touched.filter((event) => event.turns === undefined).map((event) => event.threadId))];
    if (verdict.kind === "wait" && toRead.length > 0) {
      const turns = await turnsOf(rootId, toRead, since);
      if (turns !== null) verdict = waitingSettleVerdict(tree, since, [...reported, ...turns]);
    }
    if (verdict.kind !== "land") return verdict;
    // Before it lands, every turn the tree ran since: a message of the user's or a failure there ends it instead.
    const turns = await turnsOf(rootId, [...inTree], since);
    if (turns === null) return null;
    return waitingSettleVerdict(tree, since, [...reported, ...turns]);
  }

  /** Unpins the tree's pinned threads for its settle; false, with a warning and the pins it took put back, when bb refused one. */
  async function unpinAll(tree: readonly ServerThread[]): Promise<boolean> {
    const unpinned: string[] = [];
    try {
      for (const thread of tree) {
        if (!thread.isPinned) continue;
        await threads.unpin(thread.id);
        unpinned.push(thread.id);
      }
      return true;
    } catch (error) {
      warn(`could not unpin a waiting settle's tree, so it settles later: ${errorMessage(error)}`);
      for (const threadId of unpinned) {
        await threads.pin(threadId).catch((pinError) => warn(`could not pin ${threadId} again: ${errorMessage(pinError)}`));
      }
      return false;
    }
  }

  async function checkNow(events: readonly WaitingSettleEvent[]): Promise<void> {
    const waiting = waitingRows(lifecycle);
    for (const map of [idleSince, queuedAtChoice]) {
      for (const id of map.keys()) if (!waiting.some(([threadId]) => threadId === id)) map.delete(id);
    }
    if (waiting.length === 0) return;
    const snapshot = await threads.snapshot();
    const byId = new Map(snapshot.map((thread) => [thread.id, thread]));
    const at = now();
    const ending: [string, number][] = [];
    const landing: [string, number][] = [];
    for (const [rootId, since] of waiting) {
      const verdict = await decide(rootId, since, snapshot, byId, events);
      if (verdict === null) continue;
      if (verdict === "gone" || verdict.kind === "end") {
        idleSince.delete(rootId);
        ending.push([rootId, since]);
      } else if (verdict.kind === "wait") {
        idleSince.delete(rootId);
      } else {
        const idleAt = idleSince.get(rootId) ?? at;
        idleSince.set(rootId, idleAt);
        if (at - idleAt >= IDLE_GRACE_MS) landing.push([rootId, since]);
      }
    }
    if (ending.length === 0 && landing.length === 0) return;

    const settled = await change(async (changed) => {
      // Only the settle that was decided on: one cancelled or chosen again since is left alone.
      const still = ([threadId, since]: [string, number]) => lifecycle.get(threadId)?.waitingSettleAt === since;
      const entries: (readonly [string, LifecycleRow | null])[] = ending
        .filter(still)
        .flatMap(([threadId]) => {
          const row = lifecycle.get(threadId);
          return row === null ? [] : [[threadId, withoutWaitingSettle(row)] as const];
        });
      const lands = landing.filter(still);
      const landed: string[] = [];
      if (lands.length > 0) {
        // Read again inside the change, so a pin, a question or new work since the decision keeps the tree where it is.
        const fresh = await threads.snapshot();
        const freshById = new Map(fresh.map((thread) => [thread.id, thread]));
        const settledAt = now();
        for (const [rootId, since] of lands) {
          const tree = treeOf(fresh, freshById, rootId);
          if (tree === null || waitingSettleVerdict(tree, since).kind !== "land" || !(await unpinAll(tree))) continue;
          idleSince.delete(rootId);
          for (const thread of tree) {
            entries.push([thread.id, settledRow(settledAt, "manual")]);
            landed.push(thread.id);
          }
        }
      }
      changed(lifecycle.putMany(entries));
      return landed;
    });
    const targets = settled.flatMap((threadId) => {
      const row = lifecycle.get(threadId);
      return row === null ? [] : [{ threadId, row }];
    });
    if (targets.length > 0) await deps.reclaim(targets);
  }

  /** The check that has not started yet, which a new request joins. */
  let next: { events: WaitingSettleEvent[]; done: Promise<void> } | null = null;
  function check(event?: WaitingSettleEvent): Promise<void> {
    if (next === null) {
      const batch: { events: WaitingSettleEvent[]; done: Promise<void> } = { events: [], done: Promise.resolve() };
      batch.done = inOrder(() => {
        if (next === batch) next = null;
        return checkNow(batch.events);
      });
      next = batch;
    }
    if (event !== undefined) next.events.push(event);
    return next.done;
  }

  return {
    chosen(threadId, tree) {
      queuedAtChoice.set(threadId, new Set(tree.filter((thread) => hasQueuedMessage(thread)).map((thread) => thread.id)));
    },
    check,
    poke(event) {
      check(event).catch((error) => warn(`waiting settle check failed: ${errorMessage(error)}`));
    },
    async run(signal) {
      while (!signal.aborted) {
        await sleep(POLL_MS, signal);
        if (signal.aborted) return;
        if (waitingRows(lifecycle).length === 0) continue;
        await check().catch((error) => warn(`waiting settle check failed: ${errorMessage(error)}`));
      }
    },
  };
}
