/**
 * Number formatting and headline wording shared by the panel, the header
 * chip, the CLI and the agent tool, so every surface says the same thing.
 */
import type { BillingMode } from "./billing";
import { allTokensUnpriced, costTotal, figureTokenCount } from "./figure-math";
import type { PriceSourceInfo, PricesInfo, TopTree, TopTrees } from "./report-types";
import type { Figure, TierDetail } from "./summary";

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
 * The line under the figures saying where the prices behind estimates come
 * from and how fresh they are. Plain when they are more than a week old, were
 * never fetched, or the last refresh failed.
 */
export function pricesLabel(prices: PricesInfo, now: number): string {
  const failed = prices.lastError === null ? "" : `. The last refresh failed: ${prices.lastError}`;
  if (prices.updatedAt !== null) {
    const ago = formatAgo(now - prices.updatedAt);
    return pricesStale(prices.updatedAt, now)
      ? `Estimated with models.dev prices, fetched ${ago}. They are more than a week old and may be out of date${failed}`
      : `Estimated with models.dev prices, fetched ${ago}${failed}`;
  }
  const bundled = `the models.dev list bundled with the plugin${prices.bundledDate === null ? "" : ` (${prices.bundledDate.slice(0, 10)})`}`;
  if (!prices.refreshOn) return `Estimated with ${bundled}. Online updates are off, so prices may be out of date`;
  return `Estimated with ${bundled}; it has not been fetched yet, so prices may be out of date${failed}`;
}

/** Tooltip for one By-model row: where its price came from and when that list was fetched. */
export function priceSourceLabel(info: PriceSourceInfo | undefined, now: number): string {
  if (info === undefined) return "No models.dev price for this model";
  const names: Record<PriceSourceInfo["source"], string> = {
    "models.dev": "models.dev list",
    snapshot: "models.dev list bundled with the plugin",
  };
  const fetched = info.fetchedAt === null ? "" : `, fetched ${formatAgo(now - info.fetchedAt)}`;
  return `${names[info.source]}${fetched}, as ${info.as}`;
}

/** Short name of where a model's price came from, for the By-model table. */
export function priceSourceName(info: PriceSourceInfo | undefined): string {
  if (info === undefined) return "unpriced";
  return info.source === "snapshot" ? "models.dev, bundled" : "models.dev";
}

/** The mark on a request charged at a tier: "tier over 100,000". */
export function tierMark(above: number): string {
  return `tier over ${formatCount(above)}`;
}

/** What the mark means, as its hover and focus hint says it. */
export function tierHint(above: number): string {
  return `A prompt over ${formatCount(above)} tokens is charged at that tier's rates for the whole request, output included.`;
}

/**
 * How many of an opened turn's requests used a tier, e.g. "1 of 2 requests
 * used the tier over 100,000 tokens"; requests that crossed different sizes
 * are counted together.
 */
