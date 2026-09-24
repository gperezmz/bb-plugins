/**
 * In-memory store, settings and model for server tests (better-sqlite3 in
 * memory, migrations run in order, as `bb.storage.migrate` would).
 */
import Database from "better-sqlite3";
import { PriceBook, type LiteLlmPriceEntry } from "../../src/core/pricing";
import type { GatewayBanner, PricesMeta } from "../../src/core/report-types";
import { UsageModel } from "../../src/server/model";
import { parseSettings, type UsageSettings } from "../../src/server/settings";
import { MIGRATIONS, Store, type Db } from "../../src/server/store";

export const TEST_SNAPSHOT = {
  "test-model": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1e-7,
    cache_creation_input_token_cost: 1.25e-6,
  },
};

export function memoryStore(): Store {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  return new Store(db as unknown as Db);
}

export interface Harness {
  store: Store;
  model: UsageModel;
  /** Mutable: tests change settings between calls, as a user saving them would. */
  settings: { current: UsageSettings };
  clock: { now: number };
  /** Mutable: tests swap the price lists and their fetch times, as a refresh would. */
  prices: { snapshot: Record<string, LiteLlmPriceEntry>; modelsDev: Record<string, LiteLlmPriceEntry>; meta: PricesMeta };
}

export function harness(raw: Record<string, unknown> = {}, now = Date.UTC(2026, 5, 1, 13)): Harness {
  const store = memoryStore();
  const settings = { current: parseSettings(raw) };
  const clock = { now };
  const prices: Harness["prices"] = {
    snapshot: TEST_SNAPSHOT,
    modelsDev: {},
    meta: { litellmAt: null, modelsDevAt: null, bundledDate: "2026-05-01", refreshOn: true, lastError: null },
  };
  const book = () =>
    new PriceBook({ snapshot: prices.snapshot, modelsDev: prices.modelsDev, overrides: settings.current.priceOverrides });
  const model = new UsageModel({
    store,
    settings: () => settings.current,
    prices: book,
    listPrices: book,
    pricesMeta: () => prices.meta,
    now: () => clock.now,
    gatewayBanner: () => store.getMeta<GatewayBanner | null>("gatewayBanner"),
    gatewayPricesUsed: () => false,
  });
  return { store, model, settings, clock, prices };
}
