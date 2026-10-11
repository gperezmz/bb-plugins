// State the thread menu's registrations share. bb calls each registration's
// `useData` separately, so what is the same for all of them (the minute clock,
// whether the machines can be listed) is held once for the window.
import { useEffect, useSyncExternalStore } from "react";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import type { MachinesState } from "./model/menu";

const MINUTE_MS = 60_000;

let clock = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clock = Date.now();
    clockTimer = setInterval(() => {
      clock = Date.now();
      for (const notify of [...clockListeners]) notify();
    }, MINUTE_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** The time, epoch ms, moved on every minute while any menu data is mounted. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribeClock, () => clock);
}

let machines: MachinesState = "loading";
let machinesRequested = false;
const machineListeners = new Set<() => void>();

function setMachines(next: MachinesState): void {
  machines = next;
  for (const notify of [...machineListeners]) notify();
}

/** Whether the machines can be listed: read once when the first menu data mounts. */
export function useMachines(sdk: PluginBrowserBbSdk): MachinesState {
  useEffect(() => {
    if (machinesRequested) return;
    machinesRequested = true;
    Promise.resolve()
      .then(() => sdk.hosts.list())
      .then(
        (hosts) => setMachines({ count: hosts.length }),
        () => setMachines("failed"),
      );
  }, [sdk]);
  return useSyncExternalStore(
    (listener) => {
      machineListeners.add(listener);
      return () => {
        machineListeners.delete(listener);
      };
    },
    () => machines,
  );
}

/** Forgets what was read, so the next menu data reads again. */
export function resetWindowState(): void {
  machines = "loading";
  machinesRequested = false;
}
