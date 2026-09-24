import { describe, expect, it } from "vitest";
import { familyContext, familyTags, formatAgo, formatCount, formatExactTokens, priceSourceLabel, pricesLabel, sourceMix, usualBilling } from "../../src/core/format";
import type { PricesInfo, TopFamily } from "../../src/core/report-types";

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

  it("says when public prices were updated", () => {
    expect(pricesLabel(info(), NOW)).toBe("Estimated with public list prices, updated 3 hours ago");
    // Worked out against the given time, so a panel left open keeps counting.
    expect(pricesLabel(info(), NOW + 5 * 24 * HOUR)).toBe("Estimated with public list prices, updated 5 days ago");
  });

  it("says plainly that prices older than a week may be out of date, and why they are", () => {
    const text = pricesLabel(info({ updatedAt: NOW - 9 * 24 * HOUR, lastError: "LiteLLM: HTTP 503" }), NOW);
    expect(pricesLabel(info({ updatedAt: NOW - 6 * 24 * HOUR }), NOW)).not.toContain("out of date");
    expect(text).toContain("last updated 9 days ago");
    expect(text).toContain("more than a week old and may be out of date");
    expect(text).toContain("LiteLLM: HTTP 503");
  });

  it("says so when only the bundled list was ever available", () => {
    expect(pricesLabel(info({ updatedAt: null, stale: true }), NOW)).toContain("bundled with the plugin (2026-05-01)");
    expect(pricesLabel(info({ updatedAt: null, stale: true, refreshOn: false }), NOW)).toContain("Online updates are off");
  });

  it("names the source and fetch time of one model's price", () => {
    expect(priceSourceLabel({ source: "models.dev", as: "x", fetchedAt: NOW - 2 * HOUR }, NOW)).toBe(
      "models.dev public list, fetched 2 hours ago, as x",
    );
    expect(priceSourceLabel({ source: "override", as: "x", fetchedAt: null }, NOW)).toBe("Your price override, as x");
    expect(priceSourceLabel(undefined, NOW)).toContain("No public price");
  });
});

describe("ranked family rows", () => {
  const row = (billing: TopFamily["billing"], unpriced = false) => ({
    billing,
    headline: { unpricedNote: unpriced ? "+ 2k unpriced tokens" : null } as TopFamily["headline"],
  });

  it("names a single cost source without repeating its amount", () => {
    expect(sourceMix({ gateway: 0, harness: 0, estimate: 1.5 })).toBe("estimate");
    expect(sourceMix({ gateway: 1, harness: 0, estimate: 0.25 })).toBe("$1.00 (gateway) + $0.25 (estimate)");
  });

  it("takes the billing most families share as the list's usual one", () => {
    expect(usualBilling([])).toBeNull();
    expect(usualBilling([row("gateway"), row("subscription"), row("subscription")])).toBe("subscription");
  });

  it("tags only a family whose billing differs from the usual one, or that has unpriced tokens", () => {
    expect(familyTags(row("subscription"), "subscription")).toEqual([]);
    expect(familyTags(row("gateway"), "subscription")).toEqual(["gateway"]);
    expect(familyTags(row("mixed", true), "subscription")).toEqual(["mixed billing", "partly unpriced"]);
    expect(familyTags(row("subscription", true), "subscription")).toEqual(["partly unpriced"]);
  });

  it("gives project, thread count and last activity, leaving out what is missing", () => {
    const now = 10 * 3_600_000;
    const at = now - 2 * 3_600_000;
    expect(familyContext({ descendants: 2, lastActivityAt: at }, { projectName: "Alpha", countThreads: true, now })).toEqual([
      "Alpha",
      "3 threads",
      "2 hours ago",
    ]);
    expect(familyContext({ descendants: 0, lastActivityAt: at }, { projectName: "Alpha", countThreads: true, now })).toEqual([
      "Alpha",
      "2 hours ago",
    ]);
    expect(familyContext({ descendants: 4, lastActivityAt: null }, { projectName: null, countThreads: false, now })).toEqual([]);
  });
});
