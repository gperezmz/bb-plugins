/**
 * Public price lists fetched at runtime: LiteLLM's
 * `model_prices_and_context_window.json` and models.dev's `api.json`. A copy
 * is stored with its fetch time and replaced only by a later successful
 * fetch; a failure keeps the last good copy.
 */
import type { LiteLlmPriceEntry } from "../core/pricing";
import { LITELLM_PRICES_URL, trimPriceMap } from "./snapshot";

export const MODELS_DEV_URL = "https://models.dev/api.json";

/** Fetched copies are replaced after this long. */
export const REFRESH_AFTER_MS = 24 * 3_600_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_MODELS = 100;
/** Bump when `trimPriceMap` or `trimModelsDev` change what they keep, so stored copies are refetched. */
const TRIM_VERSION = 2;

export const LITELLM_META = "onlinePrices";
export const MODELS_DEV_META = "modelsDevPrices";
export const REFRESH_ERROR_META = "pricesRefreshError";
const DEFAULT_FLIP_META = "refreshPricesDefaultOn";

/** A public list as stored: LiteLLM's field names, whichever list it came from. */
export interface FetchedPrices {
  /** `TRIM_VERSION` when stored; a copy trimmed under older rules is fetched again. */
  trim?: number;
  source: string;
  fetchedAt: string;
  fetchedAtMs: number;
  models: Record<string, LiteLlmPriceEntry>;
}

export interface MetaStore {
  getMeta<T>(key: string): T | null;
  setMeta(key: string, value: unknown): void;
}

// Model makers whose own price wins when several providers list the same model id.
const FIRST_PARTY = ["anthropic", "openai", "google", "xai", "mistral", "deepseek", "alibaba", "moonshotai", "zhipuai", "minimax", "meta", "cohere", "zai"];
const PER_MTOK = 1_000_000;

/**
 * Maps models.dev's `api.json` (providers → models, USD per million tokens)
 * to LiteLLM's field names, keyed by model id. Where several providers list
 * an id, the maker's own price wins; otherwise the median of the others,
 * since a reseller's or a free tier's price is not the model's. Entries
 * priced at 0 for both input and output are skipped, so a model with no
 * real price stays unpriced. Anthropic's published 1-hour cache-write price
 * is 2 × input, which models.dev does not carry, so Claude models get it
 * derived.
 */
export function trimModelsDev(raw: unknown): Record<string, LiteLlmPriceEntry> {
  const out: Record<string, LiteLlmPriceEntry> = {};
  if (raw === null || typeof raw !== "object") return out;
  const candidates = new Map<string, { entry: LiteLlmPriceEntry; firstParty: boolean }[]>();
  for (const [providerId, provider] of Object.entries(raw as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    const models = (provider as { models?: unknown } | null)?.models;
    if (models === null || models === undefined || typeof models !== "object") continue;
    for (const [id, model] of Object.entries(models as Record<string, unknown>)) {
      const cost = (model as { cost?: Record<string, unknown> } | null)?.cost;
      if (cost === null || cost === undefined || typeof cost !== "object") continue;
      const perMtok = (source: Record<string, unknown>, key: string) => {
        const v = source[key];
        return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v / PER_MTOK : undefined;
      };
      const input = perMtok(cost, "input");
      const output = perMtok(cost, "output");
      if (input === undefined || output === undefined || input + output === 0) continue;
      const entry: LiteLlmPriceEntry = { input_cost_per_token: input, output_cost_per_token: output };
      const cacheRead = perMtok(cost, "cache_read");
      const cacheWrite = perMtok(cost, "cache_write");
      if (cacheRead !== undefined) entry.cache_read_input_token_cost = cacheRead;
      if (cacheWrite !== undefined) entry.cache_creation_input_token_cost = cacheWrite;
      if (providerId === "anthropic" || /(^|[/.])claude/i.test(id)) {
        entry.cache_creation_input_token_cost_above_1hr = 2 * input;
      }
      // Long-context rates, in the field names the price book reads for its 200k tier.
      const over200k = cost.context_over_200k;
      if (over200k !== null && typeof over200k === "object") {
        const tier = over200k as Record<string, unknown>;
        for (const [from, to] of [
          ["input", "input_cost_per_token_above_200k_tokens"],
          ["output", "output_cost_per_token_above_200k_tokens"],
          ["cache_read", "cache_read_input_token_cost_above_200k_tokens"],
          ["cache_write", "cache_creation_input_token_cost_above_200k_tokens"],
        ] as const) {
          const v = perMtok(tier, from);
          if (v !== undefined) entry[to] = v;
        }
      }
      const name = id.toLowerCase();
      const bare = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : null;
      const firstParty = FIRST_PARTY.includes(providerId);
      for (const key of bare === null ? [name] : [name, bare]) {
        const list = candidates.get(key) ?? [];
        list.push({ entry, firstParty });
        candidates.set(key, list);
      }
    }
  }
  for (const [key, list] of candidates) {
    const makers = list.filter((c) => c.firstParty);
    const pool = makers.length > 0 ? makers : list;
    const total = (c: { entry: LiteLlmPriceEntry }) => (c.entry.input_cost_per_token ?? 0) + (c.entry.output_cost_per_token ?? 0);
    const sorted = [...pool].sort((a, b) => total(a) - total(b));
    out[key] = (sorted[Math.floor((sorted.length - 1) / 2)] as { entry: LiteLlmPriceEntry }).entry;
  }
  return out;
}

/** GETs a JSON document, refusing a body over `MAX_BYTES` or a response slower than the timeout. */
async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error(`response is ${declared} bytes, over the ${MAX_BYTES} limit`);
  if (res.body === null) throw new Error("empty response");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`response is over the ${MAX_BYTES} byte limit`);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const SOURCES = [
  { name: "LiteLLM", meta: LITELLM_META, url: LITELLM_PRICES_URL, trim: trimPriceMap },
  { name: "models.dev", meta: MODELS_DEV_META, url: MODELS_DEV_URL, trim: trimModelsDev },
] as const;

