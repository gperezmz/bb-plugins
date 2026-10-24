// The browser storage the list keeps per device, bounded. Every value lives
// under its own key; the keys that only cache what the server can send again
// are evicted, least important first, when the quota is full, and a write
// that still fails gives up its own key alone.

/** The most entries each stored list keeps. */
export const CAPS = {
  /** Parents whose child list is open. */
  expandedParents: 100,
  /** Project groups collapsed in Project mode. */
  collapsedGroups: 200,
  /** Worktree groups collapsed inside a Project-mode group. */
  collapsedWorktrees: 200,
  /** Projects pinned above the list. */
  pinnedProjects: 50,
  /** Lifecycle rows cached for the first draw. */
  lifecycleRows: 500,
  /** Ids of the manual order cached for the first draw. */
  orderIds: 2_000,
} as const;

const PREFIX = "thread-glance:";

/** The keys an earlier version of the plugin stored under, which nothing reads any more. */
const LEGACY_KEYS = ["bb.thread-glance.client.v1", "bb.thread-glance.preferences.v1"] as const;

/** Keys that hold what the person set on this device; nothing evicts them. */
export type StateKey = "collapsedShelves" | "activeSort" | "collapsedGroups" | "collapsedWorktrees" | "expandedParents" | "pinnedProjects" | "workingSince" | "portLinkMachine";

/** Keys that cache what the server sends, listed least important first: the order eviction takes them in. */
export const CACHE_KEYS = ["cache.order", "cache.appearance", "cache.rows", "cache.settings"] as const;
export type CacheKey = (typeof CACHE_KEYS)[number];

export type StorageKey = StateKey | CacheKey;

/** The name `key` is stored under in the browser's storage, which a `storage` event names. */
export function storedKeyName(key: StorageKey): string {
  return `${PREFIX}${key}`;
}

/** The part of `Storage` the list uses. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface DeviceStorage {
  /** The parsed JSON under `key`, or null when it is absent or unreadable. */
  read(key: StorageKey): unknown;
  /**
   * Stores `value` under `key`. On a failed write the caches go first, least
   * important first, each followed by a retry; if the write still fails,
   * `key` itself is removed and false returned. Other keys are never touched
   * beyond those caches.
   */
  write(key: StorageKey, value: unknown): boolean;
  remove(key: StorageKey): void;
  /** Removes the keys an earlier version stored under, by name. */
  removeLegacy(): void;
}

export function createDeviceStorage(storage: StorageLike | null = defaultStorage()): DeviceStorage {
  const name = storedKeyName;
  const tryWrite = (key: StorageKey, raw: string): boolean => {
    try {
      storage?.setItem(name(key), raw);
      return storage !== null;
    } catch {
      return false;
    }
  };
  return {
    read(key) {
      try {
        const raw = storage?.getItem(name(key));
        return raw == null ? null : (JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    },
    write(key, value) {
      if (storage === null) return false;
      let raw: string;
      try {
        raw = JSON.stringify(value);
      } catch {
        return false;
      }
      if (tryWrite(key, raw)) return true;
      for (const cache of CACHE_KEYS) {
        if (cache === key) continue;
        try {
          storage.removeItem(name(cache));
        } catch {
          continue;
        }
        if (tryWrite(key, raw)) return true;
      }
      try {
        storage.removeItem(name(key));
      } catch {
        // Nothing more to give up.
      }
      return false;
    },
    remove(key) {
      try {
        storage?.removeItem(name(key));
      } catch {
        // A key that cannot be removed stays as it is.
      }
    },
    removeLegacy() {
      for (const key of LEGACY_KEYS) {
        try {
          storage?.removeItem(key);
        } catch {
          // A key that cannot be removed stays as it is.
        }
      }
    },
  };
}
