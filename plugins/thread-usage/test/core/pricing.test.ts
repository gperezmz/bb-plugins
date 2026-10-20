import { describe, expect, it } from "vitest";
import { trimModelsDev } from "../../src/core/models-dev";
import { candidateNames, costOf, PriceBook, priceRequests, ratesFor, type ModelPrice } from "../../src/core/pricing";
import { tokens } from "./fixtures";

const PER_M = 1e-6;

/** Claude Haiku 5.5 as models.dev published it for Anthropic on 2026-10-19: $/Mtok, one context tier over 100,000. */
const HAIKU_PUBLISHED = {
  anthropic: {
    models: {
      "claude-haiku-5-5": {
        cost: {
          input: 0.1,
          output: 0.5,
          cache_read: 0.01,
          cache_write: 0.125,
          tiers: [{ input: 0.5, output: 2.5, cache_read: 0.05, cache_write: 0.625, tier: { type: "context", size: 100_000 } }],
        },
      },
    },
  },
};
const HAIKU = trimModelsDev(HAIKU_PUBLISHED)["claude-haiku-5-5"]!;

/** A model priced $1 in and $4 out per Mtok, with the tiers given as [size, rates]. */
function priced(tiers: ModelPrice["tiers"], extra: Partial<ModelPrice> = {}): ModelPrice {
  return { input: 1 * PER_M, output: 4 * PER_M, cacheRead: 0.1 * PER_M, cacheWrite: 1.25 * PER_M, ...(tiers ? { tiers } : {}), ...extra };
}

describe("PriceBook", () => {
  const book = new PriceBook({
    origin: "models.dev",
    models: trimModelsDev({
      anthropic: {
        models: {
          "claude-opus-5-5": { cost: { input: 5, output: 25 } },
          "claude-opus-5": { cost: { input: 15, output: 75 } },
          "claude-haiku-4-5-20251001": { cost: { input: 1, output: 5 } },
        },
      },
      "github-copilot": { models: { "gemini-3.8-flash": { cost: { input: 0.3, output: 2.5 } } } },
    }),
  });

  it("finds a model under every name the plugin tries, and none of its neighbours", () => {
    for (const name of [
      "claude-opus-5-5[1m]",
      "Claude-Opus-5-5",
      "anthropic/claude-opus-5-5",
      "litellm_proxy/anthropic/claude-opus-5-5",
      "openrouter/anthropic/claude-opus-5-5",
      "claude-opus-5-5-20260101",
      "claude-opus-5-5@20260101",
      "vertex_ai/claude-opus-5-5@20260101",
    ]) {
      expect(book.lookup(name)?.price.input, name).toBe(5e-6);
    }
    expect(book.lookup("claude-opus-5[1m]")?.model).toBe("claude-opus-5");
    expect(book.lookup("claude-haiku-4-5@20251001")?.model).toBe("claude-haiku-4-5-20251001");
    expect(book.lookup("github-copilot/gemini-3.8-flash")?.model).toBe("gemini-3.8-flash");
    expect(candidateNames("vertex_ai/claude-x@20250101")).toContain("claude-x-20250101");
    for (const name of ["claude-opus-5-5-preview-x", "claude-opus-5-9", "claude-opus", "my-internal-model", "", "  "]) {
      expect(book.lookup(name), name).toBeNull();
    }
    expect(book.lookup(null)).toBeNull();
  });

  it("reports which copy a price came from", () => {
    const models = { m: { input: 1, output: 1 } };
    expect(new PriceBook({ origin: "models.dev", models }).lookup("m")?.origin).toBe("models.dev");
    expect(new PriceBook({ origin: "snapshot", models }).lookup("m")?.origin).toBe("snapshot");
  });
});

