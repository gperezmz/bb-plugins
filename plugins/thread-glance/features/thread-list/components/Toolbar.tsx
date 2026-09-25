// The top of the scroll area: the settings button and its popover.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ClientPreferences, Preferences } from "@/shared/preferences";
import { lifecyclesFor, sortArrow, sortFieldPatch, threadsShown } from "../model/settings";
import { effectiveSortField } from "../model/sort";
import { ICONS } from "../icons";
import { ROW_ICON_BUTTON } from "./ThreadRowView";

// bb's own segmented controls (the Reasoning picker, the diff view toggle)
// mark the chosen item with the state-active token and no shadow. The track
// is a translucent tint, so the chosen item reads as raised in both themes.
const SEGMENT_TRACK = "flex min-w-0 flex-1 gap-0.5 rounded-md bg-surface-recessed p-0.5";
const SEGMENT_ITEM =
  "flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-1 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function segmentClass(selected: boolean): string {
  return cn(
    SEGMENT_ITEM,
    selected
      ? "bg-state-active text-foreground"
      : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
  );
}

/** A label, then its control, on one line. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="w-[5.5rem] shrink-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  current,
  onSelect,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  current: T;
  onSelect(value: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={SEGMENT_TRACK}>
      {options.map(([value, text]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === current}
          onClick={() => onSelect(value)}
          className={segmentClass(value === current)}
        >
          {text}
        </button>
      ))}
    </div>
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
      role="checkbox"
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
  return <h3 className="px-2 pb-0.5 pt-3 text-xs font-medium text-muted-foreground first:pt-0">{children}</h3>;
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
  const arrow = sortArrow(prefs);
  return (
    <div className="flex flex-col">
      <Heading>List</Heading>
      <Line label="Group by">
        <Segmented
          label="Group by"
          options={[
            ["project", "Project"],
            ["chronological", "Custom"],
            ["machine", "Machine"],
          ]}
          current={prefs.organizationMode}
          onSelect={(value) => onPrefs({ organizationMode: value })}
        />
      </Line>
      <Line label="Sort by">
        <Segmented
          label="Sort by"
          options={[
            ["updated", "Updated"],
            ["created", "Created"],
            ["alpha", "A–Z"],
          ]}
          current={effectiveSortField(prefs.chronologicalSort)}
          onSelect={(value) => onPrefs(sortFieldPatch(value))}
        />
        <button
          type="button"
          aria-label={`Sort order: ${arrow.label}. Reverse`}
          title={arrow.label}
          onClick={() => onPrefs(arrow.patch)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-recessed text-xs outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          {arrow.glyph}
        </button>
      </Line>
      <Toggle label="Working threads first" checked={prefs.workingFirst} onChange={(value) => onPrefs({ workingFirst: value })} />
      <Toggle
        label="Worktrees as folders"
        description="Threads sharing a worktree fold into one row"
        checked={prefs.environmentGrouping}
        onChange={(value) => onPrefs({ environmentGrouping: value })}
      />
      <Toggle label="Collapse older threads" checked={prefs.foldOlder} onChange={(value) => onPrefs({ foldOlder: value })} />
      <Heading>Rows</Heading>
      <Line label="Density">
        <Segmented
          label="Density"
          options={[
            ["compact", "Compact"],
            ["comfortable", "Comfortable"],
          ]}
          current={client.density}
          onSelect={(value) => onClient({ density: value })}
        />
      </Line>
      <Line label="Harness icon">
        <Segmented
          label="Harness icon"
          options={[
            ["muted", "Muted"],
            ["colour", "Colour"],
            ["hidden", "Hidden"],
          ]}
          current={prefs.harnessIcon}
          onSelect={(value) => onPrefs({ harnessIcon: value })}
        />
      </Line>
      <Toggle label="Pull request badge" checked={prefs.showPullRequests} onChange={(value) => onPrefs({ showPullRequests: value })} />
      <Heading>Show</Heading>
      <Line label="Threads">
        <Segmented
          label="Threads"
          options={[
            ["active", "Active"],
            ["archived", "Archived"],
            ["both", "Both"],
          ]}
          current={threadsShown(prefs.threadLifecycles)}
          onSelect={(value) => onPrefs({ threadLifecycles: lifecyclesFor(value) })}
        />
      </Line>
      <Toggle
        label="Needs you counts every child"
        description="Every unread or failed child thread; otherwise only those blocked on you."
        checked={prefs.childAttention === "everything"}
        onChange={(value) => onPrefs({ childAttention: value ? "everything" : "blocked" })}
      />
    </div>
  );
}

/** The slim row above the list: ⚙ alone at its right. */
export function Toolbar({
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
  return (
    // Sticky with the group headers, so the settings stay in reach.
    <div className="sticky top-0 z-30 flex h-7 items-center justify-end bg-sidebar">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Thread Glance settings" title="List settings" className={ROW_ICON_BUTTON}>
            <Icon name={ICONS.settings} aria-hidden className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <SettingsPanel prefs={prefs} client={client} onPrefs={onPrefs} onClient={onClient} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
