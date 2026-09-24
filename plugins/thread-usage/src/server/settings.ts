/**
 * Declared settings and their parsed form. The backend reads
 * settings on every call rather than at load, so a saved value (a rotated
 * read key included) takes effect at once.
 */
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { BillingSetting } from "../core/attribution";
import { extraHeadersError } from "../core/headers";
import { EXAMPLE_OVERRIDES, parsePriceOverrides, priceOverridesError, type PriceOverrides } from "../core/pricing";

const billingOptions = ["auto", "gateway", "api-key", "subscription"] as const;

export const SETTINGS = {
  adapter: {
    type: "select",
    label: "Gateway adapter",
    description:
      "Where exact cost comes from. \"litellm\" reads spend per thread from a LiteLLM gateway; \"none\" estimates cost from tokens.",
    options: ["none", "litellm"],
    default: "none",
  },
  gatewayUrl: {
    type: "string",
    label: "Gateway URL",
    description: "Base URL of the LiteLLM proxy that serves /spend/logs/v2, e.g. https://llm.example.com",
    default: "",
    experimental_schema: z
      .string()
      .refine((v) => v.trim() === "" || /^https?:\/\/[^\s]+$/.test(v.trim()), "Must be an http(s) URL"),
  },
  readKey: {
    type: "string",
    label: "Gateway read key",
    description:
      "A read-only proxy_admin_viewer key (recommended) or an internal_user key. Kept on the bb server only.",
    secret: true,
  },
  extraHeaders: {
    type: "string",
    label: "Extra Claude Code headers",
    description:
      "Headers merged into ANTHROPIC_CUSTOM_HEADERS, one \"Name: Value\" per line. The plugin's value replaces the shell's, so list any you already set. Auth headers are refused: bb shows these values in the timeline.",
    experimental_multiline: true,
    default: "",
    experimental_schema: z.string().superRefine((v, ctx) => {
      const error = extraHeadersError(v);
      if (error !== null) ctx.addIssue({ code: "custom", message: error });
    }),
  },
  priceOverrides: {
    type: "string",
    label: "Price overrides and aliases",
    description: `JSON. Prices are USD per million tokens and beat the gateway's and the snapshot's. Aliases apply first. Example: ${EXAMPLE_OVERRIDES.replace(/\s+/g, " ")}`,
    experimental_multiline: true,
    default: "",
    experimental_schema: z.string().superRefine((v, ctx) => {
      const error = priceOverridesError(v);
      if (error !== null) ctx.addIssue({ code: "custom", message: error });
    }),
  },
  refreshPrices: {
    type: "boolean",
    label: "Refresh prices online",
    description:
      "Fetch LiteLLM's and models.dev's public price lists once a day, so estimates use current prices. Off uses the list bundled with the plugin, which goes out of date.",
    default: true,
  },
  readLogs: {
    type: "boolean",
    label: "Read harness logs",
    description:
      "Read session logs on the machine that ran a thread: Claude Code subagent tokens, history from before install, and pi's own cost.",
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
    description: "Show the family total beside the header icon.",
    default: false,
  },
  warnAbove: {
    type: "number",
    label: "Warn above",
    description: "Tint the header icon and show one toast when a family's billed total crosses this amount. 0 turns it off.",
    default: 0,
    experimental_schema: z.number().min(0),
  },
  currency: {
    type: "string",
    label: "Currency label",
    description: "Figures are USD; change the label for internal chargeback (e.g. \"USD\" or \"credits\").",
    default: "$",
    experimental_schema: z.string().refine((v) => v.trim().length >= 1 && v.trim().length <= 12, "1 to 12 characters"),
  },
} satisfies PluginSettingDescriptors;

export interface UsageSettings {
  adapter: "none" | "litellm";
  gatewayUrl: string;
  readKey: string | null;
  extraHeaders: string;
  priceOverrides: PriceOverrides;
  priceOverridesError: string | null;
  refreshPrices: boolean;
  readLogs: boolean;
  billing: Record<"claudeCode" | "codex" | "pi" | "other", BillingSetting>;
  showAmount: boolean;
  warnAbove: number | null;
  currency: string;
}

type RawSettings = Record<string, unknown>;

function billingValue(v: unknown): BillingSetting {
  return typeof v === "string" && (billingOptions as readonly string[]).includes(v)
    ? (v as BillingSetting)
    : "auto";
}

export function parseSettings(raw: RawSettings): UsageSettings {
  const overridesText = typeof raw.priceOverrides === "string" ? raw.priceOverrides : "";
  let overrides: PriceOverrides = {};
  let overridesError: string | null = null;
  try {
    overrides = parsePriceOverrides(overridesText);
  } catch {
    overridesError = priceOverridesError(overridesText);
  }
  const warn = typeof raw.warnAbove === "number" && raw.warnAbove > 0 ? raw.warnAbove : null;
  const key = typeof raw.readKey === "string" && raw.readKey.trim() !== "" ? raw.readKey.trim() : null;
  return {
    adapter: raw.adapter === "litellm" ? "litellm" : "none",
    gatewayUrl: typeof raw.gatewayUrl === "string" ? raw.gatewayUrl.trim() : "",
    readKey: key,
    extraHeaders: typeof raw.extraHeaders === "string" ? raw.extraHeaders : "",
    priceOverrides: overrides,
    priceOverridesError: overridesError,
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

/** Settings the frontend may see (no secret). */
export interface PublicSettings {
  adapter: "none" | "litellm";
  showAmount: boolean;
  warnAbove: number | null;
  currency: string;
  readLogs: boolean;
}

export function publicSettings(s: UsageSettings): PublicSettings {
  return {
    adapter: s.adapter,
    showAmount: s.showAmount,
    warnAbove: s.warnAbove,
    currency: s.currency,
    readLogs: s.readLogs,
  };
}