describe("costOf: a request is charged at the tier its prompt is over", () => {
  it("charges a request over the tier at the tier's rates for every kind the tier sets, 1-hour writes at twice its input rate", () => {
    // 20,000 uncached + 70,000 read + 10,001 written (1,000 of them for 1 hour) = 100,001 prompt tokens.
    const t = tokens({ input: 20_000, output: 10_000, cacheRead: 70_000, cacheWrite: 10_001, cacheWrite1h: 1_000 });
    const r = costOf(t, HAIKU, 100_001);
    expect(r.tierAbove).toBe(100_000);
    expect(r.usd).toBeCloseTo(20_000 * 0.5e-6 + 10_000 * 2.5e-6 + 70_000 * 0.05e-6 + 9_001 * 0.625e-6 + 1_000 * 1.0e-6, 12);
    expect(r.approximate).toBe(false);
  });

  it("charges base rates at exactly the size, and with one token fewer in the prompt", () => {
    const at = tokens({ input: 20_000, output: 10_000, cacheRead: 70_000, cacheWrite: 10_000, cacheWrite1h: 1_000 });
    const r = costOf(at, HAIKU, 100_000);
    expect(r.tierAbove).toBeNull();
    expect(r.usd).toBeCloseTo(20_000 * 0.1e-6 + 10_000 * 0.5e-6 + 70_000 * 0.01e-6 + 9_000 * 0.125e-6 + 1_000 * 0.2e-6, 12);
    const under = tokens({ input: 20_000, cacheRead: 70_000, cacheWrite: 9_000 });
    expect(costOf(under, HAIKU, 99_000).tierAbove).toBeNull();
  });

  it("counts cache writes, as well as reads, toward the prompt", () => {
    const writes = tokens({ input: 1, cacheWrite: 100_000 });
    expect(costOf(writes, HAIKU, 100_001).tierAbove).toBe(100_000);
  });

  it("takes the tier with the highest size the prompt is over", () => {
    const price = priced([
      { above: 100_000, input: 2 * PER_M },
      { above: 500_000, input: 3 * PER_M },
    ]);
    const prompt = (n: number) => costOf(tokens({ input: n }), price, n);
    expect(prompt(50_000).tierAbove).toBeNull();
    expect(prompt(200_000).tierAbove).toBe(100_000);
    expect(prompt(200_000).usd).toBeCloseTo(200_000 * 2 * PER_M, 12);
    expect(prompt(600_000).tierAbove).toBe(500_000);
    expect(prompt(600_000).usd).toBeCloseTo(600_000 * 3 * PER_M, 12);
  });

  it("lets a kind the tier omits keep its base rate", () => {
    const price = priced([{ above: 100_000, input: 2 * PER_M, output: 8 * PER_M }]);
    const t = tokens({ input: 100_000, output: 1_000, cacheRead: 50_000 });
    const r = costOf(t, price, 150_000);
    expect(r.usd).toBeCloseTo(100_000 * 2 * PER_M + 1_000 * 8 * PER_M + 50_000 * 0.1 * PER_M, 12);
    expect(ratesFor(price, 150_000).rates.cacheRead).toBe(0.1 * PER_M);
  });

  it("uses a tier at a size the plugin has never carried", () => {
    const odd = trimModelsDev({ acme: { models: { m: { cost: { input: 1, output: 2, tiers: [{ input: 9, output: 9, tier: { type: "context", size: 777_777 } }] } } } } }).m!;
    expect(costOf(tokens({ input: 800_000 }), odd, 800_000).usd).toBeCloseTo(800_000 * 9 * PER_M, 12);
    expect(costOf(tokens({ input: 700_000 }), odd, 700_000).usd).toBeCloseTo(700_000 * 1 * PER_M, 12);
  });

  it("charges base rates for tokens of unknown request size, and says it guessed no tier", () => {
    const r = costOf(tokens({ input: 250_000, output: 1_000 }), HAIKU, null);
    expect(r.usd).toBeCloseTo(250_000 * 0.1e-6 + 1_000 * 0.5e-6, 12);
    expect(r.unsized).toBe(true);
    expect(r.approximate).toBe(true);
    expect(r.assumed).toBe(false);
  });

  it("is not approximate for a model with no tier whose request size is unknown", () => {
    const flat = priced(undefined);
    const r = costOf(tokens({ input: 300_000, output: 10, cacheRead: 5 }), flat, null);
    expect(r.approximate).toBe(false);
    expect(r.unsized).toBe(false);
  });

  it("assumes the input rate for a cache kind the model has no rate for", () => {
    const r = costOf(tokens({ cacheRead: 10 }), { input: 1e-6, output: 1e-6 }, null);
    expect(r.approximate).toBe(true);
    expect(r.assumed).toBe(true);
  });

  it("charges a Claude model's 1-hour writes at twice the input rate, with the base input rate when no tier applies", () => {
    const r = costOf(tokens({ cacheWrite: 1_000, cacheWrite1h: 400 }), HAIKU, 1_000);
    expect(r.usd).toBeCloseTo(600 * 0.125e-6 + 400 * 0.2e-6, 12);
    expect(r.approximate).toBe(false);
  });

  it("charges another model's 1-hour writes at its cache-write rate and calls that approximate", () => {
    const gpt = priced([{ above: 100_000, cacheWrite: 3 * PER_M }]);
    const base = costOf(tokens({ cacheWrite: 100, cacheWrite1h: 100 }), gpt, 100);
    expect(base.usd).toBeCloseTo(100 * 1.25 * PER_M, 12);
    expect(base.approximate).toBe(true);
    const tiered = costOf(tokens({ cacheWrite: 200_000, cacheWrite1h: 100 }), gpt, 200_000);
    expect(tiered.usd).toBeCloseTo(200_000 * 3 * PER_M, 12);
  });
});

