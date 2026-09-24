import { afterEach, describe, expect, it, vi } from "vitest";
import { RECONNECT_COOLDOWN_MS, RECONNECT_SETTLE_MS, ReconnectRechecks } from "./reconnect.js";

describe("rechecks on reconnect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rechecks a reconnected machine once it settles, and a flapping one once per cooldown, ending on its last state", async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const r = new ReconnectRechecks((id) => runs.push(id), () => Date.now());
    r.connected("laptop");
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toEqual(["laptop"]);
    // Flaps five times in the next minute: nothing until the cooldown ends, then one recheck.
    for (let i = 0; i < 5; i++) {
      r.connected("laptop");
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(runs).toEqual(["laptop"]);
    await vi.advanceTimersByTimeAsync(RECONNECT_COOLDOWN_MS);
    expect(runs).toEqual(["laptop", "laptop"]);
    // Another machine is not held back by this one's cooldown.
    r.connected("server");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toEqual(["laptop", "laptop", "server"]);
    r.dispose();
  });

  it("waits for the last of quick reconnects to settle", async () => {
    vi.useFakeTimers();
    const runs: number[] = [];
    const start = Date.now();
    const r = new ReconnectRechecks(() => runs.push(Date.now() - start), () => Date.now());
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(2_900);
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toEqual([2_900 + RECONNECT_SETTLE_MS]);
  });

  it("a machine that drops before or just after its recheck is rechecked on its next connection, without a cooldown", async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const r = new ReconnectRechecks((id) => runs.push(id), () => Date.now());
    // Drops before the recheck: it never runs against the offline machine.
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(2_000);
    r.disconnected("laptop");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toEqual([]);
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toEqual(["laptop"]);
    // Drops right after its recheck: that one may have been cut short.
    await vi.advanceTimersByTimeAsync(1_000);
    r.disconnected("laptop");
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toEqual(["laptop", "laptop"]);
    // Drops a minute after: the cooldown holds.
    await vi.advanceTimersByTimeAsync(60_000);
    r.disconnected("laptop");
    r.connected("laptop");
    await vi.advanceTimersByTimeAsync(RECONNECT_SETTLE_MS);
    expect(runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RECONNECT_COOLDOWN_MS);
    expect(runs).toHaveLength(3);
  });

  it("drops pending rechecks on dispose", async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const r = new ReconnectRechecks((id) => runs.push(id));
    r.connected("laptop");
    r.dispose();
    await vi.advanceTimersByTimeAsync(RECONNECT_COOLDOWN_MS);
    expect(runs).toEqual([]);
  });
});
