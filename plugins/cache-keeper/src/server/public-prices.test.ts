import { describe, expect, it } from "vitest";
import { PriceBook } from "../core/pricing";
import { LITELLM_META, MODELS_DEV_META, MODELS_DEV_URL, refreshError, refreshPublicPrices, REFRESH_AFTER_MS, type FetchedPrices } from "./public-prices";
import { LITELLM_PRICES_URL } from "./snapshot";

class Meta {
  rows = new Map<string, unknown>();
  getMeta<T>(key: string): T | null {
    return (this.rows.get(key) as T | undefined) ?? null;
  }
  setMeta(key: string, value: unknown) {
    this.rows.set(key, structuredClone(value));
  }
}

/** A LiteLLM list with enough models to pass the truncation check, `claude-a` priced by `over`. */
const litellm = (over: Record<string, number> = {}) => {
  const list: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) list[`model-${i}`] = { mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
  list["claude-a"] = {
    mode: "chat",
    input_cost_per_token: 4e-6,
    output_cost_per_token: 20e-6,
    cache_read_input_token_cost: 0.4e-6,
    cache_creation_input_token_cost: 5e-6,
    cache_creation_input_token_cost_above_1hr: 8e-6,
    ...over,
  };
  return list;
};

const modelsDev = (claudeInput: number) => {
  const models: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) models[`model-${i}`] = { cost: { input: 1, output: 2 } };
  models["claude-a"] = { cost: { input: claudeInput, output: 20, cache_read: 0.4, cache_write: 5 } };
  return { anthropic: { models } };
};

type Reply = { status?: number; body: string };
const fakeFetch = (replies: Record<string, Reply | Error>) =>
  (async (url: string) => {
    const reply = replies[url];
    if (reply === undefined || reply instanceof Error) throw reply ?? new Error(`no route ${url}`);
    return new Response(reply.body, { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;

const warnings: string[] = [];
const deps = (store: Meta, replies: Record<string, Reply | Error>, now = 1_000_000) => ({
  store,
  fetch: fakeFetch(replies),
  now: () => now,
  log: { warn: (m: string) => warnings.push(m) },
});

const book = (store: Meta) =>
  new PriceBook({
    litellm: store.getMeta<FetchedPrices>(LITELLM_META)?.models,
    modelsDev: store.getMeta<FetchedPrices>(MODELS_DEV_META)?.models,
    bundled: { "claude-a": { input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 } },
  });

describe("refreshPublicPrices", () => {
  it("stores both lists and prices from LiteLLM first", async () => {
    const store = new Meta();
    const changed = await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: JSON.stringify(litellm()) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(3)) } }));
    expect(changed).toBe(true);
    expect(book(store).lookup("claude-a")).toMatchObject({ origin: "litellm", price: { input: 4e-6 } });
    expect(refreshError(store)).toBeNull();
  });

  it("falls back to models.dev, then the bundled list, for a model LiteLLM prices at 0", async () => {
    const store = new Meta();
    await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: JSON.stringify(litellm({ cache_read_input_token_cost: 0 })) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(3)) } }));
    expect(book(store).lookup("claude-a")).toMatchObject({ origin: "models.dev", price: { input: 3e-6 } });

    const zeroBoth = new Meta();
    await refreshPublicPrices(deps(zeroBoth, { [LITELLM_PRICES_URL]: { body: JSON.stringify(litellm({ input_cost_per_token: 0 })) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(0)) } }));
    expect(book(zeroBoth).lookup("claude-a")).toMatchObject({ origin: "bundled" });
  });

  it("keeps the last good copy and records the error when a response is broken", async () => {
    const store = new Meta();
    await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: JSON.stringify(litellm()) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(3)) } }));
    const later = 1_000_000 + REFRESH_AFTER_MS + 1;
    const changed = await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: "{not json" }, [MODELS_DEV_URL]: { status: 503, body: "" } }, later));
    expect(changed).toBe(false);
    expect(book(store).lookup("claude-a")).toMatchObject({ origin: "litellm", price: { input: 4e-6 } });
    expect(refreshError(store)).toMatch(/^LiteLLM: /);
    expect(store.getMeta<Record<string, string>>("pricesRefreshError")?.["models.dev"]).toBe("HTTP 503");
    expect(warnings.some((w) => w.includes("keeping the last copy"))).toBe(true);
  });

  it("refuses a list that looks truncated, and fetches the other list regardless", async () => {
    const store = new Meta();
    const changed = await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: JSON.stringify({ "claude-a": litellm()["claude-a"] }) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(3)) } }));
    expect(changed).toBe(true);
    expect(store.getMeta(LITELLM_META)).toBeNull();
    expect(book(store).lookup("claude-a")).toMatchObject({ origin: "models.dev" });
    expect(refreshError(store)).toBe("LiteLLM: price list looks truncated");
  });

  it("fetches nothing while both copies are under a day old", async () => {
    const store = new Meta();
    await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: { body: JSON.stringify(litellm()) }, [MODELS_DEV_URL]: { body: JSON.stringify(modelsDev(3)) } }));
    const changed = await refreshPublicPrices(deps(store, { [LITELLM_PRICES_URL]: new Error("must not fetch"), [MODELS_DEV_URL]: new Error("must not fetch") }, 1_000_000 + 60_000));
    expect(changed).toBe(false);
    expect(refreshError(store)).toBeNull();
  });
});
