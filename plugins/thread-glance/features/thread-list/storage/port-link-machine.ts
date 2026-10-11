// The port link machine: which machine's web ports the hover card links to.
// A device setting, kept in the browser's storage and not on the server. One
// per window, outside any list, because the settings page sets it and the
// lists read it; a `storage` event from another tab of this browser updates it.
import { useSyncExternalStore } from "react";
import { readPortLinkMachine, writePortLinkMachine } from "./device-state";
import { createDeviceStorage, storedKeyName, type DeviceStorage } from "./device-storage";

/** The chosen machine's id; undefined until first read. */
let held: string | null | undefined;
let storage: DeviceStorage | null = null;
const listeners = new Set<() => void>();

function device(): DeviceStorage {
  return (storage ??= createDeviceStorage());
}

function current(): string | null {
  return (held ??= readPortLinkMachine(device()));
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Another tab wrote the key, or cleared the storage (a null key). */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== storedKeyName("portLinkMachine")) return;
  const next = readPortLinkMachine(device());
  if (next === held) return;
  held = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export const portLinkMachine = {
  get: current,
  /** Chooses the machine (null: no machine) and stores the choice on this device. */
  set(machineId: string | null): void {
    if (machineId === current()) return;
    held = machineId;
    writePortLinkMachine(device(), machineId);
    notify();
  },
};

/** The chosen port link machine's id, or null; follows other tabs. */
export function usePortLinkMachine(): string | null {
  return useSyncExternalStore(subscribe, current);
}

/** Forgets what was read, as a reload of the app does. For tests (see `endPluginLifetime`). */
export function forgetPortLinkMachine(): void {
  held = undefined;
  storage = null;
}
