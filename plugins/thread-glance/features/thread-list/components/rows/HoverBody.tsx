// The Hover card's content: the thread's title, project, machine and branch,
// its harness, its model and reasoning level on one line, the branch's pull
// request from GitHub PR Status, the ports listening in its environment, and
// its subthreads.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { modelLine, type ModelState } from "../../model/harness";
import { pullRequestFacts, pullRequestLabel, pullRequestTone } from "../../model/pull-request";
import type { RowView } from "../../model/list-model";
import { lookUpModel } from "../../sync/model-lookup";
import { usePullRequest } from "../../sync/pull-requests";
import { useCommands, useListStore, useProject, useRowsOf } from "../../store/hooks";
import { HarnessLogo, useHarnessName } from "./HarnessLogo";
import { PortsSection } from "./PortsSection";
import { PULL_REQUEST_TONE_CLASS } from "./PullRequestBadge";
import { GlyphMark, TONE_CLASS } from "./StatusView";
import { useRowStatus } from "./use-row-status";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** The model and reasoning level bb reports for the thread, loaded when the card opens. */
function useModelState(row: RowView): ModelState {
  const store = useListStore();
  const [state, setState] = useState<ModelState>({ status: "loading" });
  const { id, providerId, status, host } = row.thread;
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    lookUpModel(store.edge.sdk, { id, providerId, status, host }).then(
      (answer) => !cancelled && setState({ status: "ready", ...answer }),
      () => !cancelled && setState({ status: "unavailable" }),
    );
    return () => {
      cancelled = true;
    };
  }, [store, id, providerId, status, host]);
  return state;
}

function PullRequestSection({ environmentId }: { environmentId: string | null | undefined }) {
  const pullRequest = usePullRequest(environmentId);
  if (pullRequest === null) return null;
  const facts = pullRequestFacts(pullRequest);
  return (
    <div data-section="pull-request" className="flex flex-col gap-0.5">
      <a href={pullRequest.url} target="_blank" rel="noreferrer" className="break-words hover:underline">
        <span className="font-mono tabular-nums">#{pullRequest.number}</span> {pullRequest.title}
      </a>
      <span data-pull-request-label="" className={cn("font-medium", PULL_REQUEST_TONE_CLASS[pullRequestTone(pullRequest)])}>
        {pullRequestLabel(pullRequest)}
      </span>
      {facts === "" ? null : <span className="text-muted-foreground">{facts}</span>}
    </div>
  );
}

function Subthreads({ ids }: { ids: readonly string[] }) {
  const commands = useCommands();
  const [open, setOpen] = useState(false);
  const children = useRowsOf(ids);
  return (
    <div data-section="subthreads" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Subthreads ({ids.length})
      </button>
      {open ? (
        <ul className="flex flex-col gap-0.5">
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => commands.open(child.id)}
                className="w-full truncate text-left text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {child.thread.displayTitle}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HoverBody({ row }: { row: RowView }) {
  const { thread } = row;
  const project = useProject(thread.projectId);
  const harness = useHarnessName(thread.providerId);
  const status = useRowStatus(row);
  const model = modelLine(useModelState(row));
  const branch = thread.environment?.branchName;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-sm leading-snug font-medium break-words">{thread.displayTitle}</p>
      <dl className="flex flex-col gap-1">
        <Line label="Project">{project?.name ?? thread.projectId}</Line>
        {thread.host === null ? null : <Line label="Machine">{thread.host.name}</Line>}
        {branch ? <Line label="Branch">{branch}</Line> : null}
        <Line label="Harness">
          <span className="inline-flex items-center gap-1.5">
            <HarnessLogo providerId={thread.providerId} />
            {harness}
            {status.glyph === null ? null : (
              <span className={cn("inline-flex items-center", TONE_CLASS[status.tone])} title={status.label}>
                <GlyphMark glyph={status.glyph} />
              </span>
            )}
          </span>
        </Line>
        <Line label="Model">{model}</Line>
      </dl>
      <PullRequestSection environmentId={thread.environment?.id} />
      <PortsSection threadId={thread.id} environmentId={thread.environment?.id} />
      {row.children === null ? null : <Subthreads ids={row.children.ids} />}
    </div>
  );
}
