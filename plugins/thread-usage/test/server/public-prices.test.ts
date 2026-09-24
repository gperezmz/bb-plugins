import { describe, expect, it, vi } from "vitest";
import { costOf, PriceBook } from "../../src/core/pricing";
import { parseSettings } from "../../src/server/settings";
import {
  flipRefreshPricesDefault,
  LITELLM_META,
  MODELS_DEV_META,
  refreshError,
  refreshPublicPrices,
  trimModelsDev,
  type FetchedPrices,
} from "../../src/server/public-prices";
import { LITELLM_PRICES_URL } from "../../src/server/snapshot";
import { MODELS_DEV_URL } from "../../src/server/public-prices";
import { tokens } from "../core/fixtures";
import { memoryStore } from "./harness";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 12);

/** 120 chat models, enough to pass the truncation check. */
function litellmBody(extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { sample_spec: {}, ...extra };
  for (let i = 0; i < 120; i++) {
    body[`model-${i}`] = { mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6, junk: "x" };
  }
  return body;
}

function modelsDevBody(extra: Record<string, unknown> = {}) {
  const models: Record<string, unknown> = { ...extra };
  for (let i = 0; i < 120; i++) models[`dev-${i}`] = { id: `dev-${i}`, cost: { input: 1, output: 2 } };
  return { acme: { id: "acme", models } };
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

/** A fetch that answers by URL and counts calls. */
function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected ${url}`);
    return answer();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const log = { warn: vi.fn() };

describe("refreshPublicPrices", () => {
  it("fetches both lists at startup, trims them and stores each with its fetch time", async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch({
      [LITELLM_PRICES_URL]: () => json(litellmBody({ "embed": { mode: "embedding", input_cost_per_token: 1, output_cost_per_token: 1 } })),
      [MODELS_DEV_URL]: () => json(modelsDevBody()),
    });
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW, log })).toBe(true);
    expect(calls).toEqual([LITELLM_PRICES_URL, MODELS_DEV_URL]);
    const lite = store.getMeta<FetchedPrices>(LITELLM_META)!;
    expect(lite.fetchedAtMs).toBe(NOW);
    expect(Object.keys(lite.models)).toHaveLength(120);
    expect(lite.models["model-0"]).toEqual({ input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 });
    expect(store.getMeta<FetchedPrices>(MODELS_DEV_META)!.models["dev-0"]).toEqual({
      input_cost_per_token: 1e-6,
      output_cost_per_token: 2e-6,
    });
    expect(refreshError(store)).toBeNull();
  });

  it("does not refetch a copy under a day old, and refetches one over a day old", async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch({
      [LITELLM_PRICES_URL]: () => json(litellmBody()),
      [MODELS_DEV_URL]: () => json(modelsDevBody()),
    });
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    calls.length = 0;
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 23 * HOUR, log })).toBe(false);
    expect(calls).toEqual([]);
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 25 * HOUR, log })).toBe(true);
    expect(calls).toEqual([LITELLM_PRICES_URL, MODELS_DEV_URL]);
    expect(store.getMeta<FetchedPrices>(LITELLM_META)!.fetchedAtMs).toBe(NOW + 25 * HOUR);
  });

  it("refetches a copy stored under older trimming rules even when it is fresh", async () => {
    const store = memoryStore();
    store.setMeta(LITELLM_META, { source: "x", fetchedAt: "", fetchedAtMs: NOW, models: {} });
    store.setMeta(MODELS_DEV_META, { source: "x", fetchedAt: "", fetchedAtMs: NOW, models: {} });
    const { fetch, calls } = fakeFetch({
      [LITELLM_PRICES_URL]: () => json(litellmBody()),
      [MODELS_DEV_URL]: () => json(modelsDevBody()),
    });
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + HOUR, log })).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("keeps the last good copy when a refresh fails, records why, and retries later", async () => {
    const store = memoryStore();
    let broken = false;
    const { fetch } = fakeFetch({
      [LITELLM_PRICES_URL]: () => (broken ? new Response("nope", { status: 503 }) : json(litellmBody())),
      [MODELS_DEV_URL]: () => (broken ? Promise.reject(new DOMException("timed out", "TimeoutError")) : json(modelsDevBody())),
    });
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    broken = true;
    expect(await refreshPublicPrices({ store, fetch, now: () => NOW + 30 * HOUR, log })).toBe(false);
    expect(store.getMeta<FetchedPrices>(LITELLM_META)!.fetchedAtMs).toBe(NOW);
    expect(store.getMeta<FetchedPrices>(MODELS_DEV_META)!.fetchedAtMs).toBe(NOW);
    expect(refreshError(store)).toBe("LiteLLM: HTTP 503");
    broken = false;
    await refreshPublicPrices({ store, fetch, now: () => NOW + 31 * HOUR, log });
    expect(store.getMeta<FetchedPrices>(LITELLM_META)!.fetchedAtMs).toBe(NOW + 31 * HOUR);
    expect(refreshError(store)).toBeNull();
  });

  it("fetches models.dev even when LiteLLM fails, and stores nothing when nothing was ever fetched", async () => {
    const store = memoryStore();
    const { fetch } = fakeFetch({
      [LITELLM_PRICES_URL]: () => new Response("nope", { status: 500 }),
      [MODELS_DEV_URL]: () => json(modelsDevBody()),
    });
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    expect(store.getMeta(LITELLM_META)).toBeNull();
    expect(store.getMeta<FetchedPrices>(MODELS_DEV_META)).not.toBeNull();
  });

  it("passes an abort signal so a stalled request or body times out", async () => {
    const store = memoryStore();
    const signals: (AbortSignal | undefined)[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return json(litellmBody());
    }) as unknown as typeof globalThis.fetch;
    await refreshPublicPrices({ store, fetch, now: () => NOW, log });
    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a truncated list, a body over the size cap, and one that is not JSON", async () => {
    for (const answer of [
      () => json({ a: { mode: "chat", input_cost_per_token: 1, output_cost_per_token: 1 } }),
      () => json(litellmBody(), { headers: { "content-length": String(50 * 1024 * 1024) } }),
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
      const { fetch } = fakeFetch({ [LITELLM_PRICES_URL]: answer, [MODELS_DEV_URL]: () => new Response("x", { status: 500 }) });
      await refreshPublicPrices({ store, fetch, now: () => NOW, log });
      expect(store.getMeta(LITELLM_META)).toBeNull();
      expect(refreshError(store)).toMatch(/^LiteLLM: /);
    }
  });
});

describe("trimModelsDev", () => {
  it("maps per-million prices to per-token fields, including cache reads and writes", () => {
    const out = trimModelsDev({
      acme: { models: { m: { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } }, free: { cost: { input: 0, output: 0 } }, none: {}, half: { cost: { input: 1 } } } },
    });
    expect(out.m).toEqual({
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
      cache_read_input_token_cost: 3e-7,
      cache_creation_input_token_cost: 3.75e-6,
    });
    // A model priced at 0 for both input and output has no real price: it stays unpriced.
    expect(Object.keys(out)).toEqual(["m"]);
  });

  it("derives the 1-hour cache write as 2 × input for Anthropic models, and only for them", () => {
    const out = trimModelsDev({
      anthropic: { models: { "claude-opus-5-5": { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } } } },
      openai: { models: { "gpt-x": { cost: { input: 2, output: 8, cache_write: 2 } } } },
    });
    expect(out["claude-opus-5-5"]!.cache_creation_input_token_cost_above_1hr).toBeCloseTo(8e-6, 12);
    expect(out["gpt-x"]!.cache_creation_input_token_cost_above_1hr).toBeUndefined();
    // A 1-hour write of 1000 tokens is billed at 2 × input through the price book.
    const book = new PriceBook({ snapshot: {}, modelsDev: out });
    const price = book.lookup("claude-opus-5-5")!.price;
    expect(costOf(tokens({ cacheWrite: 1000, cacheWrite1h: 1000 }), price, null)).toEqual({ usd: 1000 * 8e-6, approximate: false });
  });

  it("prefers the maker's price for a model several providers list", () => {
    const out = trimModelsDev({
      aaa: { models: { "claude-x": { cost: { input: 9, output: 9 } } } },
      anthropic: { models: { "claude-x": { cost: { input: 1, output: 1 } } } },
      reseller: { models: { "anthropic/claude-y": { cost: { input: 5, output: 5 } } } },
    });
    expect(out["claude-x"]!.input_cost_per_token).toBe(1e-6);
    // A vendor-prefixed id is also reachable by its bare name.
    expect(out["claude-y"]!.input_cost_per_token).toBe(5e-6);
  });

  it("takes the median of the resellers' prices when no maker lists the model, ignoring free tiers", () => {
    const out = trimModelsDev({
      a: { models: { m: { cost: { input: 0, output: 0 } } } },
      b: { models: { m: { cost: { input: 1, output: 1 } } } },
      c: { models: { m: { cost: { input: 2, output: 2 } } } },
      d: { models: { m: { cost: { input: 30, output: 30 } } } },
    });
    expect(out.m!.input_cost_per_token).toBe(2e-6);
  });

  it("maps the 200k long-context rates to the fields the price book reads", () => {
    const out = trimModelsDev({
      google: { models: { g: { cost: { input: 2, output: 12, context_over_200k: { input: 4, output: 18, cache_read: 0.4 } } } } },
    });
    const tier = new PriceBook({ snapshot: {}, modelsDev: out }).lookup("g")!.price.tiers![0]!;
    expect(tier).toMatchObject({ above: 200_000, input: 4e-6, output: 18e-6 });
    expect(tier.cacheRead).toBeCloseTo(4e-7, 12);
  });

  it("derives the 1-hour price for Bedrock-style Claude ids too", () => {
    const out = trimModelsDev({ "amazon-bedrock": { models: { "anthropic.claude-z": { cost: { input: 3, output: 15 } } } } });
    expect(out["anthropic.claude-z"]!.cache_creation_input_token_cost_above_1hr).toBeCloseTo(6e-6, 12);
  });
});

describe("price lookup order", () => {
  const snapshot = { shared: { input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 } };
  const modelsDev = {
    shared: { input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 },
    only: { input_cost_per_token: 3e-6, output_cost_per_token: 3e-6 },
  };

  it("overrides, then LiteLLM's list, then models.dev, then unpriced", () => {
    const book = new PriceBook({
      snapshot,
      snapshotOrigin: "litellm",
      modelsDev,
      overrides: { prices: { over: { input: 7, output: 7 } } },
    });
    expect(book.lookup("over")!.origin).toBe("override");
    const shared = book.lookup("shared")!;
    expect(shared.origin).toBe("litellm");
    expect(shared.price.input).toBe(1e-6);
    const only = book.lookup("only")!;
    expect(only.origin).toBe("models.dev");
    expect(only.price.input).toBe(3e-6);
    expect(book.lookup("nobody")).toBeNull();
  });

  it("reports the bundled snapshot as such when no fetched copy exists", () => {
    expect(new PriceBook({ snapshot }).lookup("shared")!.origin).toBe("snapshot");
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
