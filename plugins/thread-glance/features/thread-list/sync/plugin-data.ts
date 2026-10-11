// What the list reads from the plugin server, kept for as long as the
// plugin's app is loaded rather than for one mount of the list: bb unmounts
// the sidebar while its Settings or Plugins page is open, and the settings
// page and thread menus read the same data. A list mounted again draws from
// here and asks only for what it lacks. One per window.
import type { PluginRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { LifecycleRow } from "@/shared/lifecycle";
import { DEFAULT_SETTINGS, type Settings } from "@/shared/settings";
import type { Appearance, RecordsSignal, Versioned } from "@/shared/signals";
import { createDeviceStorage, type DeviceStorage } from "../storage/device-storage";
import {
  readAppearanceCache,
  readOrderCache,
  readRowsCache,
  readSettingsCache,
  writeAppearanceCache,
  writeOrderCache,
  writeRowsCache,
  writeSettingsCache,
} from "../storage/device-state";
import { applySignal, applySync, NO_RECORDS, recordsFromCache, type HeldRecords, type RecordsAt } from "./records";
import type { SyncReason } from "./requests";
import { newer } from "./versioned";

/** The server's answer to `sync`, as this module reads it. */
export interface SyncAnswer extends RecordsAt {
  full: boolean;
  settings: Versioned<Settings>;
  order: Versioned<string[]>;
  appearance: Versioned<Appearance>;
}

/**
 * Whether what is held can be drawn as current: `waiting` until an answer to
 * `sync` lands after realtime was last followed, `current` while realtime is
 * followed since, `failed` when the last `sync` failed (what is held, or the
 * browser's cache, stands in).
 */
export type DataStatus = "waiting" | "current" | "failed";

export interface PluginData {
  records: HeldRecords;
  /** The server's settings; null until the first answer, when the cache or the defaults stand in. */
  settings: Versioned<Settings> | null;
  order: Versioned<string[]> | null;
  appearance: Versioned<Appearance> | null;
  status: DataStatus;
  /** Rows, order and settings shown come from the browser's cache until the first answer lands. */
  cached: boolean;
}

/** What changed, for the lists that follow it. */
export type DataChange =
  | { kind: "synced" }
  | { kind: "failed" }
  | { kind: "records" }
  | { kind: "settings" }
  | { kind: "order" }
  | { kind: "appearance" };

const INITIAL: PluginData = {
  records: NO_RECORDS,
  settings: null,
  order: null,
  appearance: null,
  status: "waiting",
  cached: false,
};

/** How long after a change the cache is written, so a burst writes once. */
const PERSIST_DELAY_MS = 1_000;

let data: PluginData = INITIAL;
const listeners = new Set<(change: DataChange) => void>();
/** How many components follow realtime for it now: the app overlay's, or a list's where bb has no overlay. */
let following = 0;
/** Realtime's connection as a keeper last heard it; unknown until one does. */
let realtime: "unknown" | "up" | "down" = "unknown";
/** `records` signals that came before the first answer, applied once it lands. */
let early: RecordsSignal[] = [];
let overlayMounted = false;
const overlayListeners = new Set<() => void>();
let storage: DeviceStorage | null = null;
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = new Set<"records" | "settings" | "order" | "appearance">();

function persist(): void {
  persistTimer = null;
  if (storage === null) return;
  const kinds = dirty;
  dirty = new Set();
  if (kinds.has("records")) writeRowsCache(storage, data.records.lifecycle);
  if (kinds.has("settings") && data.settings !== null) writeSettingsCache(storage, data.settings.value);
  if (kinds.has("order") && data.order !== null) writeOrderCache(storage, data.order.value);
  if (kinds.has("appearance") && data.appearance !== null) writeAppearanceCache(storage, data.appearance.value);
}

function schedulePersist(kind: "records" | "settings" | "order" | "appearance"): void {
  dirty.add(kind);
  if (persistTimer === null) persistTimer = setTimeout(persist, PERSIST_DELAY_MS);
}

function set(patch: Partial<PluginData>, change: DataChange): void {
  data = { ...data, ...patch };
  for (const listener of [...listeners]) listener(change);
}

export const pluginData = {
  get: (): PluginData => data,
  subscribe(listener: (change: DataChange) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Shows what the browser cached until the server answers: lifecycle rows,
   * manual order, settings and appearance. Does nothing after the first call
   * or once an answer has landed.
   */
  hydrate(device: DeviceStorage = createDeviceStorage()): void {
    if (hydrated) return;
    hydrated = true;
    storage = device;
    if (data.records.point !== null) return;
    const rows = readRowsCache(device);
    const order = readOrderCache(device);
    const settings = readSettingsCache(device);
    const appearance = readAppearanceCache(device);
    if (rows === null && order === null && settings === null && appearance === null) return;
    data = {
      ...data,
      records: rows === null ? data.records : recordsFromCache(rows),
      order: order === null ? null : { epoch: "cache", version: 0, value: order },
      settings: settings === null ? null : { epoch: "cache", version: 0, value: settings },
      appearance: appearance === null ? null : { epoch: "cache", version: 0, value: appearance },
      cached: rows !== null,
    };
  },

  /** The settings in force: the server's, else the cache's, else the defaults (Inactive on). */
  settings: (): Settings => data.settings?.value ?? DEFAULT_SETTINGS,

  /** A `sync` answer: records, settings, order and appearance, and the data is current. */
  synced(answer: SyncAnswer): void {
    // A signal the answer was made before came first; one it was made after is dropped by its revision.
    let records = applySync(data.records, answer);
    for (const signal of early) records = applySignal(records, signal) ?? records;
    early = [];
    set(
      {
        records,
        settings: newer(realServer(data.settings), answer.settings),
        order: newer(realServer(data.order), answer.order),
        appearance: newer(realServer(data.appearance), answer.appearance),
        status: following > 0 ? "current" : "waiting",
        cached: false,
      },
      { kind: "synced" },
    );
    for (const kind of ["records", "settings", "order", "appearance"] as const) schedulePersist(kind);
  },
  /** `sync` failed: lists draw from what is held. */
  failed(): void {
    set({ status: "failed" }, { kind: "failed" });
  },
  /** A `records` signal; false when it is from another epoch, which needs a full `sync`. */
  signal(signal: RecordsSignal): boolean {
    if (data.records.point === null) {
      early.push(signal);
      return true;
    }
    const records = applySignal(data.records, signal);
    if (records === null) return false;
    if (records !== data.records) {
      set({ records }, { kind: "records" });
      schedulePersist("records");
    }
    return true;
  },
  settingsSignal(value: Versioned<Settings>): void {
    const settings = newer(realServer(data.settings), value);
    if (settings === data.settings) return;
    set({ settings }, { kind: "settings" });
    schedulePersist("settings");
  },
  orderSignal(value: Versioned<string[]>): void {
    const order = newer(realServer(data.order), value);
    if (order === data.order) return;
    set({ order }, { kind: "order" });
    schedulePersist("order");
  },
  appearanceSignal(value: Versioned<Appearance>): void {
    const appearance = newer(realServer(data.appearance), value);
    if (appearance === data.appearance) return;
    set({ appearance }, { kind: "appearance" });
    schedulePersist("appearance");
  },

  /** A component starts following realtime; returns the call that stops it. */
  follow(): () => void {
    following += 1;
    return () => {
      following -= 1;
      // Signals from now on are lost until a `sync` asks for them.
      if (following === 0 && data.status === "current") data = { ...data, status: "waiting" };
    };
  },
  /**
   * Realtime's connection is in `state`, as a keeper following it hears it;
   * returns why a `sync` has to go now, or null. One goes once the
   * connection is up, so no signal is lost between the answer and the socket
   * opening: `missed` when it was down, since what was sent then no signal
   * will bring, and `current` before any answer, or after the list stopped
   * following, since what is held is not current.
   */
  connection(state: PluginRealtimeConnectionState): SyncReason | null {
    if (state !== "connected") {
      if (data.status === "current") data = { ...data, status: "waiting" };
      realtime = "down";
      return null;
    }
    const back = realtime === "down";
    realtime = "up";
    if (back) return "missed";
    return data.status === "current" ? null : "current";
  },

  isOverlayMounted: () => overlayMounted,
  setOverlayMounted(mounted: boolean): void {
    overlayMounted = mounted;
    for (const listener of [...overlayListeners]) listener();
  },
  subscribeOverlay(listener: () => void): () => void {
    overlayListeners.add(listener);
    return () => overlayListeners.delete(listener);
  },

  /** Writes the cache now, as the page hiding asks. */
  flush(): void {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persist();
  },
};

/** A held value that the server sent, as opposed to one read from the browser's cache. */
function realServer<T>(held: Versioned<T> | null): Versioned<T> | null {
  return held === null || held.epoch === "cache" ? null : held;
}

/** Whether a row is held for the thread. */
export function lifecycleRowOf(threadId: string): LifecycleRow | null {
  return data.records.lifecycle[threadId] ?? null;
}

/** Drops everything held, as a reload of the app does. For tests (see `endPluginLifetime`). */
export function forgetPluginData(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  dirty = new Set();
  data = INITIAL;
  following = 0;
  realtime = "unknown";
  early = [];
  overlayMounted = false;
  storage = null;
  hydrated = false;
  listeners.clear();
  overlayListeners.clear();
}
