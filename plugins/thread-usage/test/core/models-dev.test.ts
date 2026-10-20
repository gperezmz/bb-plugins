import { describe, expect, it } from "vitest";
import { trimModelsDev } from "../../src/core/models-dev";

describe("trimModelsDev", () => {
  it("maps per-million prices to per-token rates, cache reads and writes included", () => {
    const out = trimModelsDev({
      acme: { models: { m: { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } }, free: { cost: { input: 0, output: 0 } }, none: {}, half: { cost: { input: 1 } } } },
    });
    expect(out.m).toEqual({ input: 3e-6, output: 15e-6, cacheRead: 3e-7, cacheWrite: 3.75e-6 });
    // A model priced at 0 for both input and output has no real price: it stays unpriced.
    expect(Object.keys(out)).toEqual(["m"]);
  });

  it("keeps the digits models.dev published, without the noise of dividing by a million", () => {
    const out = trimModelsDev({ acme: { models: { m: { cost: { input: 0.1, output: 0.07, cache_read: 0.01 } } } } });
    expect(out.m).toEqual({ input: 1e-7, output: 7e-8, cacheRead: 1e-8 });
  });

  it("marks Claude models, by their maker or by their id", () => {
    const out = trimModelsDev({
      anthropic: { models: { "claude-opus-5-5": { cost: { input: 4, output: 20 } } } },
      openai: { models: { "gpt-x": { cost: { input: 2, output: 8 } } } },
      "amazon-bedrock": { models: { "anthropic.claude-z": { cost: { input: 3, output: 15 } } } },
    });
    expect(out["claude-opus-5-5"]!.claude).toBe(true);
    expect(out["anthropic.claude-z"]!.claude).toBe(true);
    expect(out["gpt-x"]!.claude).toBeUndefined();
  });

  it("reads every context tier at the size models.dev publishes, sorted by size", () => {
    const out = trimModelsDev({
      acme: {
        models: {
          m: {
            cost: {
              input: 1,
              output: 2,
              tiers: [
                { input: 3, output: 6, cache_read: 0.3, tier: { type: "context", size: 272_000 } },
                { input: 2, tier: { type: "context", size: 128_001 } },
              ],
            },
          },
        },
      },
    });
    expect(out.m!.tiers).toEqual([
      { above: 128_001, input: 2e-6 },
      { above: 272_000, input: 3e-6, output: 6e-6, cacheRead: 3e-7 },
    ]);
  });

  it("ignores a tier that is not a context tier, and a tier with no size or no rates", () => {
    const out = trimModelsDev({
      acme: {
        models: {
          m: {
            cost: {
              input: 1,
              output: 2,
              tiers: [
                { input: 9, output: 9, tier: { type: "region", size: 1_000 } },
                { input: 9, output: 9, tier: { type: "context" } },
                { input: 9, output: 9 },
                { tier: { type: "context", size: 5_000 } },
              ],
            },
          },
        },
      },
    });
    expect(out.m!.tiers).toBeUndefined();
  });

  it("ignores the legacy context_over_200k field", () => {
    const out = trimModelsDev({ google: { models: { g: { cost: { input: 2, output: 12, context_over_200k: { input: 4, output: 18 } } } } } });
    expect(out.g!.tiers).toBeUndefined();
  });

  it("prefers the maker's price for a model several providers list", () => {
    const out = trimModelsDev({
      aaa: { models: { "claude-x": { cost: { input: 9, output: 9 } } } },
      anthropic: { models: { "claude-x": { cost: { input: 1, output: 1 } } } },
      reseller: { models: { "anthropic/claude-y": { cost: { input: 5, output: 5 } } } },
    });
    expect(out["claude-x"]!.input).toBe(1e-6);
    // A vendor-prefixed id is also reachable by its bare name.
    expect(out["claude-y"]!.input).toBe(5e-6);
  });

  it("takes the median of the others' prices when no maker lists the model, ignoring free tiers", () => {
    const out = trimModelsDev({
      a: { models: { m: { cost: { input: 0, output: 0 } } } },
      b: { models: { m: { cost: { input: 1, output: 1 } } } },
      c: { models: { m: { cost: { input: 2, output: 2 } } } },
      d: { models: { m: { cost: { input: 30, output: 30 } } } },
    });
    expect(out.m!.input).toBe(2e-6);
  });
});
