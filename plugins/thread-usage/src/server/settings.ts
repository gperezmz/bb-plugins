/**
 * Declared settings and their parsed form. The backend reads settings on
 * every call rather than at load, so a saved value takes effect at once.
 */
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import type { BillingSetting } from "../core/billing";

const billingOptions = ["auto", "api-key", "subscription"] as const;

export const SETTINGS = {
  refreshPrices: {
    type: "boolean",
    label: "Refresh prices online",
    description:
      "Fetch models.dev's price list once a day, so estimates use current prices. Off uses the list bundled with the plugin, which goes out of date.",
    default: true,
  },
  readLogs: {
    type: "boolean",
    label: "Read harness logs",
    description:
      "Read session logs on the machine that ran a thread: Claude Code subagent tokens, history from before install, and which cache writes were 1-hour ones.",
    default: true,
  },
  billingClaudeCode: {
    type: "select",
    label: "Billing for Claude Code",
    description: "auto detects it from rate-limit events; set it when detection says \"unknown\".",
    options: [...billingOptions],
    default: "auto",
  },
  billingCodex: {
    type: "select",
    label: "Billing for Codex",
    options: [...billingOptions],
    default: "auto",
  },
  billingPi: {
    type: "select",
    label: "Billing for pi",
    options: [...billingOptions],
    default: "auto",
  },
  billingOther: {
    type: "select",
    label: "Billing for other harnesses",
    options: [...billingOptions],
    default: "auto",
  },
  showAmount: {
    type: "boolean",
    label: "Show amount in header",
    description: "Show the thread tree total inside the header chip, after the coin.",
    default: false,
  },
  warnAbove: {
    type: "number",
    label: "Warn above",
    description: "Tint the header icon and show one toast when a thread tree's billed total crosses this amount. 0 turns it off.",
    default: 0,
    experimental_schema: z.number().check(z.minimum(0)),
  },
  currency: {
    type: "string",
    label: "Currency label",
    description: "Figures are USD; change the label for internal chargeback (e.g. \"USD\" or \"credits\").",
    default: "$",
    experimental_schema: z.string().check(z.refine((v) => v.trim().length >= 1 && v.trim().length <= 12, "1 to 12 characters")),
  },
} satisfies PluginSettingDescriptors;

export interface UsageSettings {
  refreshPrices: boolean;
  readLogs: boolean;
  billing: Record<"claudeCode" | "codex" | "pi" | "other", BillingSetting>;
  showAmount: boolean;
  warnAbove: number | null;
  currency: string;
}

type RawSettings = Record<string, unknown>;

/** A choice saved as `gateway`, which is no longer an option, reads as `auto`. */
function billingValue(v: unknown): BillingSetting {
  return typeof v === "string" && (billingOptions as readonly string[]).includes(v)
    ? (v as BillingSetting)
    : "auto";
}

export function parseSettings(raw: RawSettings): UsageSettings {
  const warn = typeof raw.warnAbove === "number" && raw.warnAbove > 0 ? raw.warnAbove : null;
  return {
    refreshPrices: raw.refreshPrices !== false,
    readLogs: raw.readLogs !== false,
    billing: {
      claudeCode: billingValue(raw.billingClaudeCode),
      codex: billingValue(raw.billingCodex),
      pi: billingValue(raw.billingPi),
      other: billingValue(raw.billingOther),
    },
    showAmount: raw.showAmount === true,
    warnAbove: warn,
    currency: typeof raw.currency === "string" && raw.currency.trim() !== "" ? raw.currency.trim() : "$",
  };
}

/** Settings the frontend may see. */
export interface PublicSettings {
  showAmount: boolean;
  warnAbove: number | null;
  currency: string;
  readLogs: boolean;
}

export function publicSettings(s: UsageSettings): PublicSettings {
  return {
    showAmount: s.showAmount,
    warnAbove: s.warnAbove,
    currency: s.currency,
    readLogs: s.readLogs,
  };
}
