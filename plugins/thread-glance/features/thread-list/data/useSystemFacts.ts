// What Thread Glance reads of bb's own configuration: its default harness
// and its primary machine. Asked once per list and fed into the list store;
// null until answered.
import { useEffect } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { ListStore, SystemFacts } from "../store/api";

export type { SystemFacts };

export const UNKNOWN_SYSTEM: SystemFacts = { defaultProviderId: null, primaryHostId: null };

interface SystemConfig {
  primaryHostId: string | null;
  generalSettings: { defaultProviderId: string | null };
  serverAccess: { defaultProviderId: string };
}

/**
 * The facts in `system.config()`'s answer. The default harness is the one
 * the user chose in bb's settings, else the one bb falls back to.
 */
export function readSystemFacts(config: SystemConfig): SystemFacts {
  return {
    defaultProviderId: config.generalSettings.defaultProviderId ?? config.serverAccess.defaultProviderId ?? null,
    primaryHostId: config.primaryHostId,
  };
}

export function useSystemFacts(store: ListStore): void {
  const sdk = useSdk();
  useEffect(() => {
    let cancelled = false;
    // Called inside the chain, so a host that throws for an area it lacks
    // lands in the rejection handler and leaves the facts unknown.
    Promise.resolve()
      .then(() => sdk.system.config())
      .then(
        (config) => {
          if (!cancelled) store.feed({ system: readSystemFacts(config) });
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, [sdk, store]);
}
