// AC28: browser storage is bounded. Lists are capped, and on a full quota the
// least important caches go first while a write that still fails drops only
// its own key.
import { describe, expect, it } from "vitest";
import { settledRow, type LifecycleRow } from "@/shared/lifecycle";
import {
  capLifecycleRows,
  INITIAL_DEVICE_STATE,
  readDeviceState,
  readOrderCache,
  readRowsCache,
  saveDeviceState,
  withGroupCollapsed,
  withParentExpanded,
  withWorktreeCollapsed,
  writeOrderCache,
  writeRowsCache,
} from "./device-state";
import { CAPS, createDeviceStorage, type StorageLike } from "./device-storage";

/** A storage that holds at most `quota` characters of values, and throws when a write would pass it. */
function limitedStorage(quota: number) {
  const items = new Map<string, string>();
  const size = () => [...items.entries()].reduce((total, [key, value]) => total + key.length + value.length, 0);
  const storage: StorageLike = {
    getItem: (key) => items.get(key) ?? null,
    setItem(key, value) {
      const without = size() - (items.has(key) ? key.length + items.get(key)!.length : 0);
      if (without + key.length + value.length > quota) throw new DOMException("full", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items };
}

describe("lists are capped", () => {
  it("keeps the last 100 parents with an open child list", () => {
    let state = INITIAL_DEVICE_STATE;
    for (let index = 0; index < 130; index += 1) state = withParentExpanded(state, `t${index}`, true);
    expect(state.expandedParents).toHaveLength(CAPS.expandedParents);
    expect(state.expandedParents[0]).toBe("t30");
    expect(state.expandedParents.at(-1)).toBe("t129");
    // Opening one again makes it the most recent rather than listing it twice.
    state = withParentExpanded(state, "t50", true);
    expect(state.expandedParents.filter((id) => id === "t50")).toHaveLength(1);
    expect(state.expandedParents.at(-1)).toBe("t50");
    state = withParentExpanded(state, "t50", false);
    expect(state.expandedParents).not.toContain("t50");
  });

  it("caps collapsed groups, and a stored list longer than its cap is cut when read", () => {
    let state = INITIAL_DEVICE_STATE;
    for (let index = 0; index < 250; index += 1) state = withGroupCollapsed(state, `p${index}`, true);
    expect(state.collapsedGroups).toHaveLength(CAPS.collapsedGroups);
    const { storage } = limitedStorage(1_000_000);
    const device = createDeviceStorage(storage);
    device.write("expandedParents", Array.from({ length: 400 }, (_, index) => `t${index}`));
    expect(readDeviceState(device).expandedParents).toHaveLength(100);
  });

  it("keeps collapsed worktree groups on the device, capped like collapsed project groups", () => {
    let state = INITIAL_DEVICE_STATE;
    for (let index = 0; index < 250; index += 1) state = withWorktreeCollapsed(state, `env${index}`, true);
    expect(state.collapsedWorktrees).toHaveLength(CAPS.collapsedWorktrees);
    expect(withWorktreeCollapsed(state, "env249", true)).toBe(state);
    expect(withWorktreeCollapsed(state, "env249", false).collapsedWorktrees).not.toContain("env249");
    const { storage } = limitedStorage(1_000_000);
    const device = createDeviceStorage(storage);
    device.write("collapsedWorktrees", ["env_x", "env_y"]);
    expect(readDeviceState(device).collapsedWorktrees).toEqual(["env_x", "env_y"]);
    expect(readDeviceState(createDeviceStorage(limitedStorage(1_000_000).storage)).collapsedWorktrees).toEqual([]);
  });

  it("caches at most 500 lifecycle rows, keeping the most recently marked, and 2,000 ids of the order", () => {
    const rows: Record<string, LifecycleRow> = {};
    for (let index = 0; index < 800; index += 1) rows[`t${index}`] = settledRow(index, "manual");
    const capped = capLifecycleRows(rows);
    expect(Object.keys(capped)).toHaveLength(CAPS.lifecycleRows);
    expect(capped.t799).toBeDefined();
    expect(capped.t0).toBeUndefined();
    const { storage } = limitedStorage(10_000_000);
    const device = createDeviceStorage(storage);
    writeRowsCache(device, rows);
    expect(Object.keys(readRowsCache(device)!)).toHaveLength(500);
    writeOrderCache(device, Array.from({ length: 5_000 }, (_, index) => `t${index}`));
    expect(readOrderCache(device)).toHaveLength(2_000);
  });

  it("reads nothing bad from damaged values", () => {
    const { storage } = limitedStorage(10_000);
    storage.setItem("thread-glance:cache.rows", "{not json");
    storage.setItem("thread-glance:activeSort", JSON.stringify("sideways"));
    const device = createDeviceStorage(storage);
    expect(readRowsCache(device)).toBeNull();
    expect(readDeviceState(device).activeSort).toBe("manual");
  });
});

describe("a full quota", () => {
  it("evicts the least important caches first and keeps what the person set", () => {
    const { storage, items } = limitedStorage(600);
    const device = createDeviceStorage(storage);
    device.write("activeSort", "activity");
    device.write("cache.order", "o".repeat(150));
    device.write("cache.appearance", "a".repeat(150));
    device.write("cache.rows", "r".repeat(150));
    expect(device.write("cache.settings", "s".repeat(120))).toBe(true);
    // Only the least important cache had to go for it to fit.
    expect(items.has("thread-glance:cache.order")).toBe(false);
    expect(items.has("thread-glance:cache.appearance")).toBe(true);
    expect(items.has("thread-glance:cache.rows")).toBe(true);
    expect(items.get("thread-glance:activeSort")).toBe('"activity"');
  });

  it("evicts further caches while the write still does not fit, never the person's own state", () => {
    const { storage, items } = limitedStorage(700);
    const device = createDeviceStorage(storage);
    device.write("collapsedShelves", { inactive: false });
    device.write("cache.order", "o".repeat(150));
    device.write("cache.appearance", "a".repeat(150));
    device.write("cache.rows", "r".repeat(150));
    expect(device.write("cache.settings", "s".repeat(450))).toBe(true);
    expect(items.has("thread-glance:cache.order")).toBe(false);
    expect(items.has("thread-glance:cache.appearance")).toBe(false);
    expect(items.has("thread-glance:cache.rows")).toBe(false);
    expect(items.has("thread-glance:collapsedShelves")).toBe(true);
  });

  it("drops only its own key when the write still fails", () => {
    const { storage, items } = limitedStorage(300);
    const device = createDeviceStorage(storage);
    device.write("activeSort", "manual");
    device.write("collapsedGroups", ["p1"]);
    device.write("expandedParents", ["t1"]);
    device.write("cache.settings", "old");
    expect(device.write("cache.rows", "r".repeat(2_000))).toBe(false);
    expect(items.has("thread-glance:cache.rows")).toBe(false);
    expect(items.has("thread-glance:activeSort")).toBe(true);
    expect(items.has("thread-glance:collapsedGroups")).toBe(true);
    expect(items.has("thread-glance:expandedParents")).toBe(true);
    // The other caches went while it tried; nothing but caches did.
    expect(items.has("thread-glance:cache.settings")).toBe(false);
  });

  it("a state key whose write fails is removed alone and leaves the other state keys", () => {
    const { storage, items } = limitedStorage(200);
    const device = createDeviceStorage(storage);
    device.write("activeSort", "activity");
    device.write("collapsedShelves", { settled: false });
    saveDeviceState(device, INITIAL_DEVICE_STATE, { ...INITIAL_DEVICE_STATE, expandedParents: Array.from({ length: 100 }, (_, index) => `thread-${index}`) });
    expect(items.has("thread-glance:expandedParents")).toBe(false);
    expect(items.has("thread-glance:activeSort")).toBe(true);
    expect(items.has("thread-glance:collapsedShelves")).toBe(true);
  });

  it("works without any storage", () => {
    const device = createDeviceStorage(null);
    expect(device.write("activeSort", "manual")).toBe(false);
    expect(device.read("activeSort")).toBeNull();
  });
});
