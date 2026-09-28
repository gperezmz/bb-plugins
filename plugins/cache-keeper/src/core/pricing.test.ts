import { describe, expect, it } from "vitest";
import { warmRatesOf } from "./line";
import { PriceBook, type LiteLlmPriceEntry } from "./pricing";

const entry = (over: LiteLlmPriceEntry = {}): LiteLlmPriceEntry => ({
  input_cost_per_token: 4e-6,
  output_cost_per_token: 20e-6,
  cache_read_input_token_cost: 0.4e-6,
  cache_creation_input_token_cost: 5e-6,
  cache_creation_input_token_cost_above_1hr: 8e-6,
  ...over,
});

describe("PriceBook", () => {
  it("takes LiteLLM first, then models.dev, then the bundled list", () => {
    const book = new PriceBook({
      litellm: { "claude-a": entry({ input_cost_per_token: 1e-6 }) },
      modelsDev: { "claude-a": entry({ input_cost_per_token: 2e-6 }), "claude-b": entry({ input_cost_per_token: 2e-6 }) },
      bundled: { "claude-a": entry({ input_cost_per_token: 3e-6 }), "claude-b": entry({ input_cost_per_token: 3e-6 }), "claude-c": entry({ input_cost_per_token: 3e-6 }) },
    });
    expect(book.lookup("claude-a")).toMatchObject({ origin: "litellm", price: { input: 1e-6 } });
    expect(book.lookup("claude-b")).toMatchObject({ origin: "models.dev", price: { input: 2e-6 } });
    expect(book.lookup("claude-c[1m]")).toMatchObject({ origin: "bundled", price: { input: 3e-6 } });
    expect(book.lookup("gpt-unknown")).toBeNull();
  });

  it("rejects a fetched price of 0 for that model and takes the next list", () => {
    const book = new PriceBook({
      litellm: { "claude-a": entry({ cache_read_input_token_cost: 0 }), "claude-b": entry({ input_cost_per_token: 0 }) },
      modelsDev: { "claude-a": entry({ cache_creation_input_token_cost: 0 }), "claude-b": entry({ input_cost_per_token: 2e-6 }) },
      bundled: { "claude-a": entry({ input_cost_per_token: 3e-6 }) },
    });
    expect(book.lookup("claude-a")).toMatchObject({ origin: "bundled", price: { input: 3e-6 } });
    expect(book.lookup("claude-b")).toMatchObject({ origin: "models.dev", price: { input: 2e-6 } });
  });
});

describe("warmRatesOf", () => {
  const price = { input: 4e-6, output: 20e-6, cacheRead: 0.4e-6, cacheWrite: 5e-6, cacheWrite1h: 8e-6 };

  it("gives the read and the write at the thread's cache lifetime", () => {
    expect(warmRatesOf(price, "5m")).toEqual({ w: 5e-6, r: 0.4e-6, o: 20e-6 });
    expect(warmRatesOf(price, "1h")).toEqual({ w: 8e-6, r: 0.4e-6, o: 20e-6 });
  });

  it("has none where the read or that write is missing or 0", () => {
    expect(warmRatesOf({ ...price, cacheRead: undefined }, "5m")).toBeNull();
    expect(warmRatesOf({ ...price, cacheRead: 0 }, "5m")).toBeNull();
    expect(warmRatesOf({ ...price, cacheWrite: 0 }, "5m")).toBeNull();
    expect(warmRatesOf({ ...price, cacheWrite1h: undefined }, "1h")).toBeNull();
    expect(warmRatesOf({ ...price, cacheWrite1h: undefined }, "5m")).not.toBeNull();
  });
});
