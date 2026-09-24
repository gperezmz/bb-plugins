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
};

export function pullRequestLabel(pullRequest: PluginSidebarPullRequest): string {
  const detail = ATTENTION_LABEL[pullRequest.attention];
  return `Pull request #${pullRequest.number}${detail ? `, ${detail}` : ""}: ${pullRequest.title}`;
}

export function PullRequestBadge({ threadId }: { threadId: string }) {
  const { pullRequest } = usePullRequest(threadId);
  if (pullRequest === null) return null;
  return (
    <span
      title={pullRequestLabel(pullRequest)}
      aria-label={pullRequestLabel(pullRequest)}
      className={cn("shrink-0 text-[11px] tabular-nums", pullRequestTone(pullRequest.attention))}
    >
      #{pullRequest.number}
    </span>
  );
}
