/**
 * Number formatting and headline wording shared by the panel, the header
 * chip, the CLI and the agent tool, so every surface says the same thing.
 */
import type { BillingMode } from "./attribution";
import { costTotal, figureTokenCount } from "./figure-math";
import type { PriceSourceInfo, PricesInfo, TopFamily } from "./report-types";
import type { CostBuckets, Figure } from "./summary";

export function formatUsd(usd: number, label = "$"): string {
  const abs = Math.abs(usd);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  const text = abs >= 1000 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(digits);
  const prefix = label === "$" ? "$" : `${label} `;
  return `${usd < 0 ? "-" : ""}${prefix}${text}`;
}

/** 1234 → "1.2k", 12_400_000 → "12.4M". */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${trim1(n / 1000)}k`;
  if (abs < 1_000_000_000) return `${trim1(n / 1_000_000)}M`;
  return `${trim1(n / 1_000_000_000)}B`;
}

function trim1(n: number): string {
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(1);
  return fixed.replace(/\.0$/, "");
}

/** 1471556869 → "1,471,556,869"; the grouping every whole number in the panels shares. */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatExactTokens(n: number): string {
  return formatCount(n);
}

/** 3_723_000 ms → "1h 2m", 83_000 → "1m 23s", 4_200 → "4.2s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Beyond this the panels say plainly that prices are out of date. */
export const STALE_AFTER_MS = 7 * 86_400_000;

/** No successful refresh of the public list in over 7 days, or none at all. */
export function pricesStale(updatedAt: number | null, now: number): boolean {
  return updatedAt === null || now - updatedAt > STALE_AFTER_MS;
}

/** 90_000 → "1 minute ago", 3 h → "3 hours ago". */
export function formatAgo(ms: number): string {
  const units: [string, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  for (const [name, size] of units) {
    if (ms >= size) {
      const n = Math.floor(ms / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/**
 * The line under the figures saying how fresh the prices behind estimates
 * are. Plain when they are more than a week old, or were never fetched.
 */
export function pricesLabel(prices: PricesInfo, now: number): string {
  if (prices.updatedAt !== null) {
    const ago = formatAgo(now - prices.updatedAt);
    return pricesStale(prices.updatedAt, now)
      ? `Estimated with public list prices, last updated ${ago}. They are more than a week old and may be out of date${prices.lastError === null ? "" : ` (refresh failing: ${prices.lastError})`}`
      : `Estimated with public list prices, updated ${ago}`;
  }
  const bundled = `the price list bundled with the plugin${prices.bundledDate === null ? "" : ` (${prices.bundledDate.slice(0, 10)})`}`;
  if (!prices.refreshOn) return `Estimated with ${bundled}. Online updates are off, so prices may be out of date`;
  return `Estimated with ${bundled}; it has not been updated online yet, so prices may be out of date${prices.lastError === null ? "" : ` (refresh failing: ${prices.lastError})`}`;
}

/** Tooltip for one By-model row: where its price came from and when that list was fetched. */
export function priceSourceLabel(info: PriceSourceInfo | undefined, now: number): string {
  if (info === undefined) return "No public price for this model";
  const names: Record<PriceSourceInfo["source"], string> = {
    override: "Your price override",
    gateway: "The gateway's price map",
    litellm: "LiteLLM public list",
    snapshot: "LiteLLM list bundled with the plugin",
    "models.dev": "models.dev public list",
  };
  const fetched = info.fetchedAt === null ? "" : `, fetched ${formatAgo(now - info.fetchedAt)}`;
  return `${names[info.source]}${fetched}, as ${info.as}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * "$4.12 (gateway) + $0.30 (estimate)", sources in trust order, empty ones
 * left out. A single source is named without its amount ("estimate"), since
 * the headline above it already shows that amount.
 */
export function sourceMix(cost: CostBuckets, label = "$"): string {
  const parts: [string, number][] = (
    [
      ["gateway", cost.gateway],
      ["harness", cost.harness],
      ["estimate", cost.estimate],
    ] as [string, number][]
  ).filter(([, usd]) => usd > 0);
  if (parts.length === 1) return (parts[0] as [string, number])[0];
  return parts.map(([name, usd]) => `${formatUsd(usd, label)} (${name})`).join(" + ");
}

type TopBilling = TopFamily["billing"];

/** The billing most families in a ranked list share, or null for an empty list. */
export function usualBilling(families: readonly Pick<TopFamily, "billing">[]): TopBilling | null {
  const counts = new Map<TopBilling, number>();
  for (const f of families) counts.set(f.billing, (counts.get(f.billing) ?? 0) + 1);
  let best: TopBilling | null = null;
  for (const [billing, n] of counts) if (best === null || n > (counts.get(best) as number)) best = billing;
  return best;
}

