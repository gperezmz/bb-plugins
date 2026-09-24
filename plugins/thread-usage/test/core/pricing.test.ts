import { describe, expect, it } from "vitest";
import {
  candidateNames,
  costOf,
  fromLiteLlmEntry,
  gatewayPricesFromModelInfo,
  parsePriceOverrides,
  priceOverridesError,
  PriceBook,
} from "../../src/core/pricing";
import { PINNED_SNAPSHOT } from "../../src/server/snapshot";
import { tokens } from "./fixtures";

const snapshot = PINNED_SNAPSHOT.models;
const OPUS_55 = snapshot["claude-opus-5-5"]!;

describe("PriceBook precedence", () => {
  it("applies aliases first: claude-opus-5 is priced at the claude-opus-5-5 snapshot rates (scenario 7)", () => {
    const book = new PriceBook({ snapshot, overrides: { aliases: { "claude-opus-5": "claude-opus-5-5" } } });
    const found = book.lookup("claude-opus-5")!;
    expect(found.model).toBe("claude-opus-5-5");
    expect(found.origin).toBe("snapshot");
    expect(found.price.input).toBe(OPUS_55.input_cost_per_token);
    expect(found.price.output).toBe(OPUS_55.output_cost_per_token);
    // Without the alias the snapshot's own claude-opus-5 entry is used.
    const plain = new PriceBook({ snapshot }).lookup("claude-opus-5")!;
    expect(plain.price.input).toBe(snapshot["claude-opus-5"]!.input_cost_per_token);
  });

  it("prefers override over gateway over snapshot", () => {
    const gateway = { "claude-opus-5-5": { input: 1e-6, output: 2e-6 } };
    const snapOnly = new PriceBook({ snapshot });
    const withGateway = new PriceBook({ snapshot, gateway });
    const withOverride = new PriceBook({
      snapshot,
      gateway,
      overrides: { prices: { "claude-opus-5-5": { input: 3, output: 9 } } },
    });
    expect(snapOnly.lookup("claude-opus-5-5")!.origin).toBe("snapshot");
    expect(withGateway.lookup("claude-opus-5-5")).toMatchObject({ origin: "gateway", price: { input: 1e-6 } });
    const o = withOverride.lookup("claude-opus-5-5")!;
    expect(o.origin).toBe("override");
    // Overrides are per million tokens.
    expect(o.price.input).toBeCloseTo(3e-6, 15);
    expect(o.price.output).toBeCloseTo(9e-6, 15);
  });

  it("an override on the alias target replaces the aliased rate (scenario 7)", () => {
    const book = new PriceBook({
      snapshot,
      overrides: { aliases: { "claude-opus-5": "claude-opus-5-5" }, prices: { "claude-opus-5-5": { input: 1, output: 2 } } },
    });
    expect(book.lookup("claude-opus-5")).toMatchObject({ origin: "override", price: { input: 1e-6, output: 2e-6 } });
  });

  it("strips [1m] suffixes, case and provider prefixes", () => {
    const book = new PriceBook({ snapshot });
    for (const name of [
      "claude-opus-5-5[1m]",
      "Claude-Opus-5-5",
      "anthropic/claude-opus-5-5",
      "litellm_proxy/anthropic/claude-opus-5-5",
      "openrouter/anthropic/claude-opus-5-5",
      "claude-opus-5-5-20260101",
      "claude-opus-5-5@20260101",
    ]) {
      const found = book.lookup(name);
      expect(found, name).not.toBeNull();
      expect(found!.price.input, name).toBe(OPUS_55.input_cost_per_token);
    }
    expect(candidateNames("vertex_ai/claude-x@20250101")).toContain("claude-x-20250101");
  });

  it("returns null for an unpriced model", () => {
    const book = new PriceBook({ snapshot });
    expect(book.lookup("my-internal-model")).toBeNull();
    expect(book.lookup(null)).toBeNull();
    expect(book.lookup("  ")).toBeNull();
  });

  it("reads the gateway price map from /model/info by public and upstream name", () => {
    const map = gatewayPricesFromModelInfo({
      data: [
        {
          model_name: "team-opus",
          litellm_params: { model: "anthropic/claude-opus-5-5" },
          model_info: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
        },
        { model_name: "no-price", litellm_params: { model: "x" }, model_info: {} },
        { model_name: "null-info", model_info: null },
      ],
    });
    expect(Object.keys(map).sort()).toEqual(["anthropic/claude-opus-5-5", "team-opus"]);
    const book = new PriceBook({ snapshot, gateway: map });
    expect(book.lookup("team-opus")!.origin).toBe("gateway");
    expect(book.lookup("claude-opus-5-5")!.origin).toBe("snapshot");
    expect(book.lookup("anthropic/claude-opus-5-5")!.origin).toBe("gateway");
  });
});

