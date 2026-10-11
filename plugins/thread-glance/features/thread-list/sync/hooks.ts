// How components outside the list (the thread menu's actions, the settings
// page, the thread header's buttons) read the server's data: the same
// window-wide data the list reads, through selectors that keep their identity
// while nothing they read changed.
import { useSyncExternalStore } from "react";
import type { LifecycleRow } from "@/shared/lifecycle";
import type { PortListener, PortsSnapshot } from "@/shared/ports";
import type { Settings } from "@/shared/settings";
import type { Appearance } from "@/shared/signals";
import { listenersOf } from "../model/ports";
import { pluginData, type PluginData } from "./plugin-data";

const NO_APPEARANCE: Appearance = { colours: {}, icons: {} };
const NO_ORDER: readonly string[] = [];

/** The part of the plugin's data `select` picks; `select` returns a value that keeps its identity while unchanged. */
export function usePluginData<T>(select: (data: PluginData) => T): T {
  return useSyncExternalStore(
    (listener) => pluginData.subscribe(listener),
    () => select(pluginData.get()),
  );
}

/** The lifecycle row of every thread that has one, by thread id. */
export function useLifecycleRows(): Readonly<Record<string, LifecycleRow>> {
  return usePluginData((data) => data.records.lifecycle);
}

/** One thread's lifecycle row, or null. */
export function useLifecycleRow(threadId: string): LifecycleRow | null {
  return usePluginData((data) => data.records.lifecycle[threadId] ?? null);
}

/** The settings in force: the server's, else the browser's cache, else the defaults (Inactive on). */
export function useServerSettings(): Settings {
  return usePluginData(() => pluginData.settings());
}

export function useAppearance(): Appearance {
  return usePluginData((data) => data.appearance?.value ?? NO_APPEARANCE);
}

/** Manual order, top first. */
export function useManualOrder(): readonly string[] {
  return usePluginData((data) => data.order?.value ?? NO_ORDER);
}

/** What the ports snapshot holds for one environment, or null; the same object until that environment's listeners change. */
export function usePortEnvironment(environmentId: string | null | undefined): PortsSnapshot["environments"][string] | null {
  return usePluginData((data) => (environmentId == null ? null : (data.ports?.value.environments[environmentId] ?? null)));
}

/** The listeners of one environment; the same array until they change, so a row re-renders only for its own. */
export function usePortListeners(environmentId: string | null | undefined): readonly PortListener[] {
  return usePluginData((data) => listenersOf(data.ports?.value ?? null, environmentId));
}
