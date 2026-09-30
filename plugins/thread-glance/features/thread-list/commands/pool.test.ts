// The bounded pool: every item runs once, never more than the limit at once.
import { expect, it } from "vitest";
import { inPool } from "./pool";

it("runs every item once, at most the limit at a time, past failures", async () => {
  let running = 0;
  let peak = 0;
  const ran: number[] = [];
  const items = Array.from({ length: 20 }, (_, index) => index);
  await inPool(items, 6, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running -= 1;
    ran.push(item);
    if (item % 5 === 0) throw new Error("failed");
  });
  expect(peak).toBe(6);
  expect(ran.sort((a, b) => a - b)).toEqual(items);
});
