/** Cache Keeper's four settings and their parsed form. */
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import type { KeepWarmSetting } from "../core/switch";

export const WAIT_OPTIONS = ["10 min", "15 min", "30 min"] as const;

/** The "Keep caches warm while waiting" choices, as Settings shows them, and what each parses to. */
export const KEEP_WARM_OPTIONS: Record<string, KeepWarmSetting> = {
  "Every waiting thread": "every",
  "Only threads switched on": "switched",
  Never: "never",
};

export const SETTINGS = {
  keepWarm: {
    type: "select",
    label: "Keep caches warm while waiting",
    description:
      "Which Claude Code threads get keep-warms while they wait on background work, child threads or a scheduled message. A thread tree follows this until you flip its Keep warm while waiting switch in the composer chip, from the banner or with `bb cache-keeper keep-warm`; Never sends none whatever the switches say.",
    options: Object.keys(KEEP_WARM_OPTIONS),
    default: "Only threads switched on",
  },
  stalledCheckIns: {
    type: "boolean",
    label: "Check in on stalled background work",
    description:
      "On every Claude Code thread, whatever its keep-warm switch says: when a background command or subagent has produced no output or progress for the no-output wait, ask the agent to check it. Off also stops keep-warms asking about tasks running 30 minutes or more.",
    default: true,
  },
  noOutputWait: {
    type: "select",
    label: "No-output wait",
    description: "How long a background command or subagent goes without output or progress before it gets a check-in. Each further check-in waits twice as long.",
    options: [...WAIT_OPTIONS],
    default: "15 min",
  },
  fetchPrices: {
    type: "boolean",
    label: "Fetch current prices daily",
    description: "LiteLLM's and models.dev's public price lists. Off uses the list bundled with the plugin and fetches nothing.",
    default: true,
  },
} satisfies PluginSettingDescriptors;

export interface KeeperSettings {
  keepWarm: KeepWarmSetting;
  checkIns: boolean;
  waitMs: number;
  fetchPrices: boolean;
}

export function parseSettings(values: Record<string, unknown>): KeeperSettings {
  const wait = typeof values.noOutputWait === "string" ? Number.parseInt(values.noOutputWait, 10) : NaN;
  return {
    keepWarm: (typeof values.keepWarm === "string" ? KEEP_WARM_OPTIONS[values.keepWarm] : undefined) ?? "switched",
    checkIns: values.stalledCheckIns !== false,
    waitMs: ([10, 15, 30].includes(wait) ? wait : 15) * 60_000,
    fetchPrices: values.fetchPrices !== false,
  };
}
