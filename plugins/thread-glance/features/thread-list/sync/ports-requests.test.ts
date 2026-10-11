// The window's ports refresh (AC3, AC9): after each read completes while the
// page is visible, at once when it is shown again, one call at a time, and a
// failed read keeps the snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortsSnapshot } from "@/shared/ports";
import { endPluginLifetime } from "./lifetime";
import { pluginData } from "./plugin-data";
import { followPorts, PORTS_REFRESH_MS, requestPorts, type PortsPage } from "./ports-requests";

const snapshotAt = (version: number, port = 5173): { epoch: string; version: number; value: PortsSnapshot } => ({
  epoch: "e",
  version,
  value: {
    at: version,
    environments: { env: { hostId: "h", listeners: [{ port, address: "127.0.0.1", process: "node", pid: 1, startedAt: 1, ownerThreadId: null, container: null }] } },
    failedHosts: [],
  },
});

/** A page the test shows and hides. */
function fakePage(visible = true) {
  const listeners = new Set<() => void>();
  const page: PortsPage & { show(): void; hide(): void; listening(): number } = {
    isVisible: () => visible,
    onVisibilityChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show() {
      visible = true;
      for (const listener of [...listeners]) listener();
    },
    hide() {
      visible = false;
      for (const listener of [...listeners]) listener();
    },
    listening: () => listeners.size,
  };
  return page;
}

beforeEach(() => {
  endPluginLifetime();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function fakeRpc(answer: (fresh: boolean, call: number) => Promise<unknown> | unknown) {
  const calls: boolean[] = [];
  const rpc = {
    call: vi.fn(async (_method: string, input: { fresh: boolean }) => {
      calls.push(input.fresh);
      return answer(input.fresh, calls.length);
    }),
  };
  return { rpc: rpc as never, calls };
}

describe("followPorts", () => {
  it("reads at once, then 10 s after each read completes", async () => {
    const { rpc, calls } = fakeRpc((_, call) => snapshotAt(call));
    const stop = followPorts(rpc, fakePage());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([false]);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([false, false]);
    stop();
  });

  it("counts the 10 s from the end of a slow read", async () => {
    let release!: () => void;
    const { rpc, calls } = fakeRpc((_, call) => (call === 1 ? new Promise<void>((resolve) => (release = resolve)).then(() => snapshotAt(1)) : snapshotAt(call)));
    const stop = followPorts(rpc, fakePage());
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 3);
    expect(calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    stop();
  });

  it("stops while the page is hidden and reads again, fresh, at once when it is shown", async () => {
    const { rpc, calls } = fakeRpc((_, call) => snapshotAt(call));
    const page = fakePage();
    const stop = followPorts(rpc, page);
    await vi.advanceTimersByTimeAsync(0);
    page.hide();
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 5);
    expect(calls).toEqual([false]);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS);
    expect(calls).toEqual([false, true, false]);
    stop();
  });

  it("starts nothing on a hidden page until it is shown", async () => {
    const { rpc, calls } = fakeRpc(() => snapshotAt(1));
    const page = fakePage(false);
    const stop = followPorts(rpc, page);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 2);
    expect(calls).toEqual([]);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([true]);
    stop();
  });

  it("does not schedule after a read that finishes once the page is hidden", async () => {
    let release!: () => void;
    const { rpc, calls } = fakeRpc(() => new Promise<void>((resolve) => (release = resolve)).then(() => snapshotAt(1)));
    const page = fakePage();
    const stop = followPorts(rpc, page);
    await vi.advanceTimersByTimeAsync(0);
    page.hide();
    release();
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 3);
    expect(calls).toHaveLength(1);
    stop();
  });

  it("stops its timer and its listener when the keeper unmounts", async () => {
    const { rpc, calls } = fakeRpc(() => snapshotAt(1));
    const page = fakePage();
    const stop = followPorts(rpc, page);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(page.listening()).toBe(0);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS * 3);
    expect(calls).toHaveLength(1);
  });

  it("keeps the last snapshot when a read fails, and goes on", async () => {
    const { rpc, calls } = fakeRpc((_, call) => {
      if (call === 2) throw new Error("down");
      return snapshotAt(call, 3000 + call);
    });
    const stop = followPorts(rpc, fakePage());
    await vi.advanceTimersByTimeAsync(0);
    const held = pluginData.get().ports;
    expect(held?.value.environments.env!.listeners[0]!.port).toBe(3001);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS);
    expect(calls).toHaveLength(2);
    expect(pluginData.get().ports).toBe(held);
    await vi.advanceTimersByTimeAsync(PORTS_REFRESH_MS);
    expect(pluginData.get().ports?.value.environments.env!.listeners[0]!.port).toBe(3003);
    stop();
  });
});

describe("requestPorts", () => {
  it("runs one call at a time, and once more, fresh, for a fresh request that came meanwhile", async () => {
    let release!: () => void;
    const { rpc, calls } = fakeRpc((_, call) => (call === 1 ? new Promise<void>((resolve) => (release = resolve)).then(() => snapshotAt(1)) : snapshotAt(call)));
    const first = requestPorts(rpc, false);
    const second = requestPorts(rpc, false);
    const third = requestPorts(rpc, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([false]);
    release();
    await Promise.all([first, second, third]);
    expect(calls).toEqual([false, true]);
  });

  it("ignores an answer that is not a snapshot", async () => {
    const { rpc } = fakeRpc(() => ({ nonsense: true }));
    await requestPorts(rpc, false);
    expect(pluginData.get().ports).toBeNull();
  });

  it("keeps the higher version of an epoch", async () => {
    await requestPorts(fakeRpc(() => snapshotAt(5)).rpc, false);
    await requestPorts(fakeRpc(() => snapshotAt(3, 9999)).rpc, false);
    expect(pluginData.get().ports?.version).toBe(5);
  });
});
