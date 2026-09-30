// What the list reads from the plugin server and from bb, kept for as long as
// the plugin's app is loaded rather than for one mount of the list: bb
// unmounts the sidebar while its Settings or Plugins page is open, and a list
// mounted again draws from here and asks only for what it lacks. One per
// window; lists created in it read it and follow its changes.
import type { PluginRealtimeConnectionState, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { PreferenceKey, Preferences } from "@/shared/preferences";
import type { RecordsSignal, StampKind, SyncPoint, ThreadRecord } from "@/shared/signals";
import type { DefaultBranches, SystemFacts } from "../store/api";
import {
  applyFetched,
  applyLocalStamp,
  applySignal,
  applySync,
  markAsked,
  NO_RECORDS,
  threadsToFetch,
  type HeldRecords,
  type RecordsAt,
} from "./records";
import type { SyncReason } from "./requests";

/**
 * The server's answer to `sync`, as this module reads it: the contract's own
 * type leaves the preferences untyped, since it builds their schema per key.
 */
export interface SyncAnswer extends SyncPoint {
  full: boolean;
  preferences: Preferences;
  scheduled: { status: "ready" | "error"; scheduled: Record<string, number> };
  records: Record<string, ThreadRecord>;
}

/**
 * Whether what is held can be drawn as current: `waiting` until an answer to
 * `sync` lands after realtime was last followed, `current` while realtime is
 * followed since, `failed` when the last `sync` failed (what is held, or the
 * browser's mirror of the preferences, stands in).
 */
type DataStatus = "waiting" | "current" | "failed";

export interface PluginData {
  records: HeldRecords;
  scheduled: Readonly<Record<string, number>>;
  /** The server's preferences; null until the first answer. */
  preferences: Preferences | null;
  status: DataStatus;
  /** When the first answer of this epoch landed: threads created since get their records by signal. */
  liveSince: number;
  system: SystemFacts;
  defaultBranches: DefaultBranches;
}

/** What changed, for the lists that follow it. */
export type DataChange =
  | { kind: "synced" }
  | { kind: "failed" }
  | { kind: "records"; at: "signal" | "now" }
  | { kind: "scheduled" }
  | { kind: "preference"; key: PreferenceKey; value: unknown }
  | { kind: "facts" };

const UNKNOWN_SYSTEM: SystemFacts = { defaultProviderId: null, primaryHostId: null };

const INITIAL: PluginData = {
  records: NO_RECORDS,
  scheduled: {},
  preferences: null,
  status: "waiting",
  liveSince: 0,
  system: UNKNOWN_SYSTEM,
  defaultBranches: new Map(),
};

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

  /** A `sync` answer: records, scheduled sends and preferences, and the data is current. */
  synced(answer: SyncAnswer): void {
    const first = data.records.point?.epoch !== answer.epoch;
    // A signal the answer was made before came first; one it was made after is dropped by its revision.
    let records = applySync(data.records, answer);
    for (const signal of early) records = applySignal(records, signal) ?? records;
    early = [];
    set(
      {
        records,
        scheduled: answer.scheduled.status === "ready" ? answer.scheduled.scheduled : {},
        preferences: answer.preferences,
        status: following > 0 ? "current" : "waiting",
        liveSince: first ? Date.now() : data.liveSince,
      },
      { kind: "synced" },
    );
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
    if (records !== data.records) set({ records }, { kind: "records", at: "signal" });
    return true;
  },
  fetched(threadIds: readonly string[], answer: RecordsAt): void {
    set({ records: applyFetched(data.records, threadIds, answer) }, { kind: "records", at: "signal" });
  },
  /** The threads of bb's list to fetch by id, marked asked so none is sent twice. */
  takeThreadsToFetch(threads: readonly PluginSidebarThread[]): string[] {
    if (data.status !== "current" && data.status !== "failed") return [];
    const ids = threadsToFetch(data.records, threads, data.liveSince);
    if (ids.length > 0) data = { ...data, records: markAsked(data.records, ids) };
    return ids;
  },
  /** A stamp this window changed, shown at once. */
  stamped(kind: StampKind, threadIds: readonly string[], value: number | null, { quiet = false } = {}): void {
    // `quiet` tells no list: the one that changed it applies it with a change of its own.
    const records = applyLocalStamp(data.records, kind, threadIds, value);
    if (quiet) data = { ...data, records };
    else set({ records }, { kind: "records", at: "now" });
  },
  scheduledSignal(scheduled: Readonly<Record<string, number>>): void {
    set({ scheduled }, { kind: "scheduled" });
  },
  preferenceSignal(key: PreferenceKey, value: unknown): void {
    const preferences = data.preferences === null ? null : { ...data.preferences, [key]: value };
    set({ preferences }, { kind: "preference", key, value });
  },
  facts(patch: Partial<Pick<PluginData, "system" | "defaultBranches">>): void {
    set(patch, { kind: "facts" });
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
};

/** Drops everything held, as a reload of the app does. For tests (see `endPluginLifetime`). */
export function forgetPluginData(): void {
  data = INITIAL;
  following = 0;
  realtime = "unknown";
  early = [];
  overlayMounted = false;
  listeners.clear();
  overlayListeners.clear();
}
