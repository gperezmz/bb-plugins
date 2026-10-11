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
  /** Lifecycle rows cached for the first draw. */
  lifecycleRows: 500,
  /** Ids of the manual order cached for the first draw. */
  orderIds: 2_000,
} as const;

const PREFIX = "thread-glance:";

/** Keys that hold what the person set on this device; nothing evicts them. */
export type StateKey = "collapsedShelves" | "activeSort" | "collapsedGroups" | "expandedParents" | "workingSince";

/** Keys that cache what the server sends, listed least important first: the order eviction takes them in. */
export const CACHE_KEYS = ["cache.order", "cache.appearance", "cache.rows", "cache.settings"] as const;
export type CacheKey = (typeof CACHE_KEYS)[number];

export type StorageKey = StateKey | CacheKey;

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
}

export function createDeviceStorage(storage: StorageLike | null = defaultStorage()): DeviceStorage {
  const name = (key: StorageKey) => `${PREFIX}${key}`;
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
  };
}
