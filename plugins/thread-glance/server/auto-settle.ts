// Auto-settle: the server pass that settles quiet threads and threads whose
// pull request is closed or merged, and returns to Active a thread it settled
// that no longer qualifies. A pass reads the threads and their pull requests,
// then decides again from fresh data inside the change that writes, so a pin,
// a turn or a park made while it waited is respected.
import { isBusy } from "../shared/busy";
import { hasManualMark, lastActivityAt, settledRow, staleMark, type LifecycleRow } from "../shared/lifecycle";
import { affectsAutoSettle, type SettingKey, type Settings } from "../shared/settings";
import type { ChangeRecords } from "./actions";
import type { LifecycleStore } from "./lifecycle-store";
import type { PullRequestStatus, PullRequests } from "./pull-requests";
import type { Reclaimer } from "./reclaim";
import type { ServerThread, ThreadGateway } from "./threads";
import { errorMessage } from "./error-message";

export interface AutoSettleResult {
  /** Threads the pass settled. */
  settled: string[];
  /** Threads it returned from an automatic settle. */
  unsettled: string[];
}

export interface AutoSettle {
  /**
   * Runs a pass. At most one pass runs at a time and one more waits behind it;
   * a call made while one waits shares the waiting pass. Resolves with what
   * the pass did, which is nothing for a pass that started under settings that
   * have changed since.
   */
  run(): Promise<AutoSettleResult>;
  /** Called after the settings changed; a change to an auto-settle setting starts a pass. */
  onSettingsChanged(keys: readonly SettingKey[]): void;
}

export interface AutoSettleDeps {
  lifecycle: LifecycleStore;
  threads: Pick<ThreadGateway, "snapshot">;
  pullRequests: PullRequests;
  settings: { read(): Promise<Settings> };
  /**
   * The ids of the threads to leave alone for this pass because they serve a
   * port or their machine cannot be scanned; see `holdBackThreads`.
   */
  heldBack: (threads: readonly ServerThread[]) => Promise<ReadonlySet<string>>;
  reclaim: Reclaimer;
  change: ChangeRecords;
  now?: () => number;
  warn?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

type AutoSettings = Pick<Settings, "settleQuietThreads" | "daysBeforeAutoSettle" | "settleMergedPullRequests">;

const sameSettings = (a: AutoSettings, b: AutoSettings) =>
  a.settleQuietThreads === b.settleQuietThreads &&
  a.daysBeforeAutoSettle === b.daysBeforeAutoSettle &&
  a.settleMergedPullRequests === b.settleMergedPullRequests;

type Decision = "keep" | "settle" | "unsettle";

/** Whether the thread is on the Settled shelf by an automatic settle that attention has not made stale. */
const isAutoSettled = (row: LifecycleRow | null, thread: ServerThread) =>
  row !== null && row.settledAt !== null && row.settledKind === "auto" && staleMark(row, thread) === null;

/** A thread auto-settle never settles: pinned, busy, parked or snoozed. */
const isExcluded = (thread: ServerThread, row: LifecycleRow | null) =>
  thread.isPinned || isBusy(thread) || row?.parkedAt != null || row?.snoozeUntil != null;

/** Whether deciding the thread needs its pull request. */
function needsPullRequest(thread: ServerThread, row: LifecycleRow | null): boolean {
  return !thread.hidden && thread.environmentId !== null && !hasManualMark(row) && !isExcluded(thread, row);
}

function decide(
  thread: ServerThread,
  row: LifecycleRow | null,
  pullRequest: PullRequestStatus,
  settings: AutoSettings,
  now: number,
): Decision {
  if (hasManualMark(row)) return "keep";
  const auto = isAutoSettled(row, thread);
  if (isExcluded(thread, row)) return auto ? "unsettle" : "keep";
  // A failed lookup is no evidence that no open pull request exists.
  if (pullRequest.kind === "unknown") return "keep";
  // Losing the way to ask is no reason to return a thread settled while it was there.
  if (pullRequest.kind === "no-lookup" && auto) return "keep";

  const activityAt = lastActivityAt(thread);
  let should = false;
  let blocked = false;
  if (pullRequest.kind === "available") {
    if (pullRequest.state === "open" || pullRequest.state === "draft") {
      blocked = true;
    } else if (pullRequest.state === "closed" || settings.settleMergedPullRequests) {
      // Without a trustworthy time, the pull request is no evidence it finished after the thread's last activity.
      if (pullRequest.updatedAt === null) return "keep";
      should = pullRequest.updatedAt > activityAt;
    }
  }
  if (!should && !blocked && settings.settleQuietThreads) {
    should = activityAt < now - settings.daysBeforeAutoSettle * DAY_MS;
  }
  if (should === auto) return "keep";
  return should ? "settle" : "unsettle";
}

/**
 * The threads to settle and to return, from the threads bb has now. A thread
 * in `heldBack` is not settled this pass. A parent settles only when every
 * visible thread below it is settled or settling and no hidden one is busy,
 * and an automatic settle of a parent whose tree is no longer so is returned.
 */
export function planAutoSettle(input: {
  threads: readonly ServerThread[];
  rows: (threadId: string) => LifecycleRow | null;
  pullRequests: ReadonlyMap<string, PullRequestStatus>;
  settings: AutoSettings;
  heldBack: ReadonlySet<string>;
  now: number;
}): { settle: string[]; unsettle: string[] } {
  const { threads, rows, settings, now } = input;
  const settle = new Set<string>();
  const unsettle = new Set<string>();
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  for (const thread of threads) {
    if (thread.hidden) continue;
    const environmentId = thread.environmentId;
    const status: PullRequestStatus =
      environmentId === null ? { kind: "absent" } : (input.pullRequests.get(environmentId) ?? { kind: "unknown" });
    const decision = decide(thread, rows(thread.id), status, settings, now);
    if (decision === "settle") {
      if (!input.heldBack.has(thread.id)) settle.add(thread.id);
    } else if (decision === "unsettle") unsettle.add(thread.id);
  }

  const childrenOf = new Map<string, string[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    childrenOf.set(thread.parentThreadId, [...(childrenOf.get(thread.parentThreadId) ?? []), thread.id]);
  }
  const settledOrSettling = (threadId: string) => {
    const row = rows(threadId);
    const thread = byId.get(threadId);
    if (settle.has(threadId)) return true;
    return row !== null && row.settledAt !== null && thread !== undefined && staleMark(row, thread) === null && !unsettle.has(threadId);
  };
  // A hidden helper is never settled itself, so it only blocks its tree while it is busy.
  const wholeTreeSettled = (threadId: string) => {
    const pending = [...(childrenOf.get(threadId) ?? [])];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const thread = byId.get(id);
      if (thread?.hidden ? isBusy(thread) : !settledOrSettling(id)) return false;
      pending.push(...(childrenOf.get(id) ?? []));
    }
    return true;
  };

