import { describe, expect, it } from "vitest";
import { compactionLine, formatSize, linesFor, parseSize, ratesOf, snapSetting, SUMMARY_TOKENS } from "./line";

// Opus 5.5's list prices per token: $5 input, $25 output per million.
const opus = { input: 5e-6, output: 25e-6, cacheRead: 0.5e-6, cacheWrite: 6.25e-6, cacheWrite1h: 10e-6 };

describe("compactionLine", () => {
  it("is the smallest context that repays compacting N times over", () => {
    const rates = ratesOf(opus, "1h");
    const line = compactionLine({ rates, k: 3, p: 40_000, n: 2, window: 1_000_000 })!;
    const holds = (c: number) => (rates.w + 3 * rates.r) * (c - 40_000) >= 2 * (rates.r * c + rates.o * SUMMARY_TOKENS);
    expect(holds(line)).toBe(true);
    expect(holds(line - 1)).toBe(false);
    expect(formatSize(line)).toBe("139k");
  });

  it("is never when no context up to the window satisfies it", () => {
    const rates = ratesOf(opus, "5m");
    expect(compactionLine({ rates, k: 3, p: 40_000, n: 10, window: 1_000_000 })).toBeNull();
    expect(compactionLine({ rates, k: 3, p: 40_000, n: 2, window: 50_000 })).toBeNull();
  });

  it("rises with the setting", () => {
    const lines = linesFor({ rates: ratesOf(opus, "1h"), k: 3, p: 40_000, window: 1_000_000 });
    const known = lines.filter((l): l is number => l !== null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(lines).toHaveLength(10);
  });

  it("refuses a setting outside 1–10", () => {
    expect(() => compactionLine({ rates: ratesOf(opus, "1h"), k: 3, p: 0, n: 11, window: 1 })).toThrow(RangeError);
  });
});

describe("ratesOf", () => {
  it("takes Anthropic's multiples of input where the list leaves a rate out", () => {
    expect(ratesOf({ input: 1, output: 5 }, "5m")).toEqual({ w: 1.25, r: 0.1, o: 5 });
    expect(ratesOf({ input: 1, output: 5 }, "1h")).toEqual({ w: 2, r: 0.1, o: 5 });
  });
});

describe("parseSize and snapSetting", () => {
  it("reads k and m suffixes", () => {
    expect(parseSize("500k")).toBe(500_000);
    expect(parseSize("0.5m")).toBe(500_000);
    expect(parseSize("1,2M")).toBe(1_200_000);
    expect(parseSize("140 000")).toBe(140_000);
    expect(parseSize("lots")).toBeNull();
  });

  it("snaps to the setting with the nearest line", () => {
    const lines = [100_000, 150_000, 220_000, null, null, null, null, null, null, null];
    expect(snapSetting(160_000, lines)).toBe(2);
    expect(snapSetting(500_000, lines)).toBe(3);
    expect(snapSetting(10, [null, null])).toBe(1);
  });

  it("formats to the nearest thousand", () => {
    expect(formatSize(139_048)).toBe("139k");
    expect(formatSize(1_000_000)).toBe("1M");
    expect(formatSize(1_250_000)).toBe("1.25M");
    expect(formatSize(null)).toBe("never");
  });
});
