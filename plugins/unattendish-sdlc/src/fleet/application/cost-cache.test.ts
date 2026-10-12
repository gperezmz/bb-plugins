import { describe, expect, it } from "vitest";
import { FakeClock, FakeCost } from "../testing/fakes";
import { CachedCost, COST_TTL_MS } from "./cost-cache";

describe("CachedCost", () => {
  it("asks once for a thread within the time it keeps an answer, and again after", async () => {
    const inner = new FakeCost();
    inner.costs.set("thr_m", { amount: 2, currency: "USD" });
    const clock = new FakeClock();
    const cost = new CachedCost(inner, clock);
    expect(await cost.costOf("thr_m")).toEqual({ amount: 2, currency: "USD" });
    clock.advance(COST_TTL_MS - 1);
    expect(await cost.costOf("thr_m")).toEqual({ amount: 2, currency: "USD" });
    expect(inner.asked).toEqual(["thr_m"]);
    clock.advance(2);
    inner.costs.set("thr_m", { amount: 3, currency: "USD" });
    expect(await cost.costOf("thr_m")).toEqual({ amount: 3, currency: "USD" });
    expect(inner.asked).toEqual(["thr_m", "thr_m"]);
  });

  it("keeps an absence as well, and each thread apart", async () => {
    const inner = new FakeCost();
    const cost = new CachedCost(inner, new FakeClock());
    expect(await cost.costOf("a")).toBeNull();
    expect(await cost.costOf("a")).toBeNull();
    await cost.costOf("b");
    expect(inner.asked).toEqual(["a", "b"]);
  });

  it("shares one question between two asked together", async () => {
    const inner = new FakeCost();
    const cost = new CachedCost(inner, new FakeClock());
    await Promise.all([cost.costOf("a"), cost.costOf("a")]);
    expect(inner.asked).toEqual(["a"]);
  });

  it("answers null when the reader throws", async () => {
    const cost = new CachedCost({ costOf: () => Promise.reject(new Error("boom")) }, new FakeClock());
    expect(await cost.costOf("a")).toBeNull();
  });
});
