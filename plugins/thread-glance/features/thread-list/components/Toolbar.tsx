// The top of the scroll area: the filter toggle and the settings
// popover.
import { useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClientPreferences, Lifecycle, Preferences } from "@/shared/preferences";
import { ATTENTION_EXPLANATION, ATTENTION_SUMMARY } from "../model/counters";
import { ICONS } from "../icons";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

type Page = "organize" | "sort" | "display" | "filter";

const PAGES: readonly { id: Page; label: string }[] = [
  { id: "organize", label: "Organize" },
  { id: "sort", label: "Sort" },
  { id: "display", label: "Display" },
  { id: "filter", label: "Filter" },
];

// bb's own segmented controls (the Reasoning picker, the diff view toggle)
// mark the chosen item with the state-active token and no shadow. The track
// is a translucent tint, so the chosen item reads as raised in both themes.
const SEGMENT_TRACK = "flex gap-0.5 rounded-md bg-surface-recessed p-0.5";
const SEGMENT_ITEM = "flex items-center justify-center rounded-sm text-xs outline-none focus-visible:ring-2";

function segmentClass(selected: boolean): string {
  return cn(
    SEGMENT_ITEM,
    selected
      ? "bg-state-active text-foreground"
      : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
  );
}

function Choice<T extends string | boolean>({
  label,
  value,
  current,
  onSelect,
  description,
}: {
  label: string;
  value: T;
  current: T;
  onSelect(value: T): void;
  description?: string;
}) {
  const checked = value === current;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => onSelect(value)}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
    >
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
        {checked ? <Icon name={ICONS.check} aria-hidden className="size-4" /> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
          checked && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {checked ? <Icon name={ICONS.check} aria-hidden className="size-3" /> : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
    </button>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground first:pt-0">{children}</p>;
}

export function SettingsPanel({
  prefs,
  client,
  onPrefs,
  onClient,
}: {
  prefs: Preferences;
  client: ClientPreferences;
  onPrefs(patch: Partial<Preferences>): void;
  onClient(patch: Partial<ClientPreferences>): void;
}) {
  const [page, setPage] = useState<Page>("organize");
  const sortField = prefs.chronologicalSort === "none" ? "updated" : prefs.chronologicalSort;
  const toggleLifecycle = (lifecycle: Lifecycle) => {
    const has = prefs.threadLifecycles.includes(lifecycle);
    const next = has
      ? prefs.threadLifecycles.filter((value) => value !== lifecycle)
      : [...prefs.threadLifecycles, lifecycle];
    if (next.length > 0) onPrefs({ threadLifecycles: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="Settings pages" className={SEGMENT_TRACK}>
        {PAGES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={page === candidate.id}
            onClick={() => setPage(candidate.id)}
            className={cn(segmentClass(page === candidate.id), "flex-1 px-1.5 py-1 focus-visible:ring-ring")}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={PAGES.find((candidate) => candidate.id === page)?.label} className="flex flex-col">
        {page === "organize" ? (
          <>
            <Heading>Group by</Heading>
            <Choice label="By project" value="project" current={prefs.organizationMode} onSelect={(value) => onPrefs({ organizationMode: value })} />
            <Choice label="Custom" description="Your own sections" value="chronological" current={prefs.organizationMode} onSelect={(value) => onPrefs({ organizationMode: value })} />
            <Choice label="By machine" value="machine" current={prefs.organizationMode} onSelect={(value) => onPrefs({ organizationMode: value })} />
            <Heading>Groups</Heading>
            <Toggle
              label="By environment"
              description="Fold threads sharing a worktree into a folder"
              checked={prefs.environmentGrouping}
              onChange={(value) => onPrefs({ environmentGrouping: value })}
            />
          </>
        ) : null}
        {page === "sort" ? (
          <>
            <Heading>Sort by</Heading>
            <Choice label="Updated" value="updated" current={sortField} onSelect={(value) => onPrefs({ chronologicalSort: value })} />
            <Choice label="Created" value="created" current={sortField} onSelect={(value) => onPrefs({ chronologicalSort: value })} />
            <Choice label="Alphabetical" value="alpha" current={sortField} onSelect={(value) => onPrefs({ chronologicalSort: value })} />
            <Heading>Direction</Heading>
            <Choice label="Default" value="default" current={prefs.sortDirection} onSelect={(value) => onPrefs({ sortDirection: value })} />
            <Choice label="Ascending" value="ascending" current={prefs.sortDirection} onSelect={(value) => onPrefs({ sortDirection: value })} />
            <Choice label="Descending" value="descending" current={prefs.sortDirection} onSelect={(value) => onPrefs({ sortDirection: value })} />
            <Heading>Order</Heading>
            <Toggle
              label="Working first"
              description="Running threads on top under Updated"
              checked={prefs.workingFirst}
              onChange={(value) => onPrefs({ workingFirst: value })}
            />
            <Toggle
              label="Fold older threads"
              description="Keep the 5 most recent quiet threads per group"
              checked={prefs.foldOlder}
              onChange={(value) => onPrefs({ foldOlder: value })}
            />
          </>
        ) : null}
        {page === "display" ? (
          <>
            <Heading>Density</Heading>
            <Choice label="Compact" description="One line per thread" value="compact" current={client.density} onSelect={(value) => onClient({ density: value })} />
            <Choice label="Comfortable" description="Adds branch and machine" value="comfortable" current={client.density} onSelect={(value) => onClient({ density: value })} />
            <Heading>Harness icon</Heading>
            <Choice label="Muted" description="Monochrome, beside the age" value="muted" current={prefs.harnessIcon} onSelect={(value) => onPrefs({ harnessIcon: value })} />
            <Choice label="Colour" description="Each provider's own tint" value="colour" current={prefs.harnessIcon} onSelect={(value) => onPrefs({ harnessIcon: value })} />
            <Choice label="Hidden" description="Shown in the hover card only" value="hidden" current={prefs.harnessIcon} onSelect={(value) => onPrefs({ harnessIcon: value })} />
            <Heading>Rows</Heading>
            <Toggle label="Pull requests" checked={prefs.showPullRequests} onChange={(value) => onPrefs({ showPullRequests: value })} />
          </>
        ) : null}
        {page === "filter" ? (
          <>
            <Heading>Show</Heading>
            <Toggle label="Active" checked={prefs.threadLifecycles.includes("active")} onChange={() => toggleLifecycle("active")} />
            <Toggle label="Archived" checked={prefs.threadLifecycles.includes("archived")} onChange={() => toggleLifecycle("archived")} />
            <Heading>Child threads in Needs attention</Heading>
            <Choice
              label="Blocked and orphaned failures"
              description="A child that waits on you, is offline, or failed while its parent thread is idle"
              value="blocked"
              current={prefs.childAttention}
              onSelect={(value) => onPrefs({ childAttention: value })}
            />
            <Choice
              label="Everything"
              description="Also every failed or unread child"
              value="everything"
              current={prefs.childAttention}
              onSelect={(value) => onPrefs({ childAttention: value })}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Toolbar({
  prefs,
  client,
  attentionCount,
  compact,
  onPrefs,
  onClient,
}: {
  prefs: Preferences;
  client: ClientPreferences;
  /** Threads that need attention, for the filter's badge. */
  attentionCount: number;
  /** Phone width: the filter's long label would truncate. */
  compact: boolean;
  onPrefs(patch: Partial<Preferences>): void;
  onClient(patch: Partial<ClientPreferences>): void;
}) {
  return (
    // Sticky with the group headers, so the filter stays in reach.
    <div className="sticky top-0 z-30 flex h-8 items-center gap-1 bg-sidebar pb-1">
      <TooltipProvider delayDuration={400}>
        <div role="radiogroup" aria-label="Filter threads" className={cn(SEGMENT_TRACK, "min-w-0 flex-1")}>
          {(
            [
              ["all", "All"],
              ["attention", "Needs attention"],
            ] as const
          ).map(([value, label]) => {
            const button = (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={client.filter === value}
                aria-description={value === "attention" ? ATTENTION_EXPLANATION : undefined}
                onClick={() => onClient({ filter: value })}
                className={cn(segmentClass(client.filter === value), "min-w-0 flex-1 gap-1 truncate px-1.5 py-0.5 focus-visible:ring-sidebar-ring")}
              >
                <span className="truncate">{value === "attention" && compact ? "Attention" : label}</span>
                {value === "attention" && attentionCount > 0 ? (
                  <span className="shrink-0 tabular-nums text-muted-foreground">{attentionCount}</span>
                ) : null}
              </button>
            );
            if (value !== "attention") return button;
            return (
              <Tooltip key={value}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="bottom">{ATTENTION_SUMMARY}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Thread Glance settings" title="List settings" className={ROW_ICON_BUTTON}>
            <Icon name={ICONS.settings} aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <SettingsPanel prefs={prefs} client={client} onPrefs={onPrefs} onClient={onClient} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
