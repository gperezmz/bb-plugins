// The pull-request badge `#number` from GitHub PR Status, coloured by its
// attention, with the title and label as its tooltip. It opens the pull
// request in a new tab. Mounted only where a card shows it, so a pull request
// is looked up only for the cards that are drawn.
import { cn } from "@/lib/utils";
import { pullRequestLabel, pullRequestTone, pullRequestTooltip, type PullRequestTone } from "../../model/pull-request";
import { usePullRequest } from "../../sync/pull-requests";
import { Tip } from "./Tip";

export const PULL_REQUEST_TONE_CLASS: Record<PullRequestTone, string> = {
  merged: "text-[color:var(--tg-merged)]",
  alert: "text-[color:var(--tg-failed)]",
  open: "text-[color:var(--tg-unread)]",
  muted: "text-muted-foreground",
};

export function PullRequestBadge({ environmentId }: { environmentId: string | null | undefined }) {
  const pullRequest = usePullRequest(environmentId);
  if (pullRequest === null) return null;
  return (
    <Tip label={pullRequestTooltip(pullRequest)}>
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        data-no-drag=""
        data-pull-request={pullRequest.attention}
        aria-label={`Pull request #${pullRequest.number}, ${pullRequestLabel(pullRequest)}: ${pullRequest.title}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "pointer-events-auto relative shrink-0 rounded font-mono tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          PULL_REQUEST_TONE_CLASS[pullRequestTone(pullRequest)],
        )}
      >
        #{pullRequest.number}
      </a>
    </Tip>
  );
}