describe("priceRequests: every request on its own prompt size", () => {
  const request = (t: Parameters<typeof tokens>[0]) => tokens(t);

  it("charges three 40,000-token requests at the base rates, not as one 120,000-token request", () => {
    const three = [0, 1, 2].map(() => request({ input: 40_000, output: 100 }));
    const r = priceRequests(three, HAIKU, 0);
    expect(r.requests.map((q) => q.tierAbove)).toEqual([null, null, null]);
    expect(r.usd).toBeCloseTo(3 * (40_000 * 0.1e-6 + 100 * 0.5e-6), 12);
    expect(r.usd).toBeCloseTo(costOf(tokens({ input: 120_000, output: 300 }), HAIKU, 40_000).usd, 12);
  });

  it("numbers requests in the order they were made and marks only the ones over the tier", () => {
    const r = priceRequests([request({ input: 40_000 }), request({ input: 100_001, output: 10 })], HAIKU, 0);
    expect(r.requests).toEqual([
      { number: 1, prompt: 40_000, usd: expect.closeTo(40_000 * 0.1e-6, 12), tierAbove: null },
      { number: 2, prompt: 100_001, usd: expect.closeTo(100_001 * 0.5e-6 + 10 * 2.5e-6, 12), tierAbove: 100_000 },
    ]);
    expect(r.oneHour).toBeNull();
    expect(r.approximate).toBe(false);
  });

  it("prices the 1-hour writes no request carries as a line of their own, twice the one rate every request used", () => {
    const reqs = [request({ input: 1_000, cacheWrite: 600 }), request({ input: 1_000, cacheWrite: 400 })];
    const r = priceRequests(reqs, HAIKU, 500);
    expect(r.oneHour).toEqual({ tokens: 500, usd: expect.closeTo(500 * 0.2e-6, 12) });
    // The other 500 written tokens stay at the 5-minute rate; the 1-hour ones are not charged twice.
    expect(r.usd).toBeCloseTo(2_000 * 0.1e-6 + 500 * 0.125e-6 + 500 * 0.2e-6, 12);
    expect(r.approximate).toBe(false);
  });

  it("prices them at twice the highest input rate when the requests were charged at more than one, and calls that approximate", () => {
    const reqs = [request({ input: 40_000, cacheWrite: 1_000 }), request({ input: 100_000, cacheWrite: 1_000 })];
    const r = priceRequests(reqs, HAIKU, 1_000);
    expect(r.requests.map((q) => q.tierAbove)).toEqual([null, 100_000]);
    expect(r.oneHour?.usd).toBeCloseTo(1_000 * 1.0e-6, 12);
    expect(r.approximate).toBe(true);
  });

  it("prices them at the cache-write rate of the highest tier for a model that is not Claude, always approximate", () => {
    const gpt = priced([{ above: 100_000, cacheWrite: 3 * PER_M }]);
    const reqs = [request({ input: 40_000, cacheWrite: 1_000 }), request({ input: 150_000, cacheWrite: 1_000 })];
    const r = priceRequests(reqs, gpt, 500);
    expect(r.oneHour?.usd).toBeCloseTo(500 * 3 * PER_M, 12);
    expect(r.approximate).toBe(true);
  });

  it("matches costOf of the one request when the turn is a single request", () => {
    const one = tokens({ input: 20_000, output: 10_000, cacheRead: 70_000, cacheWrite: 10_001 });
    const turn = priceRequests([one], HAIKU, 1_000);
    const log = costOf({ ...one, cacheWrite1h: 1_000 }, HAIKU, 100_001);
    expect(turn.usd).toBeCloseTo(log.usd, 12);
  });

  it("never counts more 1-hour writes than the requests wrote", () => {
    const r = priceRequests([request({ input: 10, cacheWrite: 100 })], HAIKU, 5_000);
    expect(r.oneHour?.tokens).toBe(100);
  });
});
