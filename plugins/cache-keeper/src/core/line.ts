/**
 * The compaction line: the smallest context at which the first message back
 * repays compacting N times over.
 *
 * Compacting costs one warm read of the context plus a summary written as
 * output: r·C + o·S. Coming back without it costs a cold rewrite of the whole
 * context and k reads of it, where a compacted thread rewrites and reads only
 * P: the difference is (w + k·r)·(C − P). The line is the smallest C with
 * (w + k·r)·(C − P) ≥ N·(r·C + o·S).
 */
import type { ModelPrice } from "./pricing";

export type CacheLifetime = "5m" | "1h";

export const SETTINGS_MIN = 1;
export const SETTINGS_MAX = 10;
export const DEFAULT_SETTING = 2;
/** Summary size, in tokens. */
export const SUMMARY_TOKENS = 20_000;
/** Context after compaction for a thread never compacted, in tokens. */
export const DEFAULT_POST_COMPACTION = 40_000;
/** Requests per user message for a thread with no user message yet. */
export const DEFAULT_CALLS_PER_MESSAGE = 3;

/** The rates the line rests on, USD per token. */
export interface Rates {
  /** Cache write at the thread's cache lifetime. */
  w: number;
  /** Cache read. */
  r: number;
  /** Output. */
  o: number;
}

/**
 * The rates of a model at a cache lifetime. A rate the price list leaves out
 * is taken at Anthropic's multiple of the input price: 1.25× for a 5-minute
 * write, 2× for a 1-hour one, 0.1× for a read.
 */
export function ratesOf(price: ModelPrice, lifetime: CacheLifetime): Rates {
  const w = lifetime === "5m" ? (price.cacheWrite ?? 1.25 * price.input) : (price.cacheWrite1h ?? 2 * price.input);
  return { w, r: price.cacheRead ?? 0.1 * price.input, o: price.output };
}

export interface LineInput {
  rates: Rates;
  /** Mean model requests per user message. */
  k: number;
  /** Context after the last compaction, tokens. */
  p: number;
  /** The setting, 1–10. */
  n: number;
  /** The model's context window, tokens; the line is "never" above it. */
  window: number;
}

/** The compaction line in tokens, or null for "never". */
export function compactionLine({ rates, k, p, n, window }: LineInput): number | null {
  if (!Number.isInteger(n) || n < SETTINGS_MIN || n > SETTINGS_MAX) throw new RangeError(`setting must be 1–10, got ${n}`);
  const { w, r, o } = rates;
  const gain = w + k * r;
  const slope = gain - n * r;
  if (slope <= 0) return null;
  const exact = (gain * p + n * o * SUMMARY_TOKENS) / slope;
  // Rounding error can leave ceil one token short of the inequality.
  let c = Math.max(0, Math.ceil(exact - 1e-6));
  if (gain * (c - p) < n * (r * c + o * SUMMARY_TOKENS)) c += 1;
  return c > window ? null : c;
}

/** The line for every setting, index 0 holding setting 1. */
export function linesFor(input: Omit<LineInput, "n">): (number | null)[] {
  const out: (number | null)[] = [];
  for (let n = SETTINGS_MIN; n <= SETTINGS_MAX; n++) out.push(compactionLine({ ...input, n }));
  return out;
}

/**
 * The setting whose line is nearest to `size`. Settings with no line are
 * chosen only when none has one; ties go to the lower setting.
 */
export function snapSetting(size: number, lines: readonly (number | null)[]): number {
  let best: number | null = null;
  let bestGap = Infinity;
  lines.forEach((line, i) => {
    if (line === null) return;
    const gap = Math.abs(line - size);
    if (gap < bestGap) {
      bestGap = gap;
      best = i + SETTINGS_MIN;
    }
  });
  return best ?? SETTINGS_MIN;
}

/**
 * Parses a size typed as tokens: `500k`, `0.5m`, `1.2M`, `140000`, `140 000`.
 * Returns null for anything else.
 */
export function parseSize(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([km])?\s*$/i.exec(text.replace(/(\d)[\s_](?=\d)/g, "$1"));
  if (m === null) return null;
  const value = Number(m[1]!.replace(",", "."));
  const unit = m[2]?.toLowerCase();
  const tokens = unit === "k" ? value * 1_000 : unit === "m" ? value * 1_000_000 : value;
  return Number.isFinite(tokens) ? Math.round(tokens) : null;
}

/** A token count to the nearest thousand: `140k`, `1.2M`; the line's display form. */
export function formatSize(tokens: number | null): string {
  if (tokens === null) return "never";
  const k = Math.round(tokens / 1_000);
  if (k >= 1_000) {
    const m = k / 1_000;
    return `${Number.isInteger(m) ? m : m.toFixed(m >= 10 ? 1 : 2).replace(/0+$/, "")}M`;
  }
  return `${k}k`;
}

/** The dollar figures behind a line, at a given context. */
export interface LineWhy {
  /** Estimated cost of compacting now: r·C + o·S. */
  compactUsd: number;
  /** What the first message back would cost without compacting beyond with it: (w + k·r)·(C − P). */
  savedUsd: number;
  /** Cold rewrite of the whole context: w·C. */
  coldRewriteUsd: number;
}

export function lineWhy(rates: Rates, k: number, p: number, context: number): LineWhy {
  return {
    compactUsd: rates.r * context + rates.o * SUMMARY_TOKENS,
    savedUsd: Math.max(0, (rates.w + k * rates.r) * (context - p)),
    coldRewriteUsd: rates.w * context,
  };
}
