/**
 * Billing mode: how a thread's tokens are paid for.
 */
import type { RateLimitKind, RoutingFact } from "./ledger";

export type BillingMode = "api-key" | "subscription" | "unknown";
export type BillingSetting = "auto" | "api-key" | "subscription";

export const BASE_URL_VARS = ["ANTHROPIC_BASE_URL", "CODEX_OPENAI_BASE_URL", "OPENAI_BASE_URL"];

export function isCursorProvider(providerId: string | null): boolean {
  return providerId !== null && (providerId === "acp-cursor" || providerId.includes("cursor"));
}

/** True when the thread's `provider.env-resolved` facts say bb's account-pool plugin routes its requests. */
export function routedThroughAccountPool(facts: readonly RoutingFact[]): boolean {
  return facts.some((f) => BASE_URL_VARS.includes(f.name) && f.source === "plugin:account-pool");
}

export interface BillingInput {
  setting: BillingSetting;
  accountPool: boolean;
  rateLimitKind: RateLimitKind | null;
}

/** The billing mode; docs/reference/thread-usage-cost-sources.md lists the order of the checks. */
export function billingMode(input: BillingInput): BillingMode {
  if (input.setting !== "auto") return input.setting;
  if (input.accountPool) return "subscription";
  if (input.rateLimitKind === "subscription-window") return "subscription";
  if (input.rateLimitKind === "spend-control" || input.rateLimitKind === "credits") {
    return "api-key";
  }
  return "unknown";
}

/** Maps a bb provider id to the key used by the per-provider billing setting. */
export function billingSettingKey(providerId: string | null): "claudeCode" | "codex" | "pi" | "other" {
  if (providerId === "claude-code") return "claudeCode";
  if (providerId === "codex") return "codex";
  if (providerId === "pi") return "pi";
  return "other";
}
