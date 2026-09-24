/**
 * Attribution state and billing mode.
 */
import type { RateLimitKind, RoutingFact } from "./ledger";
import { hostOf } from "./litellm";

export type AttributionState =
  | "no-adapter"
  | "unsupported"
  | "account-pool"
  | "not-routed"
  | "pending"
  | "tagged"
  | "untagged"
  /** Idle past the wait with no output tokens: there is nothing to attribute. */
  | "no-usage";

export type BillingMode = "gateway" | "api-key" | "subscription" | "unknown";
export type BillingSetting = "auto" | "gateway" | "api-key" | "subscription";

/** Idle time after which a thread with no gateway rows counts as untagged. */
export const PENDING_MS = 60_000;

export const BASE_URL_VARS = ["ANTHROPIC_BASE_URL", "CODEX_OPENAI_BASE_URL", "OPENAI_BASE_URL"];

export function isCursorProvider(providerId: string | null): boolean {
  return providerId !== null && (providerId === "acp-cursor" || providerId.includes("cursor"));
}

export type Routing =
  | { kind: "account-pool" }
  | { kind: "other-host"; host: string }
  | { kind: "gateway" }
  | { kind: "unknown" };

/** What the thread's `provider.env-resolved` facts say about where requests go. */
export function routingFrom(facts: readonly RoutingFact[], gatewayUrl: string | null): Routing {
  const relevant = facts.filter((f) => BASE_URL_VARS.includes(f.name));
  if (relevant.some((f) => f.source === "plugin:account-pool")) return { kind: "account-pool" };
  const gatewayHost = hostOf(gatewayUrl);
  for (const fact of relevant) {
    const host = hostOf(fact.value);
    if (host === null) continue;
    if (gatewayHost !== null && host === gatewayHost) return { kind: "gateway" };
    return { kind: "other-host", host };
  }
  return { kind: "unknown" };
}

export interface AttributionInput {
  adapter: "none" | "litellm";
  providerId: string | null;
  routing: Routing;
  hasRows: boolean;
  hasTurns: boolean;
  hasOutputTokens: boolean;
  /** Epoch ms the thread last went idle, or null while running. */
  idleSince: number | null;
  now: number;
}

/**
 * The attribution state, rules checked top to bottom. `tagged` wins over the
 * routing rules below it only in one sense: rows are proof, so a thread with
 * rows is tagged even if a stale routing fact says otherwise.
 */
export function attributionState(input: AttributionInput): AttributionState {
  if (input.adapter === "none") return "no-adapter";
  if (isCursorProvider(input.providerId)) return "unsupported";
  if (input.hasRows) return "tagged";
  if (input.routing.kind === "account-pool") return "account-pool";
  if (input.routing.kind === "other-host") return "not-routed";
  // Pending needs turns; a thread without any has nothing to wait for.
  if (!input.hasTurns) return "no-usage";
  const idleFor = input.idleSince === null ? 0 : input.now - input.idleSince;
  if (input.idleSince === null || idleFor < PENDING_MS) return "pending";
  return input.hasOutputTokens ? "untagged" : "no-usage";
}

export interface BillingInput {
  state: AttributionState;
  setting: BillingSetting;
  rateLimitKind: RateLimitKind | null;
}

/** The billing mode; docs/reference/thread-usage-cost-sources.md lists the order of the checks. */
export function billingMode(input: BillingInput): BillingMode {
  if (input.state === "tagged") return "gateway";
  if (input.setting !== "auto") return input.setting;
  if (input.state === "account-pool") return "subscription";
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

export { HARNESS_LABEL, SETUP_SNIPPETS } from "./attribution-snippets";
import { HARNESS_LABEL } from "./attribution-snippets";

/** One-line explanation of a state, as the panel shows it. */
export function describeState(
  state: AttributionState,
  opts: { host?: string | null; providerId?: string | null },
): string | null {
  switch (state) {
    case "no-adapter":
      return null;
    case "unsupported":
      return "No token or cost data for Cursor";
    case "account-pool":
      return "Not via gateway: account pool";
    case "not-routed":
      return `Not via gateway: requests go to ${opts.host ?? "another host"}`;
    case "no-usage":
      return null;
    case "pending":
      return "Waiting for gateway spend…";
    case "tagged":
      return null;
    case "untagged": {
      // Claude Code is tagged by the plugin itself; no config line helps it.
      if (opts.providerId === "claude-code") {
        return "No gateway spend for this thread: its turns ran before tagging was on, or its requests bypass the gateway";
      }
      const harness = HARNESS_LABEL[opts.providerId ?? ""] ?? opts.providerId ?? "the harness";
      return `Requests are not tagged. Add this line to ${harness} config`;
    }
  }
}
