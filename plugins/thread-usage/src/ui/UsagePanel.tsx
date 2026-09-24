/**
 * The Usage tab in the thread's right panel. Renders
 * `params.threadId`, falling back to the tab's own thread, so a chip in one
 * split pane never shows the other pane's thread.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBbNavigate, type JsonValue } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CHECK_LABELS } from "../core/litellm-labels";
import { costTotal, figureTokenCount } from "../core/figure-math";
import { reportMarkdown, turnsCsv } from "../core/export";
import {
  formatDuration,
  formatCount,
  formatExactTokens,
  formatPercent,
  formatTokens,
  formatUsd,
  priceSourceLabel,
  pricesLabel,
  pricesStale,
} from "../core/format";
import type { QualityNote, ThreadReport, TreeRow } from "../core/report-types";
import type { TurnView } from "../core/summary";
import { cacheHitRatio, totalTokens } from "../core/tokens";
import {
  download,
  EmptyState,
  HarnessIcon,
  Icon,
  Panel,
  SectionTitle,
  Tag,
  TokenBar,
  TokenLegend,
  touches,
  useCopy,
  useLive,
  useUsageRpc,
} from "./common";
import { SOURCE_STYLE, turnLabel, turnNumbers, TurnsChart } from "./TurnsChart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function paramsThreadId(params: JsonValue | null, fallback: string): string {
  if (params !== null && typeof params === "object" && !Array.isArray(params)) {
    const id = (params as Record<string, JsonValue>).threadId;
    if (typeof id === "string" && /^thr_[A-Za-z0-9_-]+$/.test(id)) return id;
  }
  return fallback;
}

export function UsageTab({ threadId: ownThreadId, params }: { threadId: string; params: JsonValue | null }) {
  const threadId = paramsThreadId(params, ownThreadId);
  const rpc = useUsageRpc();
  const [familyIds, setFamilyIds] = useState<string[]>([threadId]);
  const { data, error } = useLive(
    () => rpc.call("report", { threadId }),
    [rpc, threadId],
    (payload) => touches(payload, familyIds),
  );
  useEffect(() => {
    if (data !== null) setFamilyIds([data.threadId, ...data.tree.map((r) => r.threadId), ...data.forks.map((f) => f.threadId)]);
  }, [data]);
  // Opening the tab refreshes the family: catch-up, gateway sweep, and a retry of offline machines.
  useEffect(() => {
    void rpc.call("refresh", { threadId }).catch(() => undefined);
  }, [rpc, threadId]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-6 pt-4">
        {error !== null && data === null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : data === null ? (
          <LoadingState />
        ) : (
          <Report report={data} />
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function Report({ report }: { report: ThreadReport }) {
  const hasFamily = report.descendants > 0;
  const [scope, setScope] = useState<"thread" | "family">(hasFamily ? "family" : "thread");
  const effective = hasFamily ? scope : "thread";
  const view = effective === "family" ? report.family : report.thread;
  const other = effective === "family" ? report.thread : report.family;
  const f = view.figure;
  const [selected, setSelected] = useState<string | null>(null);
  const selectedTurn = report.turns.find((t) => t.turnId === selected) ?? null;
  const measure = report.thread.headline.primaryKind;

  return (
    <TooltipProvider delayDuration={200}>
      {report.gatewayBanner !== null ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="AlertCircle" className="mt-0.5 text-warning" />
          <div>
            <div className="font-medium text-foreground">
              Gateway spend unavailable: “{CHECK_LABELS[report.gatewayBanner.check]}” fails
            </div>
            <div className="text-muted-foreground">
              {report.gatewayBanner.message}. Stored gateway figures still show; new turns are estimated until it recovers.
            </div>
          </div>
        </div>
      ) : null}

      <Panel className="p-4">
        {hasFamily ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={effective}
              onValueChange={(v) => {
                if (v === "thread" || v === "family") setScope(v);
              }}
              aria-label="Scope"
            >
              <ToggleGroupItem value="thread" className="px-2.5 text-xs">
                This thread
              </ToggleGroupItem>
              <ToggleGroupItem value="family" className="px-2.5 text-xs">
                With children
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="text-xs text-muted-foreground tabular-nums">
              {effective === "family" ? "This thread alone" : "With children"}: {other.headline.primary}
            </div>
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {view.headline.primary}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{view.headline.detail}</div>
          {view.headline.secondary !== null ? (
            <div className="mt-1 text-sm text-muted-foreground">{view.headline.secondary}</div>
          ) : null}
          {view.headline.unpricedNote !== null ? (
            <div className="mt-1 text-sm text-muted-foreground">{view.headline.unpricedNote}</div>
          ) : null}
        </div>
        {report.stateMessage !== null && report.state !== "untagged" ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon name={report.state === "pending" ? "Loading" : "Info"} className={cn("size-3.5", report.state === "pending" && "animate-spin motion-reduce:animate-none")} />
            {report.stateMessage}
          </div>
        ) : null}
        {report.budget !== null ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-warning">
            <Icon name="AlertCircle" className="size-3.5" />
            {report.descendants > 0 ? "This family" : "This thread"} crossed {formatUsd(report.budget.amount, report.currency)}
          </div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
        <Stat
          label="API time"
          value={f.apiMs === null ? "—" : formatDuration(f.apiMs)}
          hint={f.apiMs === null ? "API time comes from gateway request logs; this thread has none" : "Sum of request durations the gateway logged"}
        />
        <Stat label="Wall time" value={formatDuration(f.wallMs)} hint="From each turn's start to its end" />
        <Stat
          label="Lines"
          value={
            <span className="whitespace-nowrap">
              <span className={f.linesAdded > 0 ? "text-success" : "text-muted-foreground"}>+{formatCount(f.linesAdded)}</span>{" "}
              <span className={f.linesRemoved > 0 ? "text-destructive" : "text-muted-foreground"}>−{formatCount(f.linesRemoved)}</span>
            </span>
          }
          hint="From file-change diffs; edits made through shell commands are not counted"
        />
        <Stat label="Turns" value={formatCount(f.turns)} hint={effective === "family" ? `Across ${formatCount(report.descendants + 1)} threads` : "Turns of this thread"} />
      </div>

      <section>
        <SectionTitle
          aside={
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatTokens(figureTokenCount(f))} tokens
              {cacheHitRatio(f.tokens) !== null ? ` · ${formatPercent(cacheHitRatio(f.tokens) as number)} cache hits` : ""}
            </span>
          }
        >
          Tokens
        </SectionTitle>
        <TokenBar tokens={f.tokens} untracked={f.untrackedTokens} className="h-2.5" />
        <div className="mt-2.5">
          <TokenLegend tokens={f.tokens} untracked={f.untrackedTokens} />
        </div>
      </section>

      {f.byModel.length > 0 ? (
        <section>
          <SectionTitle>By model</SectionTitle>
          <Panel className="overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="w-24 px-3 py-2 text-right font-medium">Cost</th>
                  <th className="hidden w-24 px-3 py-2 font-medium md:table-cell">Source</th>
                </tr>
              </thead>
              <tbody>
                {f.byModel.map((m) => {
                  const cost = costTotal(m.cost);
                  const sources = (["gateway", "harness", "estimate"] as const).filter((s) => m.cost[s] > 0);
                  return (
                    <tr key={m.model} className="border-b border-border last:border-0">
                      <td className="truncate px-3 py-2 font-mono text-xs" title={m.model}>
                        {m.model}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatTokens(totalTokens(m.tokens) + m.gatewayTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0}>
                              {cost === 0 && m.unpricedTokens > 0 ? (
                                <span className="text-muted-foreground">unpriced</span>
                              ) : (
                                formatUsd(cost, report.currency)
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {sources.length > 0 && !sources.includes("estimate")
                              ? `Cost reported by the ${sources.join(" and ")}, not estimated`
                              : priceSourceLabel(report.prices.models[m.model], Date.now())}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">
                        {sources.length > 0 ? sources.join(", ") : m.unpricedTokens > 0 ? "unpriced" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </section>
      ) : null}

      {report.turns.length > 0 && report.turns.some((t) => totalTokens(t.tokens) > 0 || costTotal(t.cost) > 0) ? (
        <section>
          <SectionTitle
            aside={<span className="text-xs text-muted-foreground">This thread</span>}
          >
            {measure === "tokens" ? "Tokens per turn" : "Cost per turn"}
          </SectionTitle>
          <Panel className="p-3">
            <TurnsChart
              turns={report.turns}
              measure={measure}
              currency={report.currency}
              selected={selected}
              onSelect={setSelected}
            />
            {selectedTurn !== null ? (
              <TurnDetails turn={selectedTurn} number={turnNumbers(report.turns).get(selectedTurn.turnId) ?? 0} currency={report.currency} />
            ) : null}
          </Panel>
        </section>
      ) : (
        <EmptyState>
          {report.turns.length > 0 ? "No usage recorded for this thread's turns." : "No turns yet. Usage appears after the first turn."}
        </EmptyState>
      )}

      {report.tree.length > 0 ? (
        <section>
          <SectionTitle aside={<span className="text-xs text-muted-foreground">{formatCount(report.descendants)} thread{report.descendants === 1 ? "" : "s"}{report.hiddenDescendants > 0 ? `, ${formatCount(report.hiddenDescendants)} hidden` : ""}</span>}>
            Child threads
          </SectionTitle>
          <ChildTree rows={report.tree} />
        </section>
      ) : null}

      {report.forks.length > 0 ? (
        <section>
          <SectionTitle aside={<span className="text-xs text-muted-foreground">Not included above</span>}>
            Forks of this thread
          </SectionTitle>
          <ForkList report={report} />
        </section>
      ) : null}

      <section>
        <SectionTitle>Data quality</SectionTitle>
        <QualityList notes={report.quality} />
      </section>

      <ExportBar report={report} scope={effective} />

      <p className="text-center text-xs text-muted-foreground">
        {[
          f.cost.estimate > 0 || f.unpricedTokens > 0 ? (
            <span key="prices" className={cn(pricesStale(report.prices.updatedAt, Date.now()) && "text-warning")}>
              {pricesLabel(report.prices, Date.now())}
            </span>
          ) : null,
          report.billing === "gateway" ? <span key="gw">gateway costs are what the gateway billed</span> : null,
        ]
          .filter((part) => part !== null)
          .flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
      </p>
    </TooltipProvider>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5" tabIndex={0}>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function TurnDetails({ turn, number, currency }: { turn: TurnView; number: number; currency: string }) {
  const cost = costTotal(turn.cost);
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium">{turnLabel(turn, number)}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-sm", SOURCE_STYLE[turn.source].swatch)} aria-hidden />
          {SOURCE_STYLE[turn.source].label}
          {turn.partial ? " · partial" : ""}
          {turn.approximate ? " · approximate" : ""}
        </div>
      </div>
      {turn.prompt !== null ? (
        <p className="truncate text-muted-foreground" title={turn.prompt}>
          “{turn.prompt}”
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Detail label="Cost" value={turn.source === "unpriced" ? "unpriced" : formatUsd(cost, currency)} />
        <Detail label="Tokens" value={formatExactTokens(totalTokens(turn.tokens))} />
        <Detail className="col-span-2" label="Model" value={turn.model?.replace(/\[[^\]]*\]$/, "") ?? "—"} />
        <Detail label="Requests" value={turn.requests > 0 ? formatCount(turn.requests) : "—"} />
        {turn.kind === "turn" && turn.startedAt !== null && turn.completedAt !== null ? (
          <Detail label="Wall time" value={formatDuration(turn.completedAt - turn.startedAt)} />
        ) : null}
        {turn.apiMs !== null ? <Detail label="API time" value={formatDuration(turn.apiMs)} /> : null}
        {turn.linesAdded + turn.linesRemoved > 0 ? (
          <Detail label="Lines" value={`+${formatCount(turn.linesAdded)} −${formatCount(turn.linesRemoved)}`} />
        ) : null}
      </dl>
      <TokenLegend tokens={turn.tokens} compact />
      {turn.subagents.length > 0 ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Subagents</div>
          <ul className="space-y-1 text-xs">
            {turn.subagents.map((s) => (
              <li key={s.agentId} className="flex items-center gap-2">
                <Icon name="UserRoundPlus" className="size-3.5 text-muted-foreground" />
                <span className="truncate font-mono">{s.agentId.slice(0, 12)}</span>
                <span className="text-muted-foreground">{s.model ?? ""}</span>
                <span className="ml-auto tabular-nums">
                  {formatTokens(totalTokens(s.tokens))} tokens · {formatCount(s.requests)} req
                  {s.costUsd !== null ? ` · ${formatUsd(s.costUsd, currency)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ChildTree({ rows }: { rows: TreeRow[] }) {
  const navigate = useBbNavigate();
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground" aria-hidden>
        <span className="flex-1">Thread</span>
        <span className="w-16 text-right">Own</span>
        <span className="w-16 text-right">With children</span>
        <span className="hidden w-14 sm:block">Share</span>
      </div>
      <ul role="tree" className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.threadId}
            role="treeitem"
            aria-level={row.depth}
            className={cn("group", row.archived && "opacity-60")}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => navigate.toThread(row.threadId)}
              title={row.title}
            >
              <span style={{ width: (row.depth - 1) * 14 }} className="shrink-0" aria-hidden />
              {row.depth > 1 ? <span className="-ml-1 text-muted-foreground/60" aria-hidden>└</span> : null}
              <HarnessIcon providerId={row.providerId} />
              <span className={cn("min-w-0 flex-1 truncate", row.deleted && "text-muted-foreground line-through")}>
                {row.title}
              </span>
              {row.hidden ? <Tag>hidden</Tag> : null}
              {row.archived ? <Tag>archived</Tag> : null}
              {row.deleted ? <Tag>deleted</Tag> : null}
              {row.status === "active" ? (
                <Icon name="Loading" className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
              ) : null}
              <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground" title="Own">
                {row.ownChip}
              </span>
              <span className="w-16 shrink-0 text-right font-medium tabular-nums" title="With its children">
                {row.familyChip}
              </span>
              <span className="hidden w-14 shrink-0 items-center gap-1 sm:flex" title={`${formatPercent(row.share)} of the total`}>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.round(row.share * 100)}%` }} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

    </Panel>
  );
}

function ForkList({ report }: { report: ThreadReport }) {
  const navigate = useBbNavigate();
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-border">
        {report.forks.map((fork) => (
          <li key={fork.threadId}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => navigate.toThread(fork.threadId)}
            >
              <HarnessIcon providerId={fork.providerId} />
              <span className="min-w-0 flex-1 truncate">{fork.title}</span>
              <span className="tabular-nums text-muted-foreground">{fork.chip}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function QualityList({ notes }: { notes: QualityNote[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {notes.map((note) => (
        <li key={note.id} className="flex gap-2">
          <Icon
            name={note.tone === "warn" ? "AlertCircle" : "Info"}
            className={cn("mt-0.5 size-3.5 shrink-0", note.tone === "warn" ? "text-warning" : "text-muted-foreground")}
          />
          <div className="min-w-0 flex-1">
            <span className={note.tone === "warn" ? "text-foreground" : "text-muted-foreground"}>{note.text}</span>
            {note.snippet !== undefined ? <Snippet label={note.snippet.label} code={note.snippet.code} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border bg-muted/50">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-[11px] text-muted-foreground">
        <span className="truncate">{label}</span>
        <button type="button" className="shrink-0 hover:text-foreground" onClick={() => void copy(code)}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-2 py-1.5 font-mono text-xs text-foreground">{code}</pre>
    </div>
  );
}

function ExportBar({ report, scope }: { report: ThreadReport; scope: "thread" | "family" }) {
  const [copied, copy] = useCopy();
  const csv = useMemo(() => turnsCsv(report.turns), [report.turns]);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void copy(reportMarkdown(report, scope)).then(
            () => toast.success("Usage copied as Markdown"),
            () => toast.error("Could not copy to the clipboard"),
          )
        }
      >
        <Icon name="Copy" className="size-3.5" />
        {copied ? "Copied" : "Copy as Markdown"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => download(`usage-${report.threadId}.csv`, csv, "text/csv")}
      >
        <Icon name="Download" className="size-3.5" />
        Download CSV
      </Button>
    </div>
  );
}
