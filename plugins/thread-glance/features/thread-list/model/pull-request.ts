// How a pull request from GitHub PR Status is worded and coloured: the badge
// on a row and the hover card's section both take its attention state for their
// label and tone. Pure.
import type { GitHubPullRequest } from "@/shared/github-pr-status";

type Attention = GitHubPullRequest["attention"];

/** The tone names map to theme colours: merged violet, alert red, open emerald, the rest muted. */
export type PullRequestTone = "merged" | "alert" | "open" | "muted";

const LABELS: Record<Exclude<Attention, "none">, string> = {
  blocked: "Blocked",
  changes_requested: "Changes requested",
  checks_failed: "Checks failed",
  checks_pending: "Checks pending",
  closed: "Closed",
  conflicts: "Conflicts",
  draft: "Draft",
  merged: "Merged",
  queued: "In merge queue",
  ready_to_merge: "Ready to merge",
  review_requested: "Review requested",
};

/** The attention state as a label; "Open" when GitHub PR Status reports none. */
export function pullRequestLabel(pullRequest: Pick<GitHubPullRequest, "attention">): string {
  return pullRequest.attention === "none" ? "Open" : LABELS[pullRequest.attention];
}

export function pullRequestTone(pullRequest: Pick<GitHubPullRequest, "attention">): PullRequestTone {
  switch (pullRequest.attention) {
    case "merged":
      return "merged";
    case "blocked":
    case "changes_requested":
    case "checks_failed":
    case "conflicts":
    case "closed":
      return "alert";
    case "none":
      return "open";
    default:
      return "muted";
  }
}

/** The badge's tooltip: the title, then the label. */
export function pullRequestTooltip(pullRequest: Pick<GitHubPullRequest, "attention" | "title">): string {
  return `${pullRequest.title}\n${pullRequestLabel(pullRequest)}`;
}

const CHECKS: Partial<Record<GitHubPullRequest["checks"]["state"], string>> = {
  failing: "Checks failing",
  pending: "Checks pending",
  passing: "Checks passing",
};
const REVIEW: Partial<Record<GitHubPullRequest["review"]["state"], string>> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_requested: "Review requested",
  review_required: "Review required",
};
const MERGEABILITY: Partial<Record<GitHubPullRequest["mergeability"]["state"], string>> = {
  mergeable: "Mergeable",
  conflicts: "Conflicts",
  blocked: "Blocked",
};

/** Checks, review and mergeability of an open pull request, as one line; empty once it is merged or closed. */
export function pullRequestFacts(pullRequest: GitHubPullRequest): string {
  if (pullRequest.state === "merged" || pullRequest.state === "closed") return "";
  return [CHECKS[pullRequest.checks.state], REVIEW[pullRequest.review.state], MERGEABILITY[pullRequest.mergeability.state]]
    .filter((fact): fact is string => fact !== undefined)
    .join(" · ");
}