const BILLING_TAGS: Record<TopBilling, string> = {
  gateway: "gateway",
  "api-key": "API key",
  subscription: "subscription",
  unknown: "billing unknown",
  mixed: "mixed billing",
};

/**
 * Tags for a family in a ranked list: its billing when that differs from
 * the list's usual one, and "partly unpriced" when some tokens had no price.
 */
export function familyTags(family: Pick<TopFamily, "billing" | "headline">, usual: TopBilling | null): string[] {
  const tags: string[] = [];
  if (usual !== null && family.billing !== usual) tags.push(BILLING_TAGS[family.billing]);
  if (family.headline.unpricedNote !== null) tags.push("partly unpriced");
  return tags;
}

/** "3 threads" for a family with children, null for a root alone. */
export function familyThreads(family: Pick<TopFamily, "descendants">): string | null {
  return family.descendants > 0 ? `${formatCount(family.descendants + 1)} threads` : null;
}

/**
 * The parts of the context line under a family's title, in order: project,
 * thread count, last activity ("Alpha", "3 threads", "2 hours ago"). A part
 * that is missing is left out.
 */
export function familyContext(
  family: Pick<TopFamily, "descendants" | "lastActivityAt">,
  opts: { projectName: string | null; countThreads: boolean; now: number },
): string[] {
  return [
    opts.projectName,
    opts.countThreads ? familyThreads(family) : null,
    family.lastActivityAt === null ? null : formatAgo(Math.max(0, opts.now - family.lastActivityAt)),
  ].filter((part): part is string => part !== null && part !== "");
}

export interface Headline {
  /** The large figure: dollars, or tokens for an all-subscription figure. */
  primary: string;
  primaryKind: "usd" | "tokens";
  /** Source mix or billing label under the primary figure. */
  detail: string;
  /** Second line for a family that mixes billing modes. */
  secondary: string | null;
  /** "+ unpriced tokens" when any tokens had no price. */
  unpricedNote: string | null;
  /** The compact figure for the header chip. */
  chip: string;
  billing: BillingMode | "mixed";
}

function dominantBilling(f: Figure): BillingMode | "mixed" {
  const modes = (Object.keys(f.byBilling) as BillingMode[]).filter(
    (m) => f.byBilling[m].tokens > 0 || f.byBilling[m].usd > 0,
  );
  if (modes.length === 0) return "unknown";
  if (modes.length === 1) return modes[0] as BillingMode;
  return "mixed";
}

/**
 * The headline for a figure, by billing mode:
 * subscription leads with tokens and a list-price equivalent; gateway shows
 * dollars; api-key and unknown show dollars labelled estimate; a mix shows
 * billed dollars plus a subscription line.
 */
export function headline(f: Figure, currency = "$"): Headline {
  const billing = dominantBilling(f);
  const tokens = figureTokenCount(f);
  const usd = costTotal(f.cost);
  const unpricedNote = f.unpricedTokens > 0 ? `+ ${formatTokens(f.unpricedTokens)} unpriced tokens` : null;
  if (tokens === 0 && usd === 0) {
    return {
      primary: "—",
      primaryKind: "usd",
      detail: "No usage recorded",
      secondary: null,
      unpricedNote: null,
      chip: "—",
      billing,
    };
  }
  if (billing === "subscription") {
    return {
      primary: `${formatTokens(tokens)} tokens`,
      primaryKind: "tokens",
      detail: `${formatUsd(usd, currency)} list-price equivalent · subscription`,
      secondary: null,
      unpricedNote,
      chip: formatTokens(tokens),
      billing,
    };
  }
  const sub = f.byBilling.subscription;
  const billedUsd = usd - sub.usd;
  // The billed split is the whole split minus what the subscription part contributed.
  const billedCost: CostBuckets = {
    gateway: f.cost.gateway - sub.cost.gateway,
    harness: f.cost.harness - sub.cost.harness,
    estimate: f.cost.estimate - sub.cost.estimate,
  };
  const mix = sourceMix(billing === "mixed" ? billedCost : f.cost, currency);
  const labelFor: Record<string, string> = {
    gateway: "billed by the gateway",
    "api-key": "API key",
    unknown: "billing unknown",
    mixed: "mixed billing",
  };
  // "gateway · billed by the gateway" would say the same thing twice.
  const detail = [mix === "" || (billing === "gateway" && mix === "gateway") ? null : mix, labelFor[billing]].filter(Boolean).join(" · ");
  return {
    primary: formatUsd(billedUsd, currency),
    primaryKind: "usd",
    detail,
    secondary:
      billing === "mixed" && sub.tokens > 0
        ? `+ ${formatTokens(sub.tokens)} tokens on subscription (≈ ${formatUsd(sub.usd, currency)} list price)`
        : null,
    unpricedNote,
    chip: formatUsd(billedUsd, currency),
    billing,
  };
}

