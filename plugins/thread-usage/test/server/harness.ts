/**
 * In-memory store, settings and model for server tests (better-sqlite3 in
 * memory, migrations run in order, as `bb.storage.migrate` would).
 */
import Database from "better-sqlite3";
import { PriceBook, type ModelPrice, type PriceOrigin } from "../../src/core/pricing";
import type { PricesMeta } from "../../src/core/report-types";
import { UsageModel } from "../../src/server/model";
import { parseSettings, type UsageSettings } from "../../src/server/settings";
import { MIGRATIONS, Store, type Db } from "../../src/server/store";

/** Round numbers: $1 per M input, $10 per M output. */
export const TEST_PRICES: Record<string, ModelPrice> = {
  "test-model": { input: 1e-6, output: 1e-5, cacheRead: 1e-7, cacheWrite: 1.25e-6 },
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
  /** Mutable: tests swap the price list and its fetch time, as a refresh would. */
  prices: { models: Record<string, ModelPrice>; origin: PriceOrigin; meta: PricesMeta };
}

export function harness(raw: Record<string, unknown> = {}, now = Date.UTC(2026, 5, 1, 13)): Harness {
  const store = memoryStore();
  const settings = { current: parseSettings(raw) };
  const clock = { now };
  const prices: Harness["prices"] = {
    models: TEST_PRICES,
    origin: "snapshot",
    meta: { modelsDevAt: null, bundledDate: "2026-05-01", refreshOn: true, lastError: null },
  };
  const book = () => new PriceBook({ models: prices.models, origin: prices.origin });
  const model = new UsageModel({
    store,
    settings: () => settings.current,
    prices: book,
    pricesMeta: () => prices.meta,
    now: () => clock.now,
  });
  return { store, model, settings, clock, prices };
}
