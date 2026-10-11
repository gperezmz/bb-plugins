// How a pull request from bb is worded and coloured: the badge on a row and
// the hover card's section both take bb's attention for their label and tone.
// Pure.
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";

type Attention = PluginSidebarPullRequest["attention"];

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

/** bb's attention as a label; "Open" when bb reports none. */
export function pullRequestLabel(pullRequest: Pick<PluginSidebarPullRequest, "attention">): string {
  return pullRequest.attention === "none" ? "Open" : LABELS[pullRequest.attention];
}

export function pullRequestTone(pullRequest: Pick<PluginSidebarPullRequest, "attention">): PullRequestTone {
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
export function pullRequestTooltip(pullRequest: Pick<PluginSidebarPullRequest, "attention" | "title">): string {
  return `${pullRequest.title}\n${pullRequestLabel(pullRequest)}`;
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

/** Checks, review and mergeability of an open pull request, as one line; empty once it is merged or closed. */
export function pullRequestFacts(pullRequest: PluginSidebarPullRequest): string {
  if (pullRequest.state === "merged" || pullRequest.state === "closed") return "";
  return [CHECKS[pullRequest.experimental_checks.state], REVIEW[pullRequest.experimental_review.state], MERGEABILITY[pullRequest.experimental_mergeability.state]]
    .filter((fact): fact is string => fact !== undefined)
    .join(" · ");
}
