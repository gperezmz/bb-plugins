import { describe, expect, it } from "vitest";
import { crossingKey, newCrossings } from "../../src/core/budget";

describe("newCrossings", () => {
  const totals = new Map([
    ["root", 5.2],
    ["child", 1],
  ]);

  it("reports a family at or above the amount once", () => {
    const first = newCrossings(totals, 5, new Set(), 100);
    expect(first).toEqual([{ rootThreadId: "root", amount: 5, crossedAt: 100, totalAtCrossing: 5.2 }]);
    expect(newCrossings(totals, 5, new Set([crossingKey("root", 5)]), 200)).toEqual([]);
  });

  it("is off with no amount or zero, and a new amount crosses again", () => {
    expect(newCrossings(totals, null, new Set(), 1)).toEqual([]);
    expect(newCrossings(totals, 0, new Set(), 1)).toEqual([]);
    expect(newCrossings(totals, 1, new Set([crossingKey("root", 5)]), 1).map((c) => c.rootThreadId).sort()).toEqual(["child", "root"]);
  });
});
