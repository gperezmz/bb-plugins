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

/** How long after machines could not be listed, or none were, they are listed again. */
const MACHINES_RETRY_MS = 30_000;

let machines: MachinesState = "loading";
let machineUsers = 0;
let machinesTimer: ReturnType<typeof setTimeout> | null = null;
/** Which stretch of use a read belongs to, so a read that comes back after the menu data unmounted is dropped. */
let machinesEpoch = 0;
const machineListeners = new Set<() => void>();

function setMachines(next: MachinesState): void {
  const same = machines === next || (typeof machines === "object" && typeof next === "object" && machines.count === next.count);
  if (same) return;
  machines = next;
  for (const notify of [...machineListeners]) notify();
}

type Listed = Exclude<MachinesState, "loading">;

/** Lists the machines, and again after a wait for as long as they could not be listed or there were none. */
function readMachines(sdk: PluginBrowserBbSdk): void {
  const epoch = machinesEpoch;
  machinesTimer = null;
  Promise.resolve()
    .then(() => sdk.hosts.list())
    .then(
      (hosts): Listed => ({ count: hosts.length }),
      (): Listed => "failed",
    )
    .then((state) => {
      if (epoch !== machinesEpoch) return;
      setMachines(state);
      if (state === "failed" || state.count === 0) machinesTimer = setTimeout(() => readMachines(sdk), MACHINES_RETRY_MS);
    });
}

/**
 * Whether the machines can be listed: read when the first menu data mounts,
 * and again while they could not be listed or none were, since the person may
 * have connected one. Forgotten once no menu data is mounted.
 */
export function useMachines(sdk: PluginBrowserBbSdk): MachinesState {
  useEffect(() => {
    machineUsers += 1;
    if (machineUsers === 1) readMachines(sdk);
    return () => {
      machineUsers -= 1;
      if (machineUsers > 0) return;
      machinesEpoch += 1;
      if (machinesTimer !== null) clearTimeout(machinesTimer);
      machinesTimer = null;
      machines = "loading";
    };
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
