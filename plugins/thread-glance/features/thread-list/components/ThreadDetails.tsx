// Hover card and details dialog content.
import { useContext, useEffect, useState } from "react";
import { experimental_Icon as Icon, experimental_useSidebarThreadPullRequest as usePullRequest } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { ThreadInfo } from "../model/families";
import { childSummary, descendantsOf, formatDateTime, sinceLabel } from "../model/details";
import { lastReply } from "../model/notes";
import { finishedAtFor, stateSince } from "../model/time";
import { ICONS } from "../icons";
import { ListLiveContext, type ModelInfo, type RowController } from "./controller";
import { GlyphIcon } from "./glyphs";
import { ProviderBadge } from "./ProviderBadge";
import { pullRequestLabel, pullRequestTone } from "./PullRequestBadge";

function Line({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2" title={title}>
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function useModel(controller: RowController, info: ThreadInfo): ModelInfo | null | "loading" {
  const [model, setModel] = useState<ModelInfo | null | "loading">("loading");
  const { id, status } = info.thread;
  useEffect(() => {
    let cancelled = false;
    setModel("loading");
    controller.loadModel(id, status).then(
      (result) => !cancelled && setModel(result),
      () => !cancelled && setModel(null),
    );
    return () => {
      cancelled = true;
    };
  }, [controller, id, status]);
  return model;
}

function PullRequestLine({ threadId }: { threadId: string }) {
  const { pullRequest } = usePullRequest(threadId);
  if (pullRequest === null) return null;
  return (
    <Line label="Pull request">
      <span className={pullRequestTone(pullRequest.attention)}>{pullRequestLabel(pullRequest)}</span>
    </Line>
  );
}

export interface DetailsActions {
  open(): void;
  toggleRead(): void;
}

export function ThreadDetails({
  info,
  controller,
  showPullRequest,
  actions,
}: {
  info: ThreadInfo;
  controller: RowController;
  showPullRequest: boolean;
  /** Present in the details dialog, absent in the hover card. */
  actions?: DetailsActions;
}) {
  const thread = info.thread;
  const provider = controller.provider(thread.providerId);
  const model = useModel(controller, info);
  const live = useContext(ListLiveContext);
  const since = sinceLabel(info.state.kind, stateSince(info.state.kind, thread.id, live.stamps, live.now));
  const children = childSummary(descendantsOf(live.familyOf(thread.id), thread.id));
  const environment = thread.environment;
  const finished = finishedAtFor(thread, live.stamps.finishedAt);
  const reply = lastReply(live.notes[thread.id]);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-sm font-medium leading-snug break-words">{thread.displayTitle}</p>
      <div className="flex items-center gap-1.5">
        <GlyphIcon glyph={info.state.glyph} className="size-3.5" />
        <span>
          {info.state.label}
          {since !== null ? ` · ${since}` : ""}
          {info.state.sendAt !== null ? ` · sends ${formatDateTime(info.state.sendAt)}` : ""}
        </span>
      </div>
      {info.note !== null ? (
        <p className="break-words leading-snug">
          <span className={info.note.tone === "destructive" ? "text-destructive" : "text-attention"}>{info.note.prefix}:</span>{" "}
          {info.note.text}
        </p>
      ) : null}
      <dl className="flex flex-col gap-1">
        <Line label="Harness">
          <span className="inline-flex items-center gap-1.5">
            <ProviderBadge display={provider} mode={controller.harnessIcon === "hidden" ? "muted" : controller.harnessIcon} />
            {provider.name}
          </span>
        </Line>
        <Line label="Model" title="The model and reasoning level the next message will use">
          {model === "loading" ? "…" : model === null ? "Unknown" : `${model.model} · ${model.reasoningLevel}`}
        </Line>
        {environment?.branchName ? (
          <Line label="Branch">
            <span className="inline-flex items-center gap-1">
              <Icon name={environment.isWorktree ? ICONS.worktree : ICONS.branch} aria-hidden className="size-3.5" />
              {environment.branchName}
              {environment.isWorktree ? " (worktree)" : ""}
            </span>
          </Line>
        ) : null}
        {thread.host !== null ? <Line label="Machine">{thread.host.name}</Line> : null}
        {children !== null ? <Line label="Children">{children}</Line> : null}
        {showPullRequest ? <PullRequestLine threadId={thread.id} /> : null}
        {reply !== null && info.note === null ? (
          <Line label="Last reply">
            <span className="line-clamp-2">{reply.text}</span>
          </Line>
        ) : null}
        <Line label="Created">{formatDateTime(thread.createdAt)}</Line>
        {finished !== null ? <Line label="Finished">{formatDateTime(finished)}</Line> : null}
      </dl>
      {actions ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={actions.open}>
            <Icon name={ICONS.open} aria-hidden />
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={actions.toggleRead}>
            <Icon name={info.unread ? ICONS.markRead : ICONS.markUnread} aria-hidden />
            {info.unread ? "Mark read" : "Mark unread"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
