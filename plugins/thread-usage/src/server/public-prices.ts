/**
 * The models.dev price list, fetched at runtime. A copy is stored with its
 * fetch time and replaced only by a later successful fetch; a failure keeps
 * the last good copy. Until one succeeded, the plugin uses the copy bundled
 * with it (`snapshot.ts`).
 */
import { MODELS_DEV_URL, trimModelsDev } from "../core/models-dev";
import type { ModelPrice } from "../core/pricing";

/** A fetched copy is replaced after this long. */
export const REFRESH_AFTER_MS = 24 * 3_600_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_MODELS = 100;
/** Bump when `trimModelsDev` changes what it keeps, so stored copies are fetched again. */
const TRIM_VERSION = 1;

/** Where the fetched list is stored. Copies under older keys were trimmed without tier sizes and are not read. */
export const MODELS_DEV_META = "modelsDevList";
export const REFRESH_ERROR_META = "modelsDevRefreshError";
const DEFAULT_FLIP_META = "refreshPricesDefaultOn";

/** The models.dev list as fetched and stored. */
export interface FetchedPrices {
  /** `TRIM_VERSION` when stored; a copy trimmed under older rules is fetched again. */
  trim?: number;
  source: string;
  fetchedAt: string;
  fetchedAtMs: number;
  models: Record<string, ModelPrice>;
}

export interface MetaStore {
  getMeta<T>(key: string): T | null;
  setMeta(key: string, value: unknown): void;
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

/** The stored models.dev copy, or null when none was stored under the current trimming rules. */
export function storedPrices(store: MetaStore): FetchedPrices | null {
  const stored = store.getMeta<FetchedPrices>(MODELS_DEV_META);
  return stored !== null && stored.trim === TRIM_VERSION ? stored : null;
}

export interface RefreshDeps {
  store: MetaStore;
  fetch: typeof fetch;
  now: () => number;
  log: { warn(message: string): void };
}

/**
 * Fetches the list when the stored copy is missing or older than a day. A
 * failure keeps the last good copy and is retried on the next call. Returns
 * true when the copy changed.
 */
export async function refreshPublicPrices(deps: RefreshDeps): Promise<boolean> {
  const current = storedPrices(deps.store);
  if (current !== null && deps.now() - current.fetchedAtMs <= REFRESH_AFTER_MS) return false;
  try {
    const models = trimModelsDev(await fetchJson(deps.fetch, MODELS_DEV_URL));
    if (Object.keys(models).length < MIN_MODELS) throw new Error("price list looks truncated");
    const at = deps.now();
    const stored: FetchedPrices = { trim: TRIM_VERSION, source: MODELS_DEV_URL, fetchedAt: new Date(at).toISOString(), fetchedAtMs: at, models };
    deps.store.setMeta(MODELS_DEV_META, stored);
    deps.store.setMeta(REFRESH_ERROR_META, null);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.store.setMeta(REFRESH_ERROR_META, message);
    deps.log.warn(`models.dev price refresh failed; keeping the last copy: ${message}`);
    return false;
  }
}

/** Why the last refresh failed, or null when it did not. */
export function refreshError(store: MetaStore): string | null {
  return store.getMeta<string | null>(REFRESH_ERROR_META) ?? null;
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
