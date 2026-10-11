import { describe, expect, it } from "vitest";
import { inBatches } from "./batches";

describe("inBatches", () => {
  it("keeps the order of the items and never runs more than a batch at once", async () => {
    let running = 0;
    let peak = 0;
    const results = await inBatches([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return item * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it("starts the next batch only after the one before ended", async () => {
    const events: string[] = [];
    await inBatches(["a", "b", "c"], 2, async (item) => {
      events.push(`start ${item}`);
      await Promise.resolve();
      events.push(`end ${item}`);
    });
    expect(events.indexOf("start c")).toBeGreaterThan(events.indexOf("end b"));
  });

  it("resolves empty for no items and rejects with a failure", async () => {
    expect(await inBatches([], 3, async () => 1)).toEqual([]);
    await expect(inBatches([1], 3, () => Promise.reject(new Error("no")))).rejects.toThrow("no");
  });
});
