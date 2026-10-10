// Pull request badge. Mounted only for eligible rows, so the per-row
// lookup runs only where it can show something.
import { experimental_useSidebarThreadPullRequest as usePullRequest } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

export function pullRequestTone(attention: PluginSidebarPullRequest["attention"]): string {
  switch (attention) {
    case "checks_failed":
    case "conflicts":
    case "changes_requested":
      return "text-destructive";
    case "ready_to_merge":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

const ATTENTION_LABEL: Partial<Record<PluginSidebarPullRequest["attention"], string>> = {
  checks_failed: "checks failed",
  conflicts: "has conflicts",
  changes_requested: "changes requested",
  ready_to_merge: "ready to merge",
  checks_pending: "checks pending",
  review_requested: "review requested",
  draft: "draft",
  merged: "merged",
  closed: "closed",
  blocked: "blocked",
  queued: "in merge queue",
};

export function pullRequestLabel(pullRequest: PluginSidebarPullRequest): string {
  const detail = ATTENTION_LABEL[pullRequest.attention];
  return `Pull request #${pullRequest.number}${detail ? `, ${detail}` : ""}: ${pullRequest.title}`;
}

const CHECKS: Partial<Record<PluginSidebarPullRequest["experimental_checks"]["state"], string>> = {
  failing: "Checks failing",
  pending: "Checks pending",
  passing: "Checks passing",
};
const REVIEW: Partial<Record<PluginSidebarPullRequest["experimental_review"]["state"], string>> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_requested: "Review requested",
  review_required: "Review required",
};
const MERGEABILITY: Partial<Record<PluginSidebarPullRequest["experimental_mergeability"]["state"], string>> = {
  mergeable: "Mergeable",
  conflicts: "Conflicts",
  blocked: "Blocked",
};

/** The fact each attention already states in the pull request's label. */
const STATED_BY_ATTENTION: Partial<Record<PluginSidebarPullRequest["attention"], string>> = {
  checks_failed: "Checks failing",
  checks_pending: "Checks pending",
  changes_requested: "Changes requested",
  review_requested: "Review requested",
  conflicts: "Conflicts",
  blocked: "Blocked",
  queued: "In merge queue",
};

/**
 * An open pull request's checks, review and merge state, each that bb knows
 * and its label does not already state; none once it is merged or closed.
 */
export function pullRequestFacts(pullRequest: PluginSidebarPullRequest): string[] {
  if (pullRequest.state === "merged" || pullRequest.state === "closed") return [];
  const stated = STATED_BY_ATTENTION[pullRequest.attention];
  return [
    CHECKS[pullRequest.experimental_checks.state],
    REVIEW[pullRequest.experimental_review.state],
    MERGEABILITY[pullRequest.experimental_mergeability.state],
    pullRequest.experimental_autoMerge ? "Auto-merge on" : undefined,
    pullRequest.experimental_inMergeQueue ? "In merge queue" : undefined,
  ].filter((fact): fact is string => fact !== undefined && fact !== stated);
}

export function PullRequestBadge({ threadId }: { threadId: string }) {
  const { pullRequest } = usePullRequest(threadId);
  if (pullRequest === null) return null;
  return (
    <span
      title={pullRequestLabel(pullRequest)}
      aria-label={pullRequestLabel(pullRequest)}
      className={cn("shrink-0 text-xs tabular-nums", pullRequestTone(pullRequest.attention))}
    >
      #{pullRequest.number}
    </span>
  );
}
