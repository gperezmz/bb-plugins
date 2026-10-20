/**
 * Reads models.dev's `api.json` (providers → models, USD per million tokens)
 * into the plugin's per-token prices, keyed by model id. Pure: the server
 * fetches the document, and `scripts/update-prices.mjs` runs the same code to
 * make the bundled copy.
 */
import type { ModelPrice, PriceTier } from "./pricing";

export const MODELS_DEV_URL = "https://models.dev/api.json";

// Model makers whose own price wins when several providers list the same model id.
const FIRST_PARTY = ["anthropic", "openai", "google", "xai", "mistral", "deepseek", "alibaba", "moonshotai", "zhipuai", "minimax", "meta", "cohere", "zai"];
const PER_MTOK = 1_000_000;

type Rates = Record<string, unknown>;

function perToken(source: Rates, key: string): number | undefined {
  const v = source[key];
  // 12 significant digits drop the binary noise of the division (0.1 / 1e6) and keep every published digit.
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Number((v / PER_MTOK).toPrecision(12)) : undefined;
}

/**
 * The context tiers of a model's `cost.tiers`: the entries whose type is
 * context, at whatever size models.dev publishes. A tier of another type is
 * not a context tier and its rates are never used.
 */
function contextTiers(cost: Rates): PriceTier[] {
  const listed = cost.tiers;
  if (!Array.isArray(listed)) return [];
  const tiers: PriceTier[] = [];
  for (const entry of listed) {
    if (entry === null || typeof entry !== "object") continue;
    const rates = entry as Rates;
    const where = rates.tier;
    if (where === null || typeof where !== "object") continue;
    const { type, size } = where as { type?: unknown; size?: unknown };
    if (type !== "context" || typeof size !== "number" || !Number.isFinite(size) || size <= 0) continue;
    const tier: PriceTier = { above: size };
    const input = perToken(rates, "input");
    const output = perToken(rates, "output");
    const cacheRead = perToken(rates, "cache_read");
    const cacheWrite = perToken(rates, "cache_write");
    if (input !== undefined) tier.input = input;
    if (output !== undefined) tier.output = output;
    if (cacheRead !== undefined) tier.cacheRead = cacheRead;
    if (cacheWrite !== undefined) tier.cacheWrite = cacheWrite;
    if (Object.keys(tier).length > 1) tiers.push(tier);
  }
  return tiers.sort((a, b) => a.above - b.above);
}

/**
 * Where several providers list an id, the maker's own price wins; otherwise
 * the median of the others, since a reseller's or a free tier's price is not
 * the model's. Entries priced at 0 for both input and output are skipped, so
 * a model with no real price stays unpriced. A figure is kept as published.
 */
export function trimModelsDev(raw: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  if (raw === null || typeof raw !== "object") return out;
  const candidates = new Map<string, { price: ModelPrice; firstParty: boolean }[]>();
  for (const [providerId, provider] of Object.entries(raw as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    const models = (provider as { models?: unknown } | null)?.models;
    if (models === null || models === undefined || typeof models !== "object") continue;
    for (const [id, model] of Object.entries(models as Record<string, unknown>)) {
      const cost = (model as { cost?: Rates } | null)?.cost;
      if (cost === null || cost === undefined || typeof cost !== "object") continue;
      const input = perToken(cost, "input");
      const output = perToken(cost, "output");
      if (input === undefined || output === undefined || input + output === 0) continue;
      const price: ModelPrice = { input, output };
      const cacheRead = perToken(cost, "cache_read");
      const cacheWrite = perToken(cost, "cache_write");
      if (cacheRead !== undefined) price.cacheRead = cacheRead;
      if (cacheWrite !== undefined) price.cacheWrite = cacheWrite;
      if (providerId === "anthropic" || /(^|[/.])claude/i.test(id)) price.claude = true;
      const tiers = contextTiers(cost);
      if (tiers.length > 0) price.tiers = tiers;
      const name = id.toLowerCase();
      const bare = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : null;
      const firstParty = FIRST_PARTY.includes(providerId);
      for (const key of bare === null ? [name] : [name, bare]) {
        const list = candidates.get(key) ?? [];
        list.push({ price, firstParty });
        candidates.set(key, list);
      }
    }
  }
  for (const [key, list] of candidates) {
    const makers = list.filter((c) => c.firstParty);
    const pool = makers.length > 0 ? makers : list;
    const total = (c: { price: ModelPrice }) => c.price.input + c.price.output;
    const sorted = [...pool].sort((a, b) => total(a) - total(b));
    out[key] = (sorted[Math.floor((sorted.length - 1) / 2)] as { price: ModelPrice }).price;
  }
  return out;
}
