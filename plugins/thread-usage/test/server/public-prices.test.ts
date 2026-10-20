import { describe, expect, it, vi } from "vitest";
import { MODELS_DEV_URL } from "../../src/core/models-dev";
import { parseSettings } from "../../src/server/settings";
import {
  flipRefreshPricesDefault,
  MODELS_DEV_META,
  refreshError,
  refreshPublicPrices,
  storedPrices,
  type FetchedPrices,
} from "../../src/server/public-prices";
import { memoryStore } from "./harness";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 12);

/** models.dev's document with 120 models, enough to pass the truncation check, and the extra ones given. */
function modelsDevBody(extra: Record<string, unknown> = {}) {
  const models: Record<string, unknown> = { ...extra };
  for (let i = 0; i < 120; i++) models[`dev-${i}`] = { id: `dev-${i}`, cost: { input: 1, output: 2 } };
  return { acme: { id: "acme", models } };
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

/** A fetch that answers by URL and counts calls. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return answer();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const log = { warn: vi.fn() };

describe("refreshPublicPrices", () => {
  it("fetches models.dev's list, trims it and stores it with its fetch time", async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch(() => json(modelsDevBody()));
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW, log })).toBe(true);
    expect(calls).toEqual([MODELS_DEV_URL]);
    const stored = storedPrices(store)!;
    expect(stored.fetchedAtMs).toBe(NOW);
    expect(Object.keys(stored.models)).toHaveLength(120);
    expect(stored.models["dev-0"]).toEqual({ input: 1e-6, output: 2e-6 });
    expect(refreshError(store)).toBeNull();
  });

  it("keeps every context tier at the size models.dev publishes", async () => {
    const store = memoryStore();
    const tiers = [{ input: 3, output: 6, tier: { type: "context", size: 123_456 } }];
    const { fetch } = fakeFetch(() => json(modelsDevBody({ tiered: { id: "tiered", cost: { input: 1, output: 2, tiers } } })));
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    expect(storedPrices(store)!.models.tiered).toEqual({ input: 1e-6, output: 2e-6, tiers: [{ above: 123_456, input: 3e-6, output: 6e-6 }] });
  });

  it("does not refetch a copy under a day old, and refetches one over a day old", async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch(() => json(modelsDevBody()));
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    calls.length = 0;
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 23 * HOUR, log })).toBe(false);
    expect(calls).toEqual([]);
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 25 * HOUR, log })).toBe(true);
    expect(calls).toEqual([MODELS_DEV_URL]);
    expect(storedPrices(store)!.fetchedAtMs).toBe(NOW + 25 * HOUR);
  });

  it("does not use a copy stored before tiers were kept, however fresh it is, and fetches again", async () => {
    const store = memoryStore();
    // Both keys a copy was stored under before: LiteLLM-named fields trimmed without tier sizes.
    store.setMeta("modelsDevPrices", { source: "x", fetchedAt: "", fetchedAtMs: NOW, models: { old: { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 } } });
    store.setMeta("onlinePrices", { source: "x", fetchedAt: "", fetchedAtMs: NOW, models: {} });
    expect(storedPrices(store)).toBeNull();
    // Under the current key, but trimmed under older rules.
    store.setMeta(MODELS_DEV_META, { source: "x", fetchedAt: "", fetchedAtMs: NOW, models: {} });
    expect(storedPrices(store)).toBeNull();
    const { fetch, calls } = fakeFetch(() => json(modelsDevBody()));
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + HOUR, log })).toBe(true);
    expect(calls).toEqual([MODELS_DEV_URL]);
    expect(storedPrices(store)!.models.old).toBeUndefined();
  });

  it("keeps the last good copy when a refresh fails, records why, and retries later", async () => {
    const store = memoryStore();
    let broken = false;
    const { fetch } = fakeFetch(() => (broken ? new Response("nope", { status: 503 }) : json(modelsDevBody())));
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    broken = true;
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 30 * HOUR, log })).toBe(false);
    expect(storedPrices(store)!.fetchedAtMs).toBe(NOW);
    expect(refreshError(store)).toBe("HTTP 503");
    broken = false;
    await refreshPublicPrices({ store, fetch, now: () => NOW + 31 * HOUR, log });
    expect(storedPrices(store)!.fetchedAtMs).toBe(NOW + 31 * HOUR);
    expect(refreshError(store)).toBeNull();
  });

  it("stores nothing when nothing was ever fetched", async () => {
    const store = memoryStore();
    const { fetch } = fakeFetch(() => new Response("nope", { status: 500 }));
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    expect(store.getMeta<FetchedPrices>(MODELS_DEV_META)).toBeNull();
    expect(refreshError(store)).toBe("HTTP 500");
  });

  it("passes an abort signal so a stalled request or body times out", async () => {
    const store = memoryStore();
    const signals: (AbortSignal | undefined)[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return json(modelsDevBody());
    }) as unknown as typeof globalThis.fetch;
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("refuses a truncated list, a body over the size cap, and one that is not JSON", async () => {
    for (const answer of [
      () => json({ a: { models: { m: { cost: { input: 1, output: 1 } } } } }),
      () => json(modelsDevBody(), { headers: { "content-length": String(50 * 1024 * 1024) } }),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(4 * 1024 * 1024));
            },
          }),
        ),
      () => new Response("<html>"),
    ]) {
      const store = memoryStore();
      const { fetch } = fakeFetch(answer);
      await refreshPublicPrices({ store, fetch, now: () => NOW, log });
      expect(storedPrices(store)).toBeNull();
      expect(refreshError(store)).not.toBeNull();
    }
  });
});

describe("Refresh prices online: default on, and the one-time migration", () => {
  it("is on unless stored as false", () => {
    expect(parseSettings({}).refreshPrices).toBe(true);
    expect(parseSettings({ refreshPrices: true }).refreshPrices).toBe(true);
    expect(parseSettings({ refreshPrices: false }).refreshPrices).toBe(false);
  });

  it("unsets an existing false once; a later deliberate false stays", async () => {
    const store = memoryStore();
    const unset = vi.fn(async () => {});
    expect(await flipRefreshPricesDefault(store, false, unset, log)).toBe(true);
    expect(unset).toHaveBeenCalledTimes(1);
    // The user then turns it off on purpose: the next load leaves it.
    expect(await flipRefreshPricesDefault(store, false, unset, log)).toBe(false);
    expect(unset).toHaveBeenCalledTimes(1);
  });

  it("ends with the setting on: a stored false is gone after the flip, and a failing unset never throws and retries next load", async () => {
    const store = memoryStore();
    const stored: { refreshPrices?: boolean } = { refreshPrices: false };
    const effective = () => parseSettings({ refreshPrices: stored.refreshPrices }).refreshPrices;
    let failing = true;
    const unset = async () => {
      if (failing) throw new Error("daemon unavailable");
      delete stored.refreshPrices;
    };
    expect(await flipRefreshPricesDefault(store, effective(), unset, log)).toBe(false);
    expect(effective()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("daemon unavailable"));
    failing = false;
    expect(await flipRefreshPricesDefault(store, effective(), unset, log)).toBe(true);
    expect(effective()).toBe(true);
  });

  it("leaves an install that already has it on, and does not run again afterwards", async () => {
    const store = memoryStore();
    const unset = vi.fn(async () => {});
    expect(await flipRefreshPricesDefault(store, true, unset, log)).toBe(false);
    expect(await flipRefreshPricesDefault(store, false, unset, log)).toBe(false);
    expect(unset).not.toHaveBeenCalled();
  });
});