export function tierSummary(detail: TierDetail): string {
  const sizes = [...new Set(detail.tiered.map((r) => r.tierAbove))];
  const used = sizes.length === 1 ? `the tier over ${formatCount(sizes[0] as number)} tokens` : "a tier";
  return `${formatCount(detail.tiered.length)} of ${formatCount(detail.requests)} requests used ${used}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

type TopBilling = TopTree["billing"];

/** The billing most trees in a ranked list share, or null for an empty list. */
export function usualBilling(trees: readonly Pick<TopTree, "billing">[]): TopBilling | null {
  const counts = new Map<TopBilling, number>();
  for (const f of trees) counts.set(f.billing, (counts.get(f.billing) ?? 0) + 1);
  let best: TopBilling | null = null;
  for (const [billing, n] of counts) if (best === null || n > (counts.get(best) as number)) best = billing;
  return best;
}

const BILLING_TAGS: Record<TopBilling, string> = {
  "api-key": "API key",
  subscription: "subscription",
  unknown: "billing unknown",
  mixed: "mixed billing",
};

/**
 * Tags for a tree in a ranked list: its billing when that differs from
 * the list's usual one, and "partly unpriced" when some tokens had no price.
 */
export function treeTags(tree: Pick<TopTree, "billing" | "headline">, usual: TopBilling | null): string[] {
  const tags: string[] = [];
  if (usual !== null && tree.billing !== usual) tags.push(BILLING_TAGS[tree.billing]);
  if (tree.headline.unpricedNote !== null) tags.push("partly unpriced");
  return tags;
}

/** "3 threads" for a tree with children, null for a root alone. */
export function treeThreads(tree: Pick<TopTree, "descendants">): string | null {
  return tree.descendants > 0 ? `${formatCount(tree.descendants + 1)} threads` : null;
}

/**
 * The parts of the context line under a tree's title, in order: project,
 * thread count, last activity ("Alpha", "3 threads", "2 hours ago"). A part
 * that is missing is left out.
 */
export function treeContext(
  tree: Pick<TopTree, "descendants" | "lastActivityAt">,
  opts: { projectName: string | null; countThreads: boolean; now: number },
): string[] {
  return [
    opts.projectName,
    opts.countThreads ? treeThreads(tree) : null,
    tree.lastActivityAt === null ? null : formatAgo(Math.max(0, opts.now - tree.lastActivityAt)),
  ].filter((part): part is string => part !== null && part !== "");
}

/**
 * `bb thread-usage top` as text: the trees ranked by dollars, then, apart
 * and headed Not priced, the trees whose tokens have no price, each list
 * ranked from 1.
 */
export function topText(
  top: TopTrees,
  opts: { currency: string; projectName: (projectId: string | null) => string | null; now: number },
): string {
  const line = (f: TopTree, rank: number, figure: string, tags: string[]) => {
    // The first line already carries the amount, tokens and thread count.
    const context = treeContext(f, { projectName: opts.projectName(f.projectId), countThreads: false, now: opts.now });
    const second = [...context, ...tags].join(" · ");
    const threads = treeThreads(f);
    return `${String(rank).padStart(2)}. ${figure} ${f.title.slice(0, 60)}  (${f.threadId}${threads === null ? "" : `, ${threads}`})${second === "" ? "" : `\n      ${second}`}`;
  };
  const usual = usualBilling(top.priced);
  const priced = top.priced.map((f, i) =>
    line(f, i + 1, `${formatUsd(f.usd, opts.currency).padEnd(9)} ${formatTokens(f.tokens).padStart(6)} tokens `, treeTags(f, usual)),
  );
  const notPriced = top.notPriced.map((f, i) =>
    line(f, i + 1, `${formatTokens(f.tokens).padStart(6)} tokens `, ["not priced"]),
  );
  const blocks = [
    ...(priced.length > 0 ? [priced.join("\n")] : []),
    ...(notPriced.length > 0 ? [`Not priced\n${notPriced.join("\n")}`] : []),
  ];
  return blocks.length === 0 ? "No thread trees with usage in that window." : blocks.join("\n\n");
}

export interface Headline {
  /** The large figure: dollars, or tokens for a subscription or a figure with no priced token. */
  primary: string;
  primaryKind: "usd" | "tokens";
  /** Estimate and billing label under the primary figure. */
  detail: string;
  /** Second line for a tree that mixes billing modes. */
  secondary: string | null;
  /** "+ unpriced tokens" when some tokens had no price. */
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
 * The headline for a figure, by billing mode: subscription leads with tokens
 * and a list-price equivalent; api-key and unknown show dollars labelled
 * estimate; a mix shows billed dollars plus a subscription line. A figure
 * with tokens and no priced token leads with the token count, whatever the
 * billing, and says they are not priced; a figure with no tokens is a dash.
 */
export function headline(f: Figure, currency = "$"): Headline {
  const billing = dominantBilling(f);
  const tokens = figureTokenCount(f);
  const usd = costTotal(f.cost);
  const unpricedNote = f.unpricedTokens > 0 ? `+ ${formatTokens(f.unpricedTokens)} unpriced tokens` : null;
  if (tokens === 0) {
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
  if (allTokensUnpriced(f)) {
    return {
      primary: `${formatTokens(tokens)} tokens`,
      primaryKind: "tokens",
      detail: "The tokens are not priced",
      secondary: null,
      unpricedNote: null,
      chip: formatTokens(tokens),
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
  const labelFor: Record<string, string> = {
    "api-key": "API key",
    unknown: "billing unknown",
    mixed: "mixed billing",
  };
  const detail = [billedUsd > 0 ? "estimate" : null, labelFor[billing]].filter(Boolean).join(" · ");
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
