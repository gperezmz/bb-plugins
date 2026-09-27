/**
 * Model prices, copied from Thread Usage's `src/core/pricing.ts` and trimmed
 * to the public lists: Cache Keeper has no gateway and no overrides.
 *
 * Rates are USD per token, as in LiteLLM's price map. Lookup order is
 * LiteLLM's fetched list, then models.dev, then the LiteLLM list bundled with
 * the plugin.
 */

/** Per-token rates for one model. Absent rates are unknown, not zero. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
}

/** `bundled` is the copy shipped with the plugin; the others are fetched. */
export type PriceOrigin = "litellm" | "models.dev" | "bundled";

export interface ResolvedPrice {
  /** The model name the price was found under. */
  model: string;
  origin: PriceOrigin;
  price: ModelPrice;
}

/** A LiteLLM price-map entry. */
export type LiteLlmPriceEntry = Partial<Record<string, number>>;

/** Converts one LiteLLM price-map entry, or returns null without input and output rates. */
export function fromLiteLlmEntry(entry: LiteLlmPriceEntry): ModelPrice | null {
  const num = (key: string) => {
    const value = entry[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const input = num("input_cost_per_token");
  const output = num("output_cost_per_token");
  if (input === undefined || output === undefined) return null;
  const price: ModelPrice = { input, output };
  const cacheRead = num("cache_read_input_token_cost");
  const cacheWrite = num("cache_creation_input_token_cost");
  const cacheWrite1h = num("cache_creation_input_token_cost_above_1hr");
  if (cacheRead !== undefined) price.cacheRead = cacheRead;
  if (cacheWrite !== undefined) price.cacheWrite = cacheWrite;
  if (cacheWrite1h !== undefined) price.cacheWrite1h = cacheWrite1h;
  return price;
}

/** Strips `[1m]`-style suffixes, whitespace and case. */
export function normalizeModelName(model: string): string {
  return model.replace(/\[[^\]]*\]/g, "").trim().toLowerCase();
}

const PROVIDER_PREFIXES = ["anthropic/", "vertex_ai/", "vertex_ai_beta/", "bedrock/", "azure_ai/", "openrouter/", "litellm_proxy/"];

/**
 * Candidate names to look a model up under, most specific first: the name
 * itself, without a provider prefix, with a Vertex `@date` turned into a
 * `-date`, and without a trailing `-YYYYMMDD` date.
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
  /** LiteLLM's fetched list; absent while fetching is off or before the first fetch. */
  litellm?: Record<string, LiteLlmPriceEntry> | null;
  /** models.dev in LiteLLM's field names; absent likewise. */
  modelsDev?: Record<string, LiteLlmPriceEntry> | null;
  /** The LiteLLM list bundled with the plugin. */
  bundled: Record<string, LiteLlmPriceEntry>;
}

/** Looks up prices in LiteLLM's list, then models.dev, then the bundled list. */
export class PriceBook {
  private readonly layers: [PriceOrigin, Map<string, ModelPrice>][];
  private readonly cache = new Map<string, ResolvedPrice | null>();

  constructor(input: PriceBookInput) {
    const table = (entries: Record<string, LiteLlmPriceEntry> | null | undefined) => {
      const map = new Map<string, ModelPrice>();
      for (const [name, entry] of Object.entries(entries ?? {})) {
        const price = fromLiteLlmEntry(entry);
        if (price !== null) map.set(name.toLowerCase(), price);
      }
      return map;
    };
    this.layers = [
      ["litellm", table(input.litellm)],
      ["models.dev", table(input.modelsDev)],
      ["bundled", table(input.bundled)],
    ];
  }

  lookup(model: string | null | undefined): ResolvedPrice | null {
    if (model === null || model === undefined || model.trim() === "") return null;
    const key = normalizeModelName(model);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let found: ResolvedPrice | null = null;
    const names = candidateNames(model);
    outer: for (const [origin, table] of this.layers) {
      for (const name of names) {
        const price = table.get(name);
        if (price !== undefined) {
          found = { model: name, origin, price };
          break outer;
        }
      }
    }
    this.cache.set(key, found);
    return found;
  }
}
