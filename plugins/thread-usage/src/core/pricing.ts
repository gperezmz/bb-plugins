/**
 * Price lookup and request costing.
 *
 * Every price comes from models.dev, as published: the fetched copy, or the
 * copy bundled with the plugin until one was fetched. Rates are USD per
 * token. A request is priced on its own, by the tier its prompt is over.
 */
import { promptTokens, type Tokens } from "./tokens";

/** Per-token rates for one model. Absent rates are unknown, not zero. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  /** The 5-minute cache-write rate: the one models.dev publishes. */
  cacheWrite?: number;
  /** A Claude model: its 1-hour cache writes cost twice the input rate. */
  claude?: true;
  /** Context tiers: rates that replace the base once a request's prompt is over `above` tokens. */
  tiers?: PriceTier[];
}

/** The rates a tier sets; a kind it omits keeps the base rate. */
export interface PriceTier {
  above: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** `models.dev` is the fetched list, `snapshot` the copy bundled with the plugin. */
export type PriceOrigin = "models.dev" | "snapshot";

export interface ResolvedPrice {
  /** The model name the price was found under. */
  model: string;
  origin: PriceOrigin;
  price: ModelPrice;
}

/** Strips `[1m]`-style suffixes, whitespace and case. */
export function normalizeModelName(model: string): string {
  return model.replace(/\[[^\]]*\]/g, "").trim().toLowerCase();
}

const PROVIDER_PREFIXES = [
  "anthropic/",
  "openai/",
  "vertex_ai/",
  "vertex_ai_beta/",
  "bedrock/",
  "azure/",
  "azure_ai/",
  "gemini/",
  "openrouter/",
  "litellm_proxy/",
];

/**
 * Candidate names to look a model up under, most specific first: the name
 * itself, without a provider prefix, its last slash-separated segment, with
 * a Vertex `@date` turned into a `-date`, and each of those without a
 * trailing `-YYYYMMDD` date.
 */
export function candidateNames(model: string): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (name !== "" && !out.includes(name)) out.push(name);
  };
  const base = normalizeModelName(model);
  push(base);
  let bare = base;
  for (let changed = true; changed; ) {
    changed = false;
    for (const prefix of PROVIDER_PREFIXES) {
      if (bare.startsWith(prefix)) {
        bare = bare.slice(prefix.length);
        changed = true;
      }
    }
  }
  // openrouter/<vendor>/<model> and similar leave a vendor segment.
  const lastSegment = bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare;
  for (const name of [bare, lastSegment]) {
    push(name);
    const atDate = name.replace(/@(\d{8})$/, "-$1");
    push(atDate);
    push(name.replace(/@[^@]*$/, ""));
    push(atDate.replace(/-\d{8}$/, ""));
  }
  return out;
}

export interface PriceBookInput {
  /** models.dev's prices by model id, lower case. */
  models: Record<string, ModelPrice>;
  /** Which copy `models` is. */
  origin: PriceOrigin;
}

/** Looks a model up in one models.dev list. */
export class PriceBook {
  private readonly models = new Map<string, ModelPrice>();
  private readonly origin: PriceOrigin;
  private readonly cache = new Map<string, ResolvedPrice | null>();

  constructor(input: PriceBookInput) {
    this.origin = input.origin;
    for (const [name, price] of Object.entries(input.models)) this.models.set(name.toLowerCase(), price);
  }

  lookup(model: string | null | undefined): ResolvedPrice | null {
    if (model === null || model === undefined || model.trim() === "") return null;
    const key = normalizeModelName(model);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let found: ResolvedPrice | null = null;
    for (const name of candidateNames(key)) {
      const price = this.models.get(name);
      if (price !== undefined) {
        found = { model: name, origin: this.origin, price };
        break;
      }
    }
    this.cache.set(key, found);
    return found;
  }
}

/** The rates a request is charged at. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
}

/**
 * The rates for a request whose prompt is `prompt` tokens: the base, with
 * every kind the tier sets replaced. The tier is the one with the highest
 * size the prompt is over; with no prompt size, no tier applies.
 */
export function ratesFor(price: ModelPrice, prompt: number | null): { rates: Rates; tier: PriceTier | null } {
  const base: Rates = {
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
  };
  const tier =
    prompt === null
      ? null
      : ([...(price.tiers ?? [])].sort((a, b) => b.above - a.above).find((t) => prompt > t.above) ?? null);
  if (tier === null) return { rates: base, tier: null };
  return {
    tier,
    rates: {
      input: tier.input ?? base.input,
      output: tier.output ?? base.output,
      cacheRead: tier.cacheRead ?? base.cacheRead,
      cacheWrite: tier.cacheWrite ?? base.cacheWrite,
    },
  };
}

