/**
 * The global Usage page: the most expensive thread families of
 * the last 7 or 30 days. The project filter lives in the route's `subPath`
 * (`project/<id>`), since a nav panel's only prop is `subPath`.
 */
import { useState } from "react";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { familyContext, familyTags, formatTokens, formatUsd, pricesLabel, pricesStale, usualBilling } from "../core/format";
import type { TopFamily } from "../core/report-types";
import { EmptyState, HarnessIcon, Panel, Tag, useLive, useUsageRpc } from "./common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function projectFromSubPath(subPath: string): string | null {
  const match = /^project\/([A-Za-z0-9_-]+)\/?$/.exec(subPath);
  return match === null ? null : (match[1] as string);
}

const ALL = "__all__";

export function UsagePage({ subPath }: { subPath: string }) {
  const rpc = useUsageRpc();
  const navigate = useBbNavigate();
  const projectId = projectFromSubPath(subPath);
  const [days, setDays] = useState<7 | 30>(7);
  const { data, error, loading } = useLive(() => rpc.call("top", { projectId, sinceDays: days }), [rpc, projectId, days]);
  const families = data?.families ?? null;
  const { values } = useSettings();
  const currency = typeof values?.currency === "string" && values.currency !== "" ? values.currency : "$";
  const max = Math.max(...(families ?? []).map((f) => (f.usd > 0 ? f.usd : 0)), 0);
  const usual = usualBilling(families ?? []);
  const projectNames = new Map((data?.projects ?? []).map((p) => [p.id, p.name]));
  const now = Date.now();

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted-foreground">
            The most expensive thread families, each one a thread plus every thread it spawned. Dollars include the
            list-price equivalent of subscription use.
          </p>
          <Select
            value={projectId ?? ALL}
            onValueChange={(value) =>
              navigate.toPluginPanel("usage", { subPath: value === ALL ? "" : `project/${value}`, replace: true })
            }
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {(data?.projects ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={String(days)}
            onValueChange={(v) => {
              if (v === "7" || v === "30") setDays(Number(v) as 7 | 30);
            }}
            aria-label="Period"
          >
            <ToggleGroupItem value="7" className="px-2.5 text-xs">
              7 days
            </ToggleGroupItem>
            <ToggleGroupItem value="30" className="px-2.5 text-xs">
              30 days
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {error !== null && families === null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : families === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : families.length === 0 ? (
          <EmptyState>No thread families with usage in the last {days} days.</EmptyState>
        ) : (
          <Panel className={cn("overflow-hidden transition-opacity", loading && "opacity-50")}>
            <ol className="divide-y divide-border" aria-busy={loading}>
              {families.map((f, i) => (
                <FamilyRow
                  key={f.threadId}
                  family={f}
                  rank={i + 1}
                  max={max}
                  currency={currency}
                  // A project filter already names the project.
                  context={familyContext(f, {
                    projectName: projectId === null && f.projectId !== null ? (projectNames.get(f.projectId) ?? null) : null,
                    countThreads: true,
                    now,
                  })}
                  tags={familyTags(f, usual)}
                  onOpen={() => navigate.toThread(f.threadId)}
                />
              ))}
            </ol>
          </Panel>
        )}
        {data !== null ? (
          <p className={cn("text-xs", pricesStale(data.prices.updatedAt, Date.now()) ? "text-warning" : "text-muted-foreground")}>
            {pricesLabel(data.prices, Date.now())}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Fleet-wide dashboards by day and model live in the separate Usage plugin; this page ranks bb thread families.
          The same list is available as <code className="font-mono">bb thread-usage top</code>.
        </p>
      </div>
    </div>
  );
}

function FamilyRow({
  family,
  rank,
  max,
  currency,
  context,
  tags,
  onOpen,
}: {
  family: TopFamily;
  rank: number;
  max: number;
  currency: string;
  context: string[];
  tags: string[];
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{rank}</span>
        <HarnessIcon providerId={family.providerId} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{family.title}</span>
          {/* Parts wrap whole, so a narrow row keeps the last activity instead of cutting it off. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {context.map((part, i) => (
              <span key={part} className="whitespace-nowrap">
                {part}
                {i < context.length - 1 ? " ·" : ""}
              </span>
            ))}
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </span>
        </span>
        <span className="hidden w-24 shrink-0 sm:block" aria-hidden>
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full", family.billing === "subscription" ? "bg-muted-foreground/50" : "bg-primary/70")}
              style={{ width: `${max > 0 ? Math.max(2, (family.usd / max) * 100) : 0}%` }}
            />
          </span>
        </span>
        <span className="w-20 shrink-0 text-right" title="All dollars, list-price equivalent of subscription use included">
          <span className="block text-sm font-medium tabular-nums text-foreground">{formatUsd(family.usd, currency)}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{formatTokens(family.tokens)} tokens</span>
        </span>
      </button>
    </li>
  );
}