export interface RefreshDeps {
  store: MetaStore;
  fetch: typeof fetch;
  now: () => number;
  log: { warn(message: string): void };
}

/**
 * Fetches each list whose stored copy is missing or older than a day. A
 * failing list keeps its last good copy and is retried on the next call;
 * the other list is fetched regardless. Returns true when a copy changed.
 */
export async function refreshPublicPrices(deps: RefreshDeps): Promise<boolean> {
  const errors: Record<string, string | null> = deps.store.getMeta(REFRESH_ERROR_META) ?? {};
  let changed = false;
  for (const source of SOURCES) {
    const current = deps.store.getMeta<FetchedPrices>(source.meta);
    if (current !== null && current.trim === TRIM_VERSION && deps.now() - current.fetchedAtMs <= REFRESH_AFTER_MS) continue;
    try {
      const models = source.trim(await fetchJson(deps.fetch, source.url));
      if (Object.keys(models).length < MIN_MODELS) throw new Error("price list looks truncated");
      const at = deps.now();
      const stored: FetchedPrices = { trim: TRIM_VERSION, source: source.url, fetchedAt: new Date(at).toISOString(), fetchedAtMs: at, models };
      deps.store.setMeta(source.meta, stored);
      errors[source.name] = null;
      changed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors[source.name] = message;
      deps.log.warn(`${source.name} price refresh failed; keeping the last copy: ${message}`);
    }
  }
  deps.store.setMeta(REFRESH_ERROR_META, errors);
  return changed;
}

/** The first non-null failure message, for the "refresh is failing" note. */
export function refreshError(store: MetaStore): string | null {
  const errors = store.getMeta<Record<string, string | null>>(REFRESH_ERROR_META) ?? {};
  for (const [name, message] of Object.entries(errors)) if (message) return `${name}: ${message}`;
  return null;
}

/**
 * Once per install: Refresh prices online used to default to off, so an
 * explicit `false` was never a deliberate choice here. Unsets it, so the new
 * default (on) applies. A user who sets it to false afterwards is not touched
 * again. bb does not say whether a stored `false` was chosen, so an install
 * that did choose it is flipped too. Returns true when it flipped. A failing
 * `unset` is logged and retried at the next load; it never stops the plugin
 * from loading.
 */
export async function flipRefreshPricesDefault(
  store: MetaStore,
  current: boolean,
  unset: () => Promise<void>,
  log: { warn(message: string): void },
): Promise<boolean> {
  if (store.getMeta<boolean>(DEFAULT_FLIP_META) === true) return false;
  if (!current) {
    try {
      await unset();
    } catch (error) {
      log.warn(`could not reset Refresh prices online to its new default: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  store.setMeta(DEFAULT_FLIP_META, true);
  return !current;
}