describe("model name resolution never matches a neighbouring model", () => {
  const book = new PriceBook({ snapshot });

  it("prices claude-opus-5-5[1m] as claude-opus-5-5 and claude-opus-5[1m] as claude-opus-5", () => {
    const five = book.lookup("claude-opus-5[1m]")!;
    const fiveFive = book.lookup("claude-opus-5-5[1m]")!;
    expect(five.model).toBe("claude-opus-5");
    expect(fiveFive.model).toBe("claude-opus-5-5");
    expect(fiveFive.price.input).toBe(snapshot["claude-opus-5-5"]!.input_cost_per_token);
    expect(five.price.input).toBe(snapshot["claude-opus-5"]!.input_cost_per_token);
    expect(fiveFive.price.input).not.toBe(five.price.input);
  });

  it("leaves a model with no exact entry unpriced instead of taking a longer or shorter name's price", () => {
    expect(book.lookup("claude-opus-5-5-preview-x")).toBeNull();
    expect(book.lookup("claude-opus-5-9")).toBeNull();
    expect(book.lookup("claude-opus")).toBeNull();
  });

  it("strips a provider prefix and a date, and nothing else", () => {
    expect(book.lookup("github-copilot/gemini-3.8-flash")?.model).toBe("gemini-3.8-flash");
    expect(book.lookup("anthropic/claude-opus-5-5")?.model).toBe("claude-opus-5-5");
    expect(book.lookup("claude-haiku-4-5-20251001")?.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("costOf", () => {
  it("uses the 5-minute write rate unless 1-hour writes are split out, read from _above_1hr", () => {
    // A made-up 1h rate that is not a multiple of the input rate: nothing is hard-coded.
    const price = fromLiteLlmEntry({
      input_cost_per_token: 1e-6,
      output_cost_per_token: 5e-6,
      cache_read_input_token_cost: 1e-7,
      cache_creation_input_token_cost: 1.25e-6,
      cache_creation_input_token_cost_above_1hr: 1.7e-6,
    })!;
    expect(price.cacheWrite1h).toBe(1.7e-6);
    const fiveMinOnly = costOf(tokens({ cacheWrite: 1000 }), price, null);
    expect(fiveMinOnly.usd).toBeCloseTo(1000 * 1.25e-6, 12);
    const split = costOf(tokens({ cacheWrite: 1000, cacheWrite1h: 400 }), price, null);
    expect(split.usd).toBeCloseTo(600 * 1.25e-6 + 400 * 1.7e-6, 12);
    expect(split.approximate).toBe(false);
  });

  it("flags approximate when a 1-hour write has no 1-hour rate", () => {
    const price = { input: 1e-6, output: 5e-6, cacheRead: 1e-7, cacheWrite: 1.25e-6 };
    const r = costOf(tokens({ cacheWrite: 100, cacheWrite1h: 100 }), price, null);
    expect(r.approximate).toBe(true);
    expect(r.usd).toBeCloseTo(100 * 1.25e-6, 12);
  });

  it("applies tiers only with a request size; without one it uses the base rate and flags approximate", () => {
    const sonnet = fromLiteLlmEntry(snapshot["claude-sonnet-4-5"]!)!;
    expect(sonnet.tiers?.[0]?.above).toBe(200_000);
    const t = tokens({ input: 250_000, output: 1000 });
    const base = 250_000 * sonnet.input + 1000 * sonnet.output;
    const tier = sonnet.tiers![0]!;
    const noSize = costOf(t, sonnet, null);
    expect(noSize.usd).toBeCloseTo(base, 10);
    expect(noSize.approximate).toBe(true);
    const big = costOf(t, sonnet, 250_000);
    expect(big.usd).toBeCloseTo(250_000 * tier.input! + 1000 * tier.output!, 10);
    expect(big.approximate).toBe(false);
    const small = costOf(tokens({ input: 1000, output: 10 }), sonnet, 1000);
    expect(small.usd).toBeCloseTo(1000 * sonnet.input + 10 * sonnet.output, 12);
    expect(small.approximate).toBe(false);
  });

  it("does not flag approximate for a model without a tier key", () => {
    const opus = fromLiteLlmEntry(OPUS_55)!;
    expect(opus.tiers).toBeUndefined();
    const r = costOf(tokens({ input: 300_000, output: 10, cacheRead: 5 }), opus, null);
    expect(r.approximate).toBe(false);
    expect(r.usd).toBeCloseTo(300_000 * opus.input + 10 * opus.output + 5 * opus.cacheRead!, 10);
  });

  it("flags approximate when cache tokens have no cache rate", () => {
    const r = costOf(tokens({ cacheRead: 10 }), { input: 1e-6, output: 1e-6 }, null);
    expect(r.approximate).toBe(true);
  });
});

describe("price overrides setting", () => {
  it("parses empty text as no overrides and validates the shape", () => {
    expect(parsePriceOverrides("  ")).toEqual({});
    expect(priceOverridesError('{"aliases":{"a":"b"},"prices":{"m":{"input":1,"output":2}}}')).toBeNull();
    expect(priceOverridesError("{nope")).toMatch(/Not valid JSON/);
    expect(priceOverridesError('{"prices":{"m":{"input":-1,"output":2}}}')).toMatch(/prices\.m\.input/);
    expect(priceOverridesError('{"extra":1}')).not.toBeNull();
  });
});
