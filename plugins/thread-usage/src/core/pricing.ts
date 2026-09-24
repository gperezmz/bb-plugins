/**
 * Price tables and cost arithmetic.
 *
 * Rates are USD per token, as in LiteLLM's price map. Precedence is: aliases
 * first, then price overrides from settings, then the gateway's price map,
 * then LiteLLM's public list (the fetched copy, or the bundled snapshot when
 * none was ever fetched), then models.dev.
 */
import { z } from "zod";
import type { Tokens } from "./tokens";

/** Per-token rates for one model. Absent rates are unknown, not zero. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  /** Long-context tiers: rates that replace the base once a request's prompt exceeds `above` tokens. */
  tiers?: PriceTier[];
}

export interface PriceTier {
  above: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** `snapshot` is the copy bundled with the plugin; `litellm` and `models.dev` are fetched public lists. */
export type PriceOrigin = "override" | "gateway" | "litellm" | "snapshot" | "models.dev";

export interface ResolvedPrice {
  /** The model name the price was found under. */
  model: string;
  origin: PriceOrigin;
  price: ModelPrice;
}

/** A LiteLLM price-map entry, as in the snapshot and in `/model/info`. */
export type LiteLlmPriceEntry = Partial<Record<string, number>>;

const TIER_THRESHOLDS = [200_000, 272_000] as const;

/** Converts one LiteLLM price-map entry, or returns null without input and output rates. */
export function fromLiteLlmEntry(entry: LiteLlmPriceEntry): ModelPrice | null {
  const num = (key: string) => {
    const value = entry[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
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
  const tiers: PriceTier[] = [];
  for (const above of TIER_THRESHOLDS) {
    const suffix = `_above_${above / 1000}k_tokens`;
    const tier: PriceTier = { above };
    const tInput = num(`input_cost_per_token${suffix}`);
    const tOutput = num(`output_cost_per_token${suffix}`);
    const tRead = num(`cache_read_input_token_cost${suffix}`);
    const tWrite = num(`cache_creation_input_token_cost${suffix}`);
    if (tInput !== undefined) tier.input = tInput;
    if (tOutput !== undefined) tier.output = tOutput;
    if (tRead !== undefined) tier.cacheRead = tRead;
    if (tWrite !== undefined) tier.cacheWrite = tWrite;
    if (Object.keys(tier).length > 1) tiers.push(tier);
  }
  if (tiers.length > 0) price.tiers = tiers;
  return price;
}

/** Settings value "Price overrides and aliases": rates per million tokens. */
export const priceOverridesSchema = z
  .object({
    aliases: z.record(z.string().min(1), z.string().min(1)).optional(),
    prices: z
      .record(
        z.string().min(1),
        z
          .object({
            input: z.number().nonnegative(),
            output: z.number().nonnegative(),
            cacheRead: z.number().nonnegative().optional(),
            cacheWrite: z.number().nonnegative().optional(),
            cacheWrite1h: z.number().nonnegative().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type PriceOverrides = z.infer<typeof priceOverridesSchema>;

export const EXAMPLE_OVERRIDES = `{
  "aliases": { "claude-opus-5": "claude-opus-5-5" },
  "prices": { "my-internal-model": { "input": 1, "output": 4 } }
}`;

/** Parses the overrides setting. Empty text is no overrides; bad JSON throws. */
export function parsePriceOverrides(text: string): PriceOverrides {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  return priceOverridesSchema.parse(JSON.parse(trimmed));
}

/** Validation message for the overrides setting, or null when valid. */
export function priceOverridesError(text: string): string | null {
  try {
    parsePriceOverrides(text);
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) return `Not valid JSON: ${error.message}`;
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return `${issue?.path.join(".") || "value"}: ${issue?.message ?? "invalid"}`;
    }
    return String(error);
  }
}

const PER_MTOK = 1_000_000;

function overrideToPrice(o: NonNullable<PriceOverrides["prices"]>[string]): ModelPrice {
  const price: ModelPrice = { input: o.input / PER_MTOK, output: o.output / PER_MTOK };
  if (o.cacheRead !== undefined) price.cacheRead = o.cacheRead / PER_MTOK;
  if (o.cacheWrite !== undefined) price.cacheWrite = o.cacheWrite / PER_MTOK;
  if (o.cacheWrite1h !== undefined) price.cacheWrite1h = o.cacheWrite1h / PER_MTOK;
  return price;
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
  /** LiteLLM's list: the fetched copy, or the bundled one. */
  snapshot: Record<string, LiteLlmPriceEntry>;
  /** Origin the `snapshot` layer reports; "snapshot" (bundled) when absent. */
  snapshotOrigin?: "litellm" | "snapshot";
  /** models.dev prices in LiteLLM's field names, for models the snapshot lacks. */
  modelsDev?: Record<string, LiteLlmPriceEntry>;
  gateway?: Record<string, ModelPrice> | null;
  overrides?: PriceOverrides;
}

/** Looks up prices with alias, override, gateway, LiteLLM and models.dev precedence. */
export class PriceBook {
  private readonly snapshot = new Map<string, ModelPrice>();
  private readonly modelsDev = new Map<string, ModelPrice>();
  private readonly snapshotOrigin: "litellm" | "snapshot";
  private readonly gateway = new Map<string, ModelPrice>();
  private readonly overrides = new Map<string, ModelPrice>();
  private readonly aliases = new Map<string, string>();
  private readonly cache = new Map<string, ResolvedPrice | null>();

  constructor(input: PriceBookInput) {
    this.snapshotOrigin = input.snapshotOrigin ?? "snapshot";
    for (const [name, entry] of Object.entries(input.snapshot)) {
      const price = fromLiteLlmEntry(entry);
      if (price !== null) this.snapshot.set(name.toLowerCase(), price);
    }
    for (const [name, entry] of Object.entries(input.modelsDev ?? {})) {
      const price = fromLiteLlmEntry(entry);
      if (price !== null) this.modelsDev.set(name.toLowerCase(), price);
    }
    for (const [name, price] of Object.entries(input.gateway ?? {})) {
      this.gateway.set(normalizeModelName(name), price);
    }
    for (const [from, to] of Object.entries(input.overrides?.aliases ?? {})) {
      this.aliases.set(normalizeModelName(from), normalizeModelName(to));
    }
    for (const [name, o] of Object.entries(input.overrides?.prices ?? {})) {
      this.overrides.set(normalizeModelName(name), overrideToPrice(o));
    }
  }

  /** The model an alias maps to, or the normalized name itself. */
  resolveAlias(model: string): string {
    let name = normalizeModelName(model);
    for (let hops = 0; hops < 8; hops++) {
      const next = this.aliases.get(name);
      if (next === undefined || next === name) break;
      name = next;
    }
    return name;
  }

  lookup(model: string | null | undefined): ResolvedPrice | null {
    if (model === null || model === undefined || model.trim() === "") return null;
    const key = normalizeModelName(model);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const aliased = this.resolveAlias(model);
    const names = candidateNames(aliased);
    let found: ResolvedPrice | null = null;
    const layers: [PriceOrigin, Map<string, ModelPrice>][] = [
      ["override", this.overrides],
      ["gateway", this.gateway],
      [this.snapshotOrigin, this.snapshot],
      ["models.dev", this.modelsDev],
    ];
    outer: for (const [origin, table] of layers) {
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

export interface CostResult {
  usd: number;
  /** True when a rate had to be approximated (missing cache rate, tier unknown). */
  approximate: boolean;
}

/**
 * Cost of `tokens` at `price`.
 *
 * `requestPromptTokens` is the prompt size of the single request these
 * tokens belong to. Tiers apply only when it is known (gateway or log rows);
 * a turn summed over several requests passes null and gets the base rate,
 * flagged approximate when the model has a tier.
 */
export function costOf(
  tokens: Tokens,
  price: ModelPrice,
  requestPromptTokens: number | null,
): CostResult {
  let approximate = false;
  let rates = {
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
  };
  const tiers = price.tiers ?? [];
  if (tiers.length > 0) {
    if (requestPromptTokens === null) {
      approximate = true;
    } else {
      // Whole-request switch: the highest tier the prompt exceeds.
      const tier = [...tiers]
        .sort((a, b) => b.above - a.above)
        .find((t) => requestPromptTokens > t.above);
      if (tier !== undefined) {
        rates = {
          input: tier.input ?? rates.input,
          output: tier.output ?? rates.output,
          cacheRead: tier.cacheRead ?? rates.cacheRead,
          cacheWrite: tier.cacheWrite ?? rates.cacheWrite,
        };
      }
    }
  }
  const readRate = rates.cacheRead ?? rates.input;
  if (tokens.cacheRead > 0 && rates.cacheRead === undefined) approximate = true;
  const writeRate = rates.cacheWrite ?? rates.input;
  if (tokens.cacheWrite > 0 && rates.cacheWrite === undefined) approximate = true;
  const oneHour = Math.min(tokens.cacheWrite1h, tokens.cacheWrite);
  const fiveMinute = tokens.cacheWrite - oneHour;
  let oneHourRate = price.cacheWrite1h;
  if (oneHour > 0 && oneHourRate === undefined) {
    oneHourRate = writeRate;
    approximate = true;
  }
  const usd =
    tokens.input * rates.input +
    tokens.output * rates.output +
    tokens.cacheRead * readRate +
    fiveMinute * writeRate +
    oneHour * (oneHourRate ?? writeRate);
  return { usd, approximate };
}

/** Parses LiteLLM `/model/info` into a price map keyed by public and upstream model names. */
export function gatewayPricesFromModelInfo(body: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const record = item as {
      model_name?: unknown;
      litellm_params?: { model?: unknown } | null;
      model_info?: LiteLlmPriceEntry | null;
    };
    const info = record.model_info;
    if (info === null || info === undefined || typeof info !== "object") continue;
    const price = fromLiteLlmEntry(info);
    if (price === null) continue;
    if (typeof record.model_name === "string") out[record.model_name] = price;
    const upstream = record.litellm_params?.model;
    if (typeof upstream === "string" && !(upstream in out)) out[upstream] = price;
  }
  return out;
}
