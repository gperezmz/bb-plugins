import { describe, expect, it } from "vitest";
import { IconHealth, retryDelay } from "./icon-health";

describe("retryDelay", () => {
  it("doubles from 15 s up to 10 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map(retryDelay)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
  });
});

describe("IconHealth", () => {
  it("waits longer after each failure in a row, per project", () => {
    const health = new IconHealth();
    expect([health.failed("p"), health.failed("p"), health.failed("q")]).toEqual([15_000, 30_000, 15_000]);
  });

  it("forgets a project's failures once its icon loads", () => {
    const health = new IconHealth();
    health.failed("p");
    health.loaded("p");
    expect(health.failed("p")).toBe(15_000);
  });
});
