import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatCount,
  formatExactTokens,
  priceSourceLabel,
  priceSourceName,
  pricesLabel,
  tierHint,
  tierMark,
  tierSummary,
  topText,
  treeContext,
  treeTags,
  usualBilling,
} from "../../src/core/format";
import type { PricesInfo, TopTree } from "../../src/core/report-types";
import type { TierDetail } from "../../src/core/summary";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 12);
const info = (over: Partial<PricesInfo> = {}): PricesInfo => ({
  updatedAt: NOW - 3 * HOUR,
  bundledDate: "2026-05-01T00:00:00Z",
  refreshOn: true,
  stale: false,
  lastError: null,
  ...over,
});

describe("whole-number grouping", () => {
  it("groups counts and exact tokens the same way", () => {
    expect(formatCount(36_666)).toBe("36,666");
    expect(formatCount(10)).toBe("10");
    expect(formatCount(1_471_556_869)).toBe("1,471,556,869");
    expect(formatExactTokens(1_471_556_869)).toBe(formatCount(1_471_556_869));
  });
});

describe("price freshness wording", () => {
  it("formats relative times", () => {
    expect(formatAgo(10_000)).toBe("just now");
    expect(formatAgo(60_000)).toBe("1 minute ago");
    expect(formatAgo(3 * HOUR)).toBe("3 hours ago");
    expect(formatAgo(50 * HOUR)).toBe("2 days ago");
  });

  it("names models.dev and says when the list was fetched", () => {
    expect(pricesLabel(info(), NOW)).toBe("Estimated with models.dev prices, fetched 3 hours ago");
    // Worked out against the given time, so a panel left open keeps counting.
    expect(pricesLabel(info(), NOW + 5 * 24 * HOUR)).toContain("fetched 5 days ago");
  });

  it("says plainly that a list more than a week old may be out of date", () => {
    expect(pricesLabel(info({ updatedAt: NOW - 6 * 24 * HOUR }), NOW)).not.toContain("out of date");
    const text = pricesLabel(info({ updatedAt: NOW - 9 * 24 * HOUR }), NOW);
    expect(text).toContain("fetched 9 days ago");
    expect(text).toContain("more than a week old and may be out of date");
  });

  it("says that the last refresh failed, and why, whatever the age of the list", () => {
    for (const updatedAt of [NOW - 3 * HOUR, NOW - 9 * 24 * HOUR, null]) {
      const text = pricesLabel(info({ updatedAt, lastError: "HTTP 503" }), NOW);
      expect(text).toContain("The last refresh failed: HTTP 503");
    }
  });

  it("says so when only the bundled list was ever available", () => {
    expect(pricesLabel(info({ updatedAt: null, stale: true }), NOW)).toContain("models.dev list bundled with the plugin (2026-05-01)");
    expect(pricesLabel(info({ updatedAt: null, stale: true }), NOW)).toContain("has not been fetched yet");
    expect(pricesLabel(info({ updatedAt: null, stale: true, refreshOn: false }), NOW)).toContain("Online updates are off");
  });

  it("names models.dev, never LiteLLM, whichever copy priced a model", () => {
    expect(priceSourceLabel({ source: "models.dev", as: "x", fetchedAt: NOW - 2 * HOUR }, NOW)).toBe("models.dev list, fetched 2 hours ago, as x");
    expect(priceSourceLabel({ source: "snapshot", as: "x", fetchedAt: null }, NOW)).toBe("models.dev list bundled with the plugin, as x");
    expect(priceSourceLabel(undefined, NOW)).toBe("No models.dev price for this model");
    expect(priceSourceName({ source: "models.dev", as: "x", fetchedAt: NOW })).toBe("models.dev");
    expect(priceSourceName({ source: "snapshot", as: "x", fetchedAt: null })).toBe("models.dev, bundled");
    expect(priceSourceName(undefined)).toBe("unpriced");
    for (const text of [pricesLabel(info(), NOW), pricesLabel(info({ updatedAt: null }), NOW), priceSourceLabel(undefined, NOW)]) {
      expect(text.toLowerCase()).not.toContain("litellm");
    }
  });
});

