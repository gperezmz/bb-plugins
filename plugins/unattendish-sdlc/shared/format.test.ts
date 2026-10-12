import { describe, expect, it } from "vitest";
import { ageLabel, formatMoney, intervalLabel, plural, polledLabel, spanLabel } from "./format";

const NOW = "2026-10-12T12:00:00Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

describe("ages and durations", () => {
  it("spells the two largest units", () => {
    expect(spanLabel(40_000)).toBe("40s");
    expect(spanLabel(12 * 60_000)).toBe("12m");
    expect(spanLabel(70 * 60_000)).toBe("1h 10m");
    expect(spanLabel(3 * 3_600_000)).toBe("3h");
    expect(spanLabel(28 * 3_600_000)).toBe("1d 4h");
    expect(spanLabel(2 * 86_400_000)).toBe("2d");
  });

  it("ages a time by the clock it is given", () => {
    expect(ageLabel(ago(5 * 60_000), NOW)).toBe("5m");
  });

  it("reads a time in the future, or one that does not parse, as no time at all", () => {
    expect(ageLabel("2026-10-12T13:00:00Z", NOW)).toBe("0s");
    expect(ageLabel("soon", NOW)).toBe("0s");
  });

  it("says when a fleet was last polled", () => {
    expect(polledLabel(ago(40_000), NOW)).toBe("polled 40s ago");
    expect(polledLabel(null, NOW)).toBe("not polled yet");
  });

  it("spells the poll interval", () => {
    expect(intervalLabel(120_000)).toBe("every 2m");
    expect(intervalLabel(90_000)).toBe("every 90s");
  });
});

describe("money", () => {
  it("writes an amount in its currency", () => {
    expect(formatMoney(14.2, "USD")).toBe("$14.20");
  });

  it("writes a currency code Intl does not know after the number", () => {
    expect(formatMoney(3.05, "not-a-code")).toBe("3.05 not-a-code");
  });
});

describe("plural", () => {
  it("agrees the noun with the count", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(6, "day")).toBe("6 days");
  });
});
