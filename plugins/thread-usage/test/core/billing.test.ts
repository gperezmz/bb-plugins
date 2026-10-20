import { describe, expect, it } from "vitest";
import { billingMode, routedThroughAccountPool } from "../../src/core/billing";

describe("routedThroughAccountPool", () => {
  it("is true when bb's account-pool plugin sets a base URL for the thread", () => {
    expect(routedThroughAccountPool([{ name: "ANTHROPIC_BASE_URL", source: "plugin:account-pool", value: null }])).toBe(true);
    expect(routedThroughAccountPool([{ name: "CODEX_OPENAI_BASE_URL", source: "plugin:account-pool", value: "https://pool.example.test" }])).toBe(true);
  });

  it("is false for any other source, any other variable, or no facts", () => {
    expect(routedThroughAccountPool([{ name: "ANTHROPIC_BASE_URL", source: "shell", value: "https://api.example.test" }])).toBe(false);
    expect(routedThroughAccountPool([{ name: "SOME_TOKEN", source: "plugin:account-pool", value: null }])).toBe(false);
    expect(routedThroughAccountPool([])).toBe(false);
  });
});

describe("billingMode, in order", () => {
  const input = { setting: "auto", accountPool: false, rateLimitKind: null } as const;

  it("a per-provider setting other than auto wins over signals", () => {
    expect(billingMode({ ...input, setting: "api-key", accountPool: true, rateLimitKind: "subscription-window" })).toBe("api-key");
    expect(billingMode({ ...input, setting: "subscription", rateLimitKind: "spend-control" })).toBe("subscription");
  });

  it("subscription for the account pool, then from the rate-limit kind, else unknown", () => {
    expect(billingMode({ ...input, accountPool: true, rateLimitKind: "spend-control" })).toBe("subscription");
    expect(billingMode({ ...input, rateLimitKind: "subscription-window" })).toBe("subscription");
    expect(billingMode({ ...input, rateLimitKind: "spend-control" })).toBe("api-key");
    expect(billingMode({ ...input, rateLimitKind: "credits" })).toBe("api-key");
    expect(billingMode({ ...input, rateLimitKind: "unknown" })).toBe("unknown");
    expect(billingMode(input)).toBe("unknown");
  });
});