describe("tier wording", () => {
  const detail = (sizes: number[], requests = 5): TierDetail => ({
    requests,
    tiered: sizes.map((tierAbove, i) => ({ number: i + 1, prompt: tierAbove + 1, usd: 1, tierAbove })),
    untiered: { count: requests - sizes.length, usd: 0 },
    oneHour: null,
  });

  it("marks a request with the size its tier starts above", () => {
    expect(tierMark(100_000)).toBe("tier over 100,000");
    expect(tierHint(100_000)).toBe("A prompt over 100,000 tokens is charged at that tier's rates for the whole request, output included.");
  });

  it("says how many requests used the tier, naming its size when they all used the same one", () => {
    expect(tierSummary(detail([100_000], 2))).toBe("1 of 2 requests used the tier over 100,000 tokens");
    expect(tierSummary(detail([100_000, 100_000, 100_000], 40))).toBe("3 of 40 requests used the tier over 100,000 tokens");
    expect(tierSummary(detail([100_000, 200_000]))).toBe("2 of 5 requests used a tier");
  });
});

describe("ranked tree rows", () => {
  const row = (billing: TopTree["billing"], unpriced = false) => ({
    billing,
    headline: { unpricedNote: unpriced ? "+ 2k unpriced tokens" : null } as TopTree["headline"],
  });

  it("takes the billing most trees share as the list's usual one", () => {
    expect(usualBilling([])).toBeNull();
    expect(usualBilling([row("api-key"), row("subscription"), row("subscription")])).toBe("subscription");
  });

  it("tags only a tree whose billing differs from the usual one, or that has unpriced tokens", () => {
    expect(treeTags(row("subscription"), "subscription")).toEqual([]);
    expect(treeTags(row("api-key"), "subscription")).toEqual(["API key"]);
    expect(treeTags(row("mixed", true), "subscription")).toEqual(["mixed billing", "partly unpriced"]);
    expect(treeTags(row("subscription", true), "subscription")).toEqual(["partly unpriced"]);
  });

  it("gives project, thread count and last activity, leaving out what is missing", () => {
    const now = 10 * 3_600_000;
    const at = now - 2 * 3_600_000;
    expect(treeContext({ descendants: 2, lastActivityAt: at }, { projectName: "Alpha", countThreads: true, now })).toEqual([
      "Alpha",
      "3 threads",
      "2 hours ago",
    ]);
    expect(treeContext({ descendants: 0, lastActivityAt: at }, { projectName: "Alpha", countThreads: true, now })).toEqual([
      "Alpha",
      "2 hours ago",
    ]);
    expect(treeContext({ descendants: 4, lastActivityAt: null }, { projectName: null, countThreads: false, now })).toEqual([]);
  });
});

describe("topText", () => {
  const tree = (n: number, over: Partial<TopTree> = {}): TopTree => ({
    threadId: `thr_${n}`,
    title: `Tree ${n}`,
    providerId: "claude-code",
    projectId: null,
    headline: { unpricedNote: null } as TopTree["headline"],
    usd: 0,
    billedUsd: 0,
    listPriceUsd: 0,
    tokens: 0,
    descendants: 0,
    lastActivityAt: null,
    billing: "api-key",
    ...over,
  });
  const opts = { currency: "$", projectName: () => null, now: NOW };

  it("ranks the priced trees by their dollars from 1, then lists the unpriced ones apart under Not priced, from 1", () => {
    const text = topText(
      { priced: [tree(1, { usd: 12.3, tokens: 3_200_000 }), tree(2, { usd: 1, tokens: 90_000 })], notPriced: [tree(3, { tokens: 45_000 }), tree(4, { tokens: 900 })] },
      opts,
    );
    expect(text.split("\n")).toEqual([
      " 1. $12.30      3.2M tokens  Tree 1  (thr_1)",
      " 2. $1.00        90k tokens  Tree 2  (thr_2)",
      "",
      "Not priced",
      " 1.    45k tokens  Tree 3  (thr_3)",
      "      not priced",
      " 2.    900 tokens  Tree 4  (thr_4)",
      "      not priced",
    ]);
  });

  it("prints only the Not priced list when no tree has a price, and says so when there is nothing", () => {
    expect(topText({ priced: [], notPriced: [tree(3, { tokens: 45_000 })] }, opts)).toMatch(/^Not priced\n 1\. +45k tokens/);
    expect(topText({ priced: [], notPriced: [] }, opts)).toBe("No thread trees with usage in that window.");
  });
});
