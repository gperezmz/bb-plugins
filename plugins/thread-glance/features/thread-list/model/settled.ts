// Settled threads: which trees go behind their group's settled fold.
// Worked out afresh on every build, so any activity unsettles a thread. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SettleAfter } from "@/shared/preferences";
import { isQuietThread } from "./state";
import type { ThreadInfo, ThreadTree } from "./trees";

const HOUR = 60 * 60 * 1000;

/** How long a thread goes without activity before it settles, per Settle after choice. */
export const SETTLE_AFTER_MS: Readonly<Record<Exclude<SettleAfter, "never">, number>> = {
  "12h": 12 * HOUR,
  "1d": 24 * HOUR,
  "3d": 3 * 24 * HOUR,
  "1w": 7 * 24 * HOUR,
};

/** A pull request's state, as bb's lookup reports it. */
export type PullRequestState = "open" | "draft" | "merged" | "closed";

/**
 * What settling knows of a thread's pull request: its state, null when the
 * thread has none, or `unknown` while a lookup it needs has not answered.
 */
export type PullRequestFact = PullRequestState | null | "unknown";

/**
 * Whether a thread's branch can carry a pull request worth looking up: it is
 * on a branch other than its project's default. A default branch the lookup
 * could not find (null) is no reason to skip one; one still being looked up
 * (undefined) is, until it answers.
 */
export function needsPullRequestLookup(branch: string | null, defaultBranch: string | null | undefined): boolean {
  return branch !== null && defaultBranch !== undefined && branch !== defaultBranch;
}

/** A thread's pull request fact, from its project's default branch and the lookups that answered. */
export function pullRequestFact(
  thread: Pick<PluginSidebarThread, "id" | "environment">,
  defaultBranch: string | null | undefined,
  answers: ReadonlyMap<string, PullRequestState | null>,
): PullRequestFact {
  const branch = thread.environment?.branchName ?? null;
  if (branch === null) return null;
  if (defaultBranch === undefined) return "unknown";
  if (!needsPullRequestLookup(branch, defaultBranch)) return null;
  const answer = answers.get(thread.id);
  return answer === undefined ? "unknown" : answer;
}

export interface SettleInputs {
  now: number;
  settleAfter: SettleAfter;
  /** Server stamps: when each thread last started and finished a turn. */
  startedAt: Readonly<Record<string, number>>;
  finishedAt: Readonly<Record<string, number>>;
  pullRequestOf(thread: PluginSidebarThread): PullRequestFact;
}

/**
 * A thread's own last activity: its creation, its last finish or failure
 * (`latestAttentionAt`) and the server's stamps of its last start and
 * finish. `updatedAt` is left out because opening or renaming a thread
 * moves it too.
 */
export function lastActivityAt(
  thread: Pick<PluginSidebarThread, "id" | "createdAt" | "latestAttentionAt">,
  stamps: Pick<SettleInputs, "startedAt" | "finishedAt">,
): number {
  return Math.max(
    thread.createdAt,
    thread.latestAttentionAt,
    stamps.startedAt[thread.id] ?? 0,
    stamps.finishedAt[thread.id] ?? 0,
  );
}

/**
 * A settled thread: quiet as if no thread were open, not needing attention,
 * not pinned, with no open pull request, and either its pull request merged
 * or closed or its own last activity is older than the Settle after period.
 * A hidden thread has no row, so only needing attention holds it out; an
 * archived one is done and settled.
 */
export function isSettledThread(info: ThreadInfo, inputs: SettleInputs): boolean {
  const thread = info.thread;
  if (thread.isHidden) return info.attentionFlags.size === 0;
  if (thread.isArchived) return true;
  if (!isQuietThread(info.state, info.unread, false)) return false;
  if (info.attentionFlags.size > 0) return false;
  if (thread.pinnedAt !== null || thread.isPinned) return false;
  const pullRequest = inputs.pullRequestOf(thread);
  if (pullRequest === "unknown" || pullRequest === "open" || pullRequest === "draft") return false;
  if (pullRequest === "merged" || pullRequest === "closed") return true;
  if (inputs.settleAfter === "never") return false;
  return inputs.now - lastActivityAt(thread, inputs) >= SETTLE_AFTER_MS[inputs.settleAfter];
}

/**
 * A tree settles as one unit: when every thread in it is settled. A tree
 * whose root is archived is left where archived threads are shown.
 */
export function isSettledTree(tree: Pick<ThreadTree, "root" | "descendants">, inputs: SettleInputs): boolean {
  if (tree.root.thread.isArchived) return false;
  return isSettledThread(tree.root, inputs) && tree.descendants.every((info) => isSettledThread(info, inputs));
}

/**
 * The threads whose pull request settling has to look up: every thread that
 * would settle but for its pull request, on a branch other than its
 * project's default.
 */
export function pullRequestLookupIds(
  infos: Iterable<ThreadInfo>,
  defaultBranchOf: (thread: PluginSidebarThread) => string | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const info of infos) {
    const thread = info.thread;
    if (thread.isHidden || thread.isArchived || thread.pinnedAt !== null || thread.isPinned) continue;
    if (!isQuietThread(info.state, info.unread, false) || info.attentionFlags.size > 0) continue;
    if (needsPullRequestLookup(thread.environment?.branchName ?? null, defaultBranchOf(thread))) ids.push(thread.id);
  }
  return ids;
}
