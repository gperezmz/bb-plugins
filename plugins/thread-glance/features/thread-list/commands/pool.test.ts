// The bounded pool: every item runs once, never more than the limit at once,
// each next item starting only as one before it settles.
import { expect, it } from "vitest";
import { inPool } from "./pool";

it("runs every item once, at most the limit at a time, past failures", async () => {
  const running = new Map<number, { resolve(): void; reject(error: Error): void }>();
  let peak = 0;
  const started: number[] = [];
  const items = Array.from({ length: 20 }, (_, index) => index);
  const done = inPool(items, 6, (item) =>
    new Promise<void>((resolve, reject) => {
      started.push(item);
      running.set(item, { resolve, reject });
      peak = Math.max(peak, running.size);
    }),
  );
  const flush = async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
  };
  await flush();
  expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  // Settle the oldest one at a time: each frees exactly one slot, failed or not.
  let settled = 0;
  while (running.size > 0) {
    const [item, settle] = running.entries().next().value!;
    running.delete(item);
    if (item % 5 === 0) settle.reject(new Error("failed"));
    else settle.resolve();
    settled += 1;
    await flush();
    expect(running.size).toBe(Math.min(6, items.length - settled));
  }
  await done;
  expect(peak).toBe(6);
  expect(started).toEqual(items);
});
