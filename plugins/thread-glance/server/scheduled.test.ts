import { describe, expect, it } from "vitest";
import type { ScheduledSignal } from "../shared/contract";
import { createScheduledTracker, type QueuedRow } from "./scheduled";

function setup(start = 1_000) {
  let clock = start;
  const published: ScheduledSignal[] = [];
  const tracker = createScheduledTracker({
    publish: (signal) => published.push(signal),
    now: () => clock,
  });
  return { tracker, published, advance: (ms: number) => (clock += ms) };
}

const row = (id: string, threadId: string, sendAt: number | null): QueuedRow => ({
  id,
  threadId,
  sendAt,
});

describe("scheduled tracker", () => {
  it("reports error until the first seed succeeds", async () => {
    const { tracker } = setup();
    expect(await tracker.snapshot()).toEqual({ status: "error", scheduled: {} });
    await tracker.seed(async () => [row("q1", "t1", 5_000)]);
    expect(await tracker.snapshot()).toEqual({ status: "ready", scheduled: { t1: 5_000 } });
  });

  it("keeps the earliest future sendAt per thread and ignores past or null ones", async () => {
    const { tracker } = setup();
    await tracker.seed(async () => [
      row("q1", "t1", 9_000),
      row("q2", "t1", 4_000),
      row("q3", "t2", 500),
      row("q4", "t3", null),
    ]);
    expect((await tracker.snapshot()).scheduled).toEqual({ t1: 4_000 });
  });

  it("updates on queued, dispatched, cancelled and thread removal, publishing only changes", async () => {
    const { tracker, published } = setup();
    await tracker.seed(async () => []);
    tracker.queued(row("q1", "t1", 5_000));
    tracker.queued(row("q2", "t2", 6_000));
    tracker.queued(row("q9", "t9", null));
    tracker.queued(row("q1", "t1", null));
    tracker.removed("q2");
    tracker.queued(row("q3", "t3", 7_000));
    tracker.threadGone("t3");
    expect(published.map((signal) => signal.scheduled)).toEqual([
      {},
      { t1: 5_000 },
      { t1: 5_000, t2: 6_000 },
      { t2: 6_000 },
      {},
      { t3: 7_000 },
      {},
    ]);
  });

  it("drops rows lazily once their sendAt passes", async () => {
    const { tracker, advance } = setup();
    await tracker.seed(async () => [row("q1", "t1", 2_000)]);
    advance(5_000);
    expect((await tracker.snapshot()).scheduled).toEqual({});
  });

  it("applies changes that arrive during a seed on top of its result", async () => {
    const { tracker } = setup();
    let release!: (rows: QueuedRow[]) => void;
    const seeded = tracker.seed(() => new Promise((resolve) => (release = resolve)));
    tracker.queued(row("q2", "t2", 8_000));
    tracker.removed("q1");
    release([row("q1", "t1", 5_000)]);
    await seeded;
    expect(await tracker.snapshot()).toEqual({ status: "ready", scheduled: { t2: 8_000 } });
  });

  it("stays at error without publishing when the seed fails", async () => {
    const { tracker, published } = setup();
    expect(
      await tracker.seed(async () => {
        throw new Error("down");
      }),
    ).toBe(false);
    expect(published).toEqual([]);
  });
});
