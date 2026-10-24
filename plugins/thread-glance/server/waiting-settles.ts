// Waiting settles: a Settle chosen for a thread tree while a thread in it was
// busy, kept in the thread's lifecycle row. The server looks at each one
// whenever bb announces a thread event and every few seconds while any waits,
// and settles the tree once no thread in it is busy, or ends the settle where
// `waitingSettleVerdict` says. The module names no SDK: bb is reached through
// `ThreadGateway`.
import { isWaitingSettle, settledRow, type LifecycleRow } from "../shared/lifecycle";
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
   * Looks at every waiting settle now: settles each tree that has been idle
   * for `IDLE_GRACE_MS`, and ends each settle that a pin, a question, a turn
   * of the user's or a failure ended. `event` names a thread whose recorded
   * turns are read at once rather than only before a landing. Checks run one
   * at a time.
   */
  check(event?: WaitingSettleEvent): Promise<void>;
  /** `check` without waiting for it; a failure is logged. */
  poke(event?: WaitingSettleEvent): void;
  /** Checks every `POLL_MS` while a settle waits, until `signal` aborts. */
  run(signal: AbortSignal): Promise<void>;
}

export interface WaitingSettlesDeps {
  lifecycle: LifecycleStore;
  threads: Pick<ThreadGateway, "snapshot" | "turnsSince">;
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
    isWaitingSettle(row) ? [[threadId, row.waitingSettleAt!]] : [],
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

  /** The tree of `rootId` as `byId` has it, or null when bb no longer lists the thread. */
  const treeOf = (snapshot: readonly ServerThread[], byId: ReadonlyMap<string, ServerThread>, rootId: string) =>
    byId.has(rootId) ? treeIds(snapshot, rootId).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) : null;

  /** The turns the threads recorded after `since`, or null when bb could not say for one of them. */
  async function turnsOf(ids: readonly string[], since: number): Promise<TurnRecord[] | null> {
    try {
      return (await Promise.all(ids.map((id) => threads.turnsSince(id, since)))).flat();
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
    event: WaitingSettleEvent | undefined,
  ): Promise<WaitingSettleVerdict | "gone" | null> {
    const tree = treeOf(snapshot, byId, rootId);
    if (tree === null) return "gone";
    const reported = event !== undefined && tree.some((thread) => thread.id === event.threadId) ? [...(event.turns ?? [])] : [];
    let verdict = waitingSettleVerdict(tree, since, reported);
    if (verdict.kind === "wait" && reported.length === 0 && event !== undefined && tree.some((thread) => thread.id === event.threadId)) {
      const turns = await turnsOf([event.threadId], since);
      if (turns !== null) verdict = waitingSettleVerdict(tree, since, turns);
    }
    if (verdict.kind !== "land") return verdict;
    // Before it lands, every turn the tree ran since: a message of the user's or a failure there ends it instead.
    const turns = await turnsOf(
      tree.map((thread) => thread.id),
      since,
    );
    if (turns === null) return null;
    return waitingSettleVerdict(tree, since, [...reported, ...turns]);
  }

  async function checkNow(event?: WaitingSettleEvent): Promise<void> {
    const waiting = waitingRows(lifecycle);
    for (const id of idleSince.keys()) if (!waiting.some(([threadId]) => threadId === id)) idleSince.delete(id);
    if (waiting.length === 0) return;
    const snapshot = await threads.snapshot();
    const byId = new Map(snapshot.map((thread) => [thread.id, thread]));
    const at = now();
    const ending: [string, number][] = [];
    const landing: [string, number][] = [];
    for (const [rootId, since] of waiting) {
      const verdict = await decide(rootId, since, snapshot, byId, event);
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
      const entries: (readonly [string, LifecycleRow | null])[] = ending.filter(still).map(([threadId]) => [threadId, null] as const);
      const lands = landing.filter(still);
      const landed: string[] = [];
      if (lands.length > 0) {
        // Read again inside the change, so a pin, a question or new work since the decision keeps the tree where it is.
        const fresh = await threads.snapshot();
        const freshById = new Map(fresh.map((thread) => [thread.id, thread]));
        const settledAt = now();
        for (const [rootId, since] of lands) {
          const tree = treeOf(fresh, freshById, rootId);
          if (tree === null || waitingSettleVerdict(tree, since).kind !== "land") continue;
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

  const check = (event?: WaitingSettleEvent) => inOrder(() => checkNow(event));

  return {
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
