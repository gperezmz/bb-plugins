// Hover card and details dialog content.
import { useEffect, useState } from "react";
import { experimental_Icon as Icon, experimental_useSidebarThreadPullRequest as usePullRequest } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { ThreadInfo } from "../model/trees";
import { childSummary, descendantsOf, formatDateTime, sinceLabel } from "../model/details";
import { lastReply } from "../model/notes";
import { finishedAtFor, stateSince } from "../model/time";
import { ICONS } from "../icons";
import type { Commands } from "../commands/commands";
import type { ModelInfo } from "../sync";
import { useCommands, useLayout, useNotesOf, useNow, useProviderDisplay, useStampMaps, useTreeOf } from "../store/hooks";
import { GlyphIcon, NoteLine } from "./glyphs";
import { ProviderBadge } from "./ProviderBadge";
import { pullRequestFacts, pullRequestLabel, pullRequestTone } from "./PullRequestBadge";

function Line({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2" title={title}>
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function useModel(commands: Commands, info: ThreadInfo): ModelInfo | null | "loading" {
  const [model, setModel] = useState<ModelInfo | null | "loading">("loading");
  const { id, status } = info.thread;
  useEffect(() => {
    let cancelled = false;
    setModel("loading");
    commands.loadModel(id, status).then(
      (result) => !cancelled && setModel(result),
      () => !cancelled && setModel(null),
    );
    return () => {
      cancelled = true;
    };
  }, [commands, id, status]);
  return model;
}

function PullRequestLine({ threadId }: { threadId: string }) {
  const { pullRequest } = usePullRequest(threadId);
  if (pullRequest === null) return null;
  const facts = pullRequestFacts(pullRequest);
  return (
    <Line label="Pull request">
      <span className={pullRequestTone(pullRequest.attention)}>{pullRequestLabel(pullRequest)}</span>
      {facts.length > 0 ? <span className="block text-muted-foreground">{facts.join(" · ")}</span> : null}
    </Line>
  );
}

export interface DetailsActions {
  open(): void;
  /** bb's own Mark read or Mark unread for the thread, where bb offers it. */
  read: { label: string; icon: string; run(): void } | null;
}

export function ThreadDetails({
  info,
  showPullRequest,
  actions,
}: {
  info: ThreadInfo;
  showPullRequest: boolean;
  /** Present in the details dialog, absent in the hover card. */
  actions?: DetailsActions;
}) {
  const thread = info.thread;
  const commands = useCommands();
  const provider = useProviderDisplay(thread.providerId);
  const { harnessIcon } = useLayout();
  // What changes with every event: only an open card or dialog reads it.
  const stamps = useStampMaps();
  const now = useNow();
  const notes = useNotesOf(thread.id);
  const tree = useTreeOf(thread.id);
  const model = useModel(commands, info);
  const since = sinceLabel(info.state.kind, stateSince(info.state.kind, thread.id, stamps, now));
  const children = childSummary(descendantsOf(tree, thread.id));
  const environment = thread.environment;
  const finished = finishedAtFor(thread, stamps.finishedAt);
  const reply = lastReply(notes);
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
          <NoteLine note={info.note} />
        </p>
      ) : null}
      <dl className="flex flex-col gap-1">
        <Line label="Harness">
          <span className="inline-flex items-center gap-1.5">
            <ProviderBadge display={provider} mode={harnessIcon} />
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
          {actions.read !== null ? (
            <Button size="sm" variant="outline" onClick={actions.read.run}>
              <Icon name={actions.read.icon} aria-hidden />
              {actions.read.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
