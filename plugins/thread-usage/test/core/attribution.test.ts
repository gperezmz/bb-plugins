import { describe, expect, it } from "vitest";
import {
  attributionState,
  billingMode,
  describeState,
  PENDING_MS,
  routingFrom,
  type AttributionInput,
} from "../../src/core/attribution";
import { T0 } from "./fixtures";

const base: AttributionInput = {
  adapter: "litellm",
  providerId: "claude-code",
  routing: { kind: "unknown" },
  hasRows: false,
  hasTurns: true,
  hasOutputTokens: true,
  idleSince: T0,
  now: T0 + PENDING_MS,
};
const state = (p: Partial<AttributionInput>) => attributionState({ ...base, ...p });

describe("attributionState, rules top to bottom", () => {
  it("no-adapter beats everything", () => {
    expect(state({ adapter: "none", providerId: "acp-cursor", hasRows: true })).toBe("no-adapter");
  });

  it("unsupported for Cursor", () => {
    expect(state({ providerId: "acp-cursor" })).toBe("unsupported");
  });

  it("account-pool, then not-routed, from routing facts", () => {
    expect(state({ routing: { kind: "account-pool" } })).toBe("account-pool");
    expect(state({ routing: { kind: "other-host", host: "api.example.test" } })).toBe("not-routed");
  });

  it("pending while the thread has turns, no rows, and has been idle < 60 s (or runs)", () => {
    expect(state({ idleSince: T0 + 1 })).toBe("pending");
    expect(state({ idleSince: null })).toBe("pending");
  });

  it("tagged once rows exist", () => {
    expect(state({ hasRows: true, idleSince: null })).toBe("tagged");
  });

  it("untagged after 60 s idle with output tokens and no rows", () => {
    expect(state({})).toBe("untagged");
    expect(state({ hasOutputTokens: false })).not.toBe("untagged");
  });

  it("no-usage, not pending forever, once idle 60 s with no output tokens (a failed turn)", () => {
    expect(state({ hasOutputTokens: false })).toBe("no-usage");
    expect(describeState("no-usage", {})).toBeNull();
  });

  it("tagged is sticky: a later turn without rows does not make the thread untagged", () => {
    // Rows exist from earlier turns; the newest turn has none and the thread has been idle long.
    expect(state({ hasRows: true, idleSince: T0 - 10 * PENDING_MS })).toBe("tagged");
  });

  it("rows beat a routing fact (spec ambiguity: the table lists account-pool above tagged)", () => {
    expect(state({ hasRows: true, routing: { kind: "account-pool" } })).toBe("tagged");
  });

  it("describes each state in plain words", () => {
    expect(describeState("unsupported", {})).toBe("No token or cost data for Cursor");
    expect(describeState("account-pool", {})).toBe("Not via gateway: account pool");
    expect(describeState("not-routed", { host: "api.example.test" })).toBe("Not via gateway: requests go to api.example.test");
    expect(describeState("pending", {})).toBe("Waiting for gateway spend…");
    expect(describeState("untagged", { providerId: "codex" })).toMatch(/not tagged.*Codex config/);
    expect(describeState("tagged", {})).toBeNull();
  });
});

describe("routingFrom", () => {
  it("reads account pool, the gateway host, another host, or unknown", () => {
    const gw = "https://gw.example.test";
    expect(routingFrom([{ name: "ANTHROPIC_BASE_URL", source: "plugin:account-pool", value: null }], gw)).toEqual({ kind: "account-pool" });
    expect(routingFrom([{ name: "ANTHROPIC_BASE_URL", source: "shell", value: "https://gw.example.test/anthropic" }], gw)).toEqual({ kind: "gateway" });
    expect(routingFrom([{ name: "CODEX_OPENAI_BASE_URL", source: "shell", value: "https://api.example.test/v1" }], gw)).toEqual({ kind: "other-host", host: "api.example.test" });
    expect(routingFrom([{ name: "ANTHROPIC_BASE_URL", source: "shell", value: null }], gw)).toEqual({ kind: "unknown" });
    expect(routingFrom([], gw)).toEqual({ kind: "unknown" });
  });
});

describe("billingMode, in order (scenario 14)", () => {
  it("gateway when tagged, whatever the setting says", () => {
    expect(billingMode({ state: "tagged", setting: "subscription", rateLimitKind: "subscription-window" })).toBe("gateway");
  });

  it("a per-provider setting other than auto wins over signals", () => {
    expect(billingMode({ state: "account-pool", setting: "api-key", rateLimitKind: "subscription-window" })).toBe("api-key");
  });

  it("subscription for account-pool, then from rate-limit kind, else unknown", () => {
    expect(billingMode({ state: "account-pool", setting: "auto", rateLimitKind: "spend-control" })).toBe("subscription");
    expect(billingMode({ state: "no-adapter", setting: "auto", rateLimitKind: "subscription-window" })).toBe("subscription");
    expect(billingMode({ state: "no-adapter", setting: "auto", rateLimitKind: "spend-control" })).toBe("api-key");
    expect(billingMode({ state: "no-adapter", setting: "auto", rateLimitKind: "credits" })).toBe("api-key");
    expect(billingMode({ state: "no-adapter", setting: "auto", rateLimitKind: "unknown" })).toBe("unknown");
    expect(billingMode({ state: "no-adapter", setting: "auto", rateLimitKind: null })).toBe("unknown");
  });
});
