/**
 * Settings → Plugins → Cache Keeper → Waiting threads, Stalled tasks and
 * Prices: the plugin's four settings, drawn by the plugin because bb draws
 * declared settings in one ungrouped box.
 */
import type { ReactNode } from "react";
import type { KeepWarmSetting } from "@/src/core/switch";
import { KEEP_WARM_OPTIONS, WAIT_MINUTES, type KeeperSettings } from "@/src/server/settings";
import { useKeeperSettings } from "../api";
import { Switch } from "./Switch";

export const WAITING_THREADS_TITLE = "Waiting threads";
export const WAITING_THREADS_DESCRIPTION = "Keeping a waiting thread's prompt cache warm, so coming back to it is cheap.";
export const STALLED_TASKS_TITLE = "Stalled tasks";
export const STALLED_TASKS_DESCRIPTION = "Noticing a background command or subagent that has stopped making progress. Separate from keeping caches warm.";
export const PRICES_TITLE = "Prices";
export const PRICES_DESCRIPTION = "Where the dollar figures come from.";

type Change = (patch: Partial<KeeperSettings>) => void;

/** Draws a section's rows once the settings have loaded, or why they have not. */
function Section({ rows }: { rows: (settings: KeeperSettings, change: Change) => ReactNode }) {
  const { settings, error, change } = useKeeperSettings();
  if (settings === null) return <p className={`text-sm ${error === null ? "text-muted-foreground" : "text-destructive"}`}>{error ?? "Loading…"}</p>;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {rows(settings, (patch) => void change(patch))}
      {error !== null && <p className="text-destructive">{error}</p>}
    </div>
  );
}

function Row({ id, label, description, children }: { id: string; label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <span id={id} className="font-medium">
          {label}
        </span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Select<T extends string | number>({ id, value, options, onChange }: { id: string; value: T; options: [string, T][]; onChange: (value: T) => void }) {
  return (
    <select
      aria-labelledby={id}
      value={String(value)}
      onChange={(e) => onChange(options.find(([, v]) => String(v) === e.target.value)![1])}
      className="h-8 shrink-0 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {options.map(([label, v]) => (
        <option key={label} value={String(v)}>
          {label}
        </option>
      ))}
    </select>
  );
}

const KEEP_WARM = Object.entries(KEEP_WARM_OPTIONS) as [string, KeepWarmSetting][];
const WAITS = WAIT_MINUTES.map((m): [string, number] => [`${m} min`, m * 60_000]);

export function WaitingThreads() {
  return (
    <Section
      rows={(s, change) => (
        <Row
          id="cache-keeper-keep-warm"
          label="Keep caches warm while waiting"
          description="Which Claude Code threads are kept warm while they wait on background work, child threads or a scheduled message. A thread tree follows this until you flip its Keep warm while waiting switch in the composer chip or with the bb cache-keeper CLI; Never keeps none warm, whatever the switches say."
        >
          <Select id="cache-keeper-keep-warm" value={s.keepWarm} options={KEEP_WARM} onChange={(keepWarm) => change({ keepWarm })} />
        </Row>
      )}
    />
  );
}

export function StalledTasks() {
  return (
    <Section
      rows={(s, change) => (
        <>
          <Row
            id="cache-keeper-check-ins"
            label="Check on stalled tasks"
            description="Ask the agent to check on a background command or subagent that has shown no output or progress for the no-output wait, on every Claude Code thread. While on, the turns that keep caches warm also ask about tasks running 30 minutes or more."
          >
            <Switch checked={s.checkIns} labelledBy="cache-keeper-check-ins" onClick={() => change({ checkIns: !s.checkIns })} />
          </Row>
          <Row
            id="cache-keeper-wait"
            label="No-output wait"
            description="How long a task goes without output or progress before it counts as stalled. Each further check-in waits twice as long."
          >
            <Select id="cache-keeper-wait" value={s.waitMs} options={WAITS} onChange={(waitMs) => change({ waitMs })} />
          </Row>
        </>
      )}
    />
  );
}

export function Prices() {
  return (
    <Section
      rows={(s, change) => (
        <Row
          id="cache-keeper-prices"
          label="Fetch current prices daily"
          description="LiteLLM's and models.dev's public price lists. Off uses the list bundled with the plugin and fetches nothing."
        >
          <Switch checked={s.fetchPrices} labelledBy="cache-keeper-prices" onClick={() => change({ fetchPrices: !s.fetchPrices })} />
        </Row>
      )}
    />
  );
}
