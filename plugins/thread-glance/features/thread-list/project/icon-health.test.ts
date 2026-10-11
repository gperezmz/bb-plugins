import { describe, expect, it } from "vitest";
import { IconHealth, retryDelay } from "./icon-health";

describe("retryDelay", () => {
  it("doubles from 15 s up to 10 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map(retryDelay)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
  });
});

describe("IconHealth", () => {
  it("shares one failure among every row of a project", () => {
    const health = new IconHealth();
    health.failed("p", 0, 1_000);
    health.failed("p", 0, 1_001);
    expect(health.attempt("p")).toBe(1);
    expect(health.retryAt("p", 2_000)).toBe(16_000);
    expect(health.retryAt("q", 2_000)).toBeNull();
  });

  it("waits longer after each failed retry, and is ready again once the wait has passed", () => {
    const health = new IconHealth();
    health.failed("p", 0, 0);
    expect(health.retryAt("p", 15_000)).toBeNull();
    health.failed("p", 1, 15_000);
    expect(health.retryAt("p", 16_000)).toBe(45_000);
  });

  it("forgets a failure once the icon loads", () => {
    const health = new IconHealth();
    health.failed("p", 0, 0);
    health.loaded("p");
    expect(health.attempt("p")).toBe(0);
    expect(health.retryAt("p", 1)).toBeNull();
  });
});
