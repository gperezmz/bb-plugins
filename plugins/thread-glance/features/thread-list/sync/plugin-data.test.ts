// The plugin's data in a window: the first draw from the browser's cache,
// settings that default until the server's arrive, and the newest version of
// each whole value.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parkedRow } from "@/shared/lifecycle";
import { DEFAULT_SETTINGS } from "@/shared/settings";
import { createDeviceStorage, type StorageLike } from "../storage/device-storage";
import { endPluginLifetime } from "./lifetime";
import { pluginData, type SyncAnswer } from "./plugin-data";

function memory(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

const settings = (patch = {}, version = 1) => ({ epoch: "e1", version, value: { ...DEFAULT_SETTINGS, ...patch } });
const answer = (patch: Partial<SyncAnswer> = {}): SyncAnswer => ({
  epoch: "e1",
  revision: 1,
  full: true,
  records: { a: { lifecycle: parkedRow(5) } },
  settings: settings(),
  order: { epoch: "e1", version: 1, value: ["a"] },
  appearance: { epoch: "e1", version: 1, value: { colours: {}, icons: {} } },
  ...patch,
});

beforeEach(() => endPluginLifetime());

describe("the first draw", () => {
  it("uses the defaults, Inactive on, until the server's settings arrive", () => {
    expect(pluginData.settings().inactiveShelf).toBe(true);
    pluginData.synced(answer({ settings: settings({ inactiveShelf: false }) }));
    expect(pluginData.settings().inactiveShelf).toBe(false);
  });

  it("shows what the browser cached, then replaces it with the server's answer", () => {
    const storage = memory();
    const device = createDeviceStorage(storage);
    device.write("cache.rows", { z: parkedRow(1) });
    device.write("cache.order", ["z"]);
    device.write("cache.settings", { ...DEFAULT_SETTINGS, hoursBeforeInactive: 12 });
    pluginData.hydrate(device);
    expect(pluginData.get().cached).toBe(true);
    expect(Object.keys(pluginData.get().records.lifecycle)).toEqual(["z"]);
    expect(pluginData.get().order!.value).toEqual(["z"]);
    expect(pluginData.settings().hoursBeforeInactive).toBe(12);
    pluginData.synced(answer());
    expect(pluginData.get().cached).toBe(false);
    expect(Object.keys(pluginData.get().records.lifecycle)).toEqual(["a"]);
    expect(pluginData.get().order!.value).toEqual(["a"]);
    // The server's settings replace the cached ones even at version 1.
    expect(pluginData.settings().hoursBeforeInactive).toBe(DEFAULT_SETTINGS.hoursBeforeInactive);
  });

  it("removes the keys an earlier version stored under, and leaves every other key", () => {
    const storage = memory();
    storage.items.set("bb.thread-glance.client.v1", "{}");
    storage.items.set("bb.thread-glance.preferences.v1", "{}");
    storage.items.set("somebody-else", "kept");
    pluginData.hydrate(createDeviceStorage(storage));
    expect([...storage.items.keys()]).toEqual(["somebody-else"]);
  });

  it("writes the cache after a change, once the burst is over", () => {
    vi.useFakeTimers();
    const storage = memory();
    pluginData.hydrate(createDeviceStorage(storage));
    pluginData.synced(answer());
    pluginData.signal({ epoch: "e1", revision: 2, records: { b: { lifecycle: parkedRow(7) } } });
    expect(storage.items.size).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(JSON.parse(storage.items.get("thread-glance:cache.rows")!)).toHaveProperty("b");
    vi.useRealTimers();
  });
});

describe("whole values", () => {
  it("keeps the highest version within an epoch and takes a new epoch whole", () => {
    pluginData.synced(answer({ settings: settings({ hoursBeforeInactive: 9 }, 5) }));
    pluginData.settingsSignal(settings({ hoursBeforeInactive: 3 }, 4));
    expect(pluginData.settings().hoursBeforeInactive).toBe(9);
    pluginData.settingsSignal(settings({ hoursBeforeInactive: 4 }, 6));
    expect(pluginData.settings().hoursBeforeInactive).toBe(4);
    pluginData.settingsSignal({ epoch: "e2", version: 1, value: { ...DEFAULT_SETTINGS, hoursBeforeInactive: 2 } });
    expect(pluginData.settings().hoursBeforeInactive).toBe(2);
    pluginData.orderSignal({ epoch: "e2", version: 1, value: ["x"] });
    expect(pluginData.get().order!.value).toEqual(["x"]);
  });
});

describe("keeping current", () => {
  it("asks for a sync once realtime is up, and again after it was down", () => {
    expect(pluginData.connection("connecting")).toBeNull();
    expect(pluginData.connection("connected")).toBe("missed");
    const stop = pluginData.follow();
    pluginData.synced(answer());
    expect(pluginData.get().status).toBe("current");
    expect(pluginData.connection("connected")).toBeNull();
    stop();
    expect(pluginData.get().status).toBe("waiting");
  });

  it("holds a signal that comes before the first answer", () => {
    expect(pluginData.signal({ epoch: "e1", revision: 9, records: { q: { lifecycle: parkedRow(3) } } })).toBe(true);
    pluginData.synced(answer({ revision: 5 }));
    expect(Object.keys(pluginData.get().records.lifecycle).sort()).toEqual(["a", "q"]);
  });

  it("asks for a full sync for a signal from another epoch", () => {
    pluginData.synced(answer());
    expect(pluginData.signal({ epoch: "e9", revision: 1, records: {} })).toBe(false);
  });
});