export interface CostResult {
  usd: number;
  /** Any rate had to be assumed: `unsized` or `assumed`. */
  approximate: boolean;
  /** The model has a tier and the prompt size is unknown, so the base rates were used. */
  unsized: boolean;
  /** A cache rate models.dev does not publish, or a 1-hour write rate it cannot give, was assumed. */
  assumed: boolean;
  /** Size of the tier the request was charged at, or null at the base rates. */
  tierAbove: number | null;
  rates: Rates;
}

/**
 * Cost of `tokens` at `price`.
 *
 * `prompt` is the prompt size of the single request these tokens belong to,
 * or null for tokens summed over requests whose sizes are not known, which
 * get the base rates. A 1-hour cache write of a Claude model costs twice the
 * input rate of the tier in effect; any other model's, the cache-write rate
 * of that tier, which is an assumption.
 */
export function costOf(tokens: Tokens, price: ModelPrice, prompt: number | null): CostResult {
  const { rates, tier } = ratesFor(price, prompt);
  const unsized = prompt === null && (price.tiers?.length ?? 0) > 0;
  let assumed = false;
  const readRate = rates.cacheRead ?? rates.input;
  if (tokens.cacheRead > 0 && rates.cacheRead === undefined) assumed = true;
  const writeRate = rates.cacheWrite ?? rates.input;
  if (tokens.cacheWrite > 0 && rates.cacheWrite === undefined) assumed = true;
  const oneHour = Math.min(tokens.cacheWrite1h, tokens.cacheWrite);
  const fiveMinute = tokens.cacheWrite - oneHour;
  let oneHourRate = writeRate;
  if (oneHour > 0) {
    if (price.claude === true) oneHourRate = 2 * rates.input;
    else assumed = true;
  }
  const usd =
    tokens.input * rates.input +
    tokens.output * rates.output +
    tokens.cacheRead * readRate +
    fiveMinute * writeRate +
    oneHour * oneHourRate;
  return { usd, approximate: unsized || assumed, unsized, assumed, tierAbove: tier?.above ?? null, rates };
}

/** One priced request of a turn, numbered in the order the requests were made. */
export interface PricedRequest {
  number: number;
  /** Uncached input plus cache reads and writes. */
  prompt: number;
  usd: number;
  /** Size of the tier it was charged at, or null at the base rates. */
  tierAbove: number | null;
}

export interface RequestsCost {
  usd: number;
  approximate: boolean;
  assumed: boolean;
  requests: PricedRequest[];
  /** The 1-hour cache writes no request carries, priced as a line of their own; null when there are none. */
  oneHour: { tokens: number; usd: number } | null;
}

/**
 * Cost of a turn's requests, each priced on its own prompt size.
 *
 * `unmatchedOneHour` is the part of the turn's cache writes known only as a
 * turn-level share, which no request can be matched to: those tokens leave
 * every request's 5-minute writes in proportion and are priced as one line.
 * Their rate is twice the highest input rate any request was charged at (a
 * Claude model), and the line is approximate where the requests were not all
 * charged one rate. For any other model it is the highest cache-write rate,
 * and always approximate.
 */
export function priceRequests(
  requests: readonly Tokens[],
  price: ModelPrice,
  unmatchedOneHour: number,
): RequestsCost {
  const totalWrites = requests.reduce((n, r) => n + r.cacheWrite, 0);
  const oneHour = Math.min(unmatchedOneHour, totalWrites);
  const keep = oneHour > 0 ? 1 - oneHour / totalWrites : 1;
  const priced: PricedRequest[] = [];
  const inputRates = new Set<number>();
  const writeRates = new Set<number>();
  let usd = 0;
  let assumed = false;
  requests.forEach((r, i) => {
    const prompt = promptTokens(r);
    const cost = costOf({ ...r, cacheWrite: r.cacheWrite * keep }, price, prompt);
    priced.push({ number: i + 1, prompt, usd: cost.usd, tierAbove: cost.tierAbove });
    inputRates.add(cost.rates.input);
    writeRates.add(cost.rates.cacheWrite ?? cost.rates.input);
    usd += cost.usd;
    assumed ||= cost.assumed;
  });
  let line: RequestsCost["oneHour"] = null;
  if (oneHour > 0) {
    const claude = price.claude === true;
    const rate = claude ? 2 * Math.max(...inputRates) : Math.max(...writeRates);
    line = { tokens: oneHour, usd: oneHour * rate };
    usd += line.usd;
    assumed ||= !claude || inputRates.size > 1;
  }
  return { usd, approximate: assumed, assumed, requests: priced, oneHour: line };
}
