import { describe, expect, it } from "vitest";
import { SerialQueue } from "./serial";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe("SerialQueue", () => {
  it("runs the work of one key one at a time, in the order asked for", async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const first = gate();
    const a = queue.run("k", async () => {
      log.push("a start");
      await first.opened;
      log.push("a end");
    });
    const b = queue.run("k", async () => void log.push("b"));
    await Promise.resolve();
    expect(log).toEqual(["a start"]);
    first.open();
    await Promise.all([a, b]);
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("runs the work of other keys alongside", async () => {
    const queue = new SerialQueue();
    const held = gate();
    void queue.run("one", () => held.opened);
    expect(await queue.run("two", async () => "done")).toBe("done");
    held.open();
  });

  it("starts work for an idle key within the call", () => {
    const queue = new SerialQueue();
    let started = false;
    void queue.run("k", async () => void (started = true));
    expect(started).toBe(true);
  });

  it("is busy while work runs or waits, and no longer by the time a caller awaiting it continues", async () => {
    const queue = new SerialQueue();
    const held = gate();
    const first = queue.run("k", () => held.opened);
    const second = queue.run("k", async () => undefined);
    expect(queue.busy("k")).toBe(true);
    expect(queue.busy("other")).toBe(false);
    held.open();
    await first;
    expect(queue.busy("k")).toBe(true);
    await second;
    expect(queue.busy("k")).toBe(false);
  });

  it("goes on after work that fails, and hands the failure to its own caller", async () => {
    const queue = new SerialQueue();
    const failing = queue.run("k", async () => {
      throw new Error("boom");
    });
    const after = queue.run("k", async () => "after");
    await expect(failing).rejects.toThrow("boom");
    expect(await after).toBe("after");
    expect(queue.busy("k")).toBe(false);
  });

  it("turns work that throws before returning a promise into a rejection", async () => {
    const queue = new SerialQueue();
    await expect(queue.run("k", () => { throw new Error("sync"); })).rejects.toThrow("sync");
    expect(queue.busy("k")).toBe(false);
  });
});