  // Withdrawing one parent can leave its own parent short, so repeat until nothing moves.
  for (let moved = true; moved; ) {
    moved = false;
    for (const threadId of [...settle]) {
      if (!wholeTreeSettled(threadId)) {
        settle.delete(threadId);
        moved = true;
      }
    }
    for (const thread of threads) {
      if (thread.hidden || unsettle.has(thread.id) || settle.has(thread.id)) continue;
      const row = rows(thread.id);
      if (isAutoSettled(row, thread) && !hasManualMark(row) && !wholeTreeSettled(thread.id)) {
        unsettle.add(thread.id);
        moved = true;
      }
    }
  }
  return { settle: [...settle], unsettle: [...unsettle] };
}

export function createAutoSettle(deps: AutoSettleDeps): AutoSettle {
  const { lifecycle, change } = deps;
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? (() => undefined);
  const NOTHING: AutoSettleResult = { settled: [], unsettled: [] };

  async function pass(): Promise<AutoSettleResult> {
    const started = await deps.settings.read();
    const first = await deps.threads.snapshot();
    const environmentIds = new Set<string>();
    for (const thread of first) {
      if (thread.environmentId !== null && needsPullRequest(thread, lifecycle.get(thread.id))) environmentIds.add(thread.environmentId);
    }
    const pullRequests = environmentIds.size === 0 ? new Map<string, PullRequestStatus>() : await deps.pullRequests.read([...environmentIds]);
    // Read before the change runs so that a scan never holds up other changes to records.
    const heldBack = await deps.heldBack(first);

    const outcome = await change(async (changed) => {
      // A pass is for the settings it started under; the settings change that started the next one is queued.
      if (!sameSettings(started, await deps.settings.read())) return null;
      const at = now();
      const current = await deps.threads.snapshot();
      const { settle, unsettle } = planAutoSettle({
        threads: current,
        rows: (threadId) => lifecycle.get(threadId),
        pullRequests,
        settings: started,
        heldBack,
        now: at,
      });
      changed(
        lifecycle.putMany([
          ...settle.map((threadId): readonly [string, LifecycleRow] => [threadId, settledRow(at, "auto")]),
          ...unsettle.map((threadId): readonly [string, null] => [threadId, null]),
        ]),
      );
      return { settle, unsettle };
    });
    if (outcome === null) return NOTHING;

    const targets = outcome.settle.flatMap((threadId) => {
      const row = lifecycle.get(threadId);
      return row === null ? [] : [{ threadId, row }];
    });
    if (targets.length > 0) await deps.reclaim(targets);
    return { settled: outcome.settle, unsettled: outcome.unsettle };
  }

  let running = false;
  let waiting: { promise: Promise<AutoSettleResult>; resolve(result: AutoSettleResult): void; reject(error: unknown): void } | null = null;

  async function run(): Promise<AutoSettleResult> {
    if (running) {
      if (waiting === null) {
        let resolve!: (result: AutoSettleResult) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<AutoSettleResult>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        waiting = { promise, resolve, reject };
      }
      return waiting.promise;
    }
    running = true;
    try {
      return await pass();
    } finally {
      running = false;
      const next = waiting;
      waiting = null;
      if (next !== null) run().then(next.resolve, next.reject);
    }
  }

  return {
    run,
    onSettingsChanged(keys) {
      if (!affectsAutoSettle(keys)) return;
      run().catch((error) => warn(`auto-settle failed: ${errorMessage(error)}`));
    },
  };
}
