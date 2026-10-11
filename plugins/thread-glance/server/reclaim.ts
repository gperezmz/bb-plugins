// Reclaim: after a park, snooze or settle, stop what the thread no longer
// needs. It stops the agent runtime and closes the terminals nobody typed
// into, and leaves the rest running. Each step re-checks that the thread is
// still unpinned, not busy and carries the row the action wrote, so a thread
// that came back to life while Reclaim ran keeps what it has.
//
// Stopping the runtime of a thread that is not running a turn takes bb's
// release path, which leaves the thread's status alone; it does not advance
// `latestAttentionAt`, so the mark the action wrote does not go stale.
import { isBusy } from "../shared/busy";
import { sameRow, type LifecycleRow } from "../shared/lifecycle";
import { addReclaim, EMPTY_RECLAIM, type ReclaimReport } from "../shared/reclaim-note";
import type { LifecycleStore } from "./lifecycle-store";
import { isLiveTerminal, type ThreadRuntime } from "./runtime";
import type { ServerThread, ThreadGateway } from "./threads";

/** A thread to reclaim and the row the action wrote for it, which it must still hold. */
export interface ReclaimTarget {
  threadId: string;
  row: LifecycleRow;
}

/**
 * Reclaims the threads and reports what it did. The caller has written their
 * rows; an implementation reclaims a thread only while it is still unpinned,
 * not busy, and its row still equals `row`. It never rejects the action: a
 * failure reports less.
 */
export type Reclaimer = (targets: readonly ReclaimTarget[]) => Promise<ReclaimReport>;

export interface ReclaimDeps {
  lifecycle: LifecycleStore;
  threads: Pick<ThreadGateway, "snapshot">;
  runtime: ThreadRuntime;
  warn?: (message: string) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Shares one thread listing among the callers that ask while it is being read. */
function sharedSnapshot(threads: Pick<ThreadGateway, "snapshot">): () => Promise<ServerThread[]> {
  let inFlight: Promise<ServerThread[]> | null = null;
  return () => {
    if (inFlight === null) {
      const read = threads.snapshot();
      inFlight = read;
      const release = () => {
        if (inFlight === read) inFlight = null;
      };
      read.then(release, release);
    }
    return inFlight;
  };
}

export function createReclaimer(deps: ReclaimDeps): Reclaimer {
  const { lifecycle, runtime } = deps;
  const warn = deps.warn ?? (() => undefined);
  const snapshot = sharedSnapshot(deps.threads);

  /** Whether the thread is still as the action left it. */
  async function unchanged(target: ReclaimTarget): Promise<boolean> {
    const thread = (await snapshot()).find((candidate) => candidate.id === target.threadId);
    return thread !== undefined && !thread.isPinned && !isBusy(thread) && sameRow(lifecycle.get(target.threadId), target.row);
  }

  async function reclaimThread(target: ReclaimTarget): Promise<ReclaimReport> {
    let report = EMPTY_RECLAIM;
    if (!(await unchanged(target))) return report;
    try {
      await runtime.stop(target.threadId);
      report = { ...report, stoppedRuntime: true };
    } catch (error) {
      warn(`could not stop the runtime of ${target.threadId}: ${message(error)}`);
    }
    let terminals;
    try {
      terminals = (await runtime.terminals(target.threadId)).filter(isLiveTerminal);
    } catch (error) {
      warn(`could not list the terminals of ${target.threadId}: ${message(error)}`);
      return report;
    }
    for (const terminal of terminals) {
      if (terminal.lastUserInputAt !== null) {
        report = addReclaim(report, { ...EMPTY_RECLAIM, keptTerminals: 1 });
        continue;
      }
      if (!(await unchanged(target))) return report;
      const current = await runtime.terminal(terminal.id);
      if (current === undefined || !isLiveTerminal(current)) continue;
      const closed = current.lastUserInputAt === null && (await runtime.closeIfUntouched(terminal.id));
      report = addReclaim(report, closed ? { ...EMPTY_RECLAIM, closedTerminals: 1 } : { ...EMPTY_RECLAIM, keptTerminals: 1 });
    }
    return report;
  }

  return async (targets) => {
    const reports = await Promise.all(
      targets.map((target) =>
        reclaimThread(target).catch((error) => {
          warn(`reclaim of ${target.threadId} failed: ${message(error)}`);
          return EMPTY_RECLAIM;
        }),
      ),
    );
    return reports.reduce(addReclaim, EMPTY_RECLAIM);
  };
}
