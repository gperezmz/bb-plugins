// How components outside the list (the thread menu's actions, the settings
// page, the thread header's buttons) read the server's data: the same
// window-wide data the list reads, through selectors that keep their identity
// while nothing they read changed.
import { useSyncExternalStore } from "react";
import type { LifecycleRow } from "@/shared/lifecycle";
import type { Settings } from "@/shared/settings";
import type { Appearance } from "@/shared/signals";
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
