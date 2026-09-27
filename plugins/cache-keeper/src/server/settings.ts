/** Cache Keeper's three settings and their parsed form. */
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";

export const WAIT_OPTIONS = ["10 min", "15 min", "30 min"] as const;

export const SETTINGS = {
  checkIns: {
    type: "boolean",
    label: "Check in on background work",
    description:
      "On every Claude Code thread whose turn ends while it waits on background work, child threads or a scheduled message: keep its cache warm, and check in on a background command or subagent that has stopped producing output.",
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
  checkIns: boolean;
  waitMs: number;
  fetchPrices: boolean;
}

export function parseSettings(values: Record<string, unknown>): KeeperSettings {
  const wait = typeof values.noOutputWait === "string" ? Number.parseInt(values.noOutputWait, 10) : NaN;
  return {
    checkIns: values.checkIns !== false,
    waitMs: ([10, 15, 30].includes(wait) ? wait : 15) * 60_000,
    fetchPrices: values.fetchPrices !== false,
  };
}
