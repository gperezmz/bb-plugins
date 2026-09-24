// Server-side preferences in the plugin kv, the same pattern as bb's
// own thread-list server: one row per key, validated on every read and write.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNELS, type PreferenceSignal } from "../shared/contract";
import {
  PREFERENCE_KEYS,
  defaultPreferences,
  parsePreference,
  preferenceDefault,
  type PreferenceKey,
  type Preferences,
} from "../shared/preferences";

const PREFERENCE_KEY_PREFIX = "preference:";

export function preferenceKvKey(key: PreferenceKey): string {
  return `${PREFERENCE_KEY_PREFIX}${key}`;
}

/** A value that fails the key's schema. The message names the key. */
export class PreferenceValidationError extends Error {
  readonly key: PreferenceKey;
  readonly detail: string;

  constructor(key: PreferenceKey, detail: string) {
    super(`Invalid value for ${key}: ${detail}`);
    this.name = "PreferenceValidationError";
    this.key = key;
    this.detail = detail;
  }
}

export interface PreferenceStore {
  /** The stored value, or the default when none is stored or it is invalid. */
  read<K extends PreferenceKey>(key: K): Promise<Preferences[K]>;
  readAll(): Promise<Preferences>;
  /** Whether the kv holds a row for the key, valid or not. */
  isStored(key: PreferenceKey): Promise<boolean>;
  /**
   * Validates, stores and publishes the value, and returns it as parsed.
   *
   * @throws PreferenceValidationError when the value fails the key's schema.
   */
  write<K extends PreferenceKey>(key: K, value: unknown): Promise<Preferences[K]>;
  /** Deletes the stored value, publishes the default and returns it. */
  reset<K extends PreferenceKey>(key: K): Promise<Preferences[K]>;
}

export function createPreferenceStore(
  bb: Pick<BbPluginApi, "storage" | "realtime" | "log">,
): PreferenceStore {
  const { kv } = bb.storage;

  function publish(key: PreferenceKey, value: unknown): void {
    const signal: PreferenceSignal = { key, value };
    bb.realtime.publish(CHANNELS.preferences, signal);
  }

  async function read<K extends PreferenceKey>(key: K): Promise<Preferences[K]> {
    const stored = await kv.get<unknown>(preferenceKvKey(key));
    if (stored === undefined) return preferenceDefault(key);
    const parsed = parsePreference(key, stored);
    if (parsed.success) return parsed.value;
    bb.log.warn(`stored preference ${key} is invalid (${parsed.message}); using the default`);
    return preferenceDefault(key);
  }

  return {
    read,
    async readAll() {
      const result = defaultPreferences();
      await Promise.all(
        PREFERENCE_KEYS.map(async (key) => {
          (result as Record<PreferenceKey, unknown>)[key] = await read(key);
        }),
      );
      return result;
    },
    async isStored(key) {
      return (await kv.get<unknown>(preferenceKvKey(key))) !== undefined;
    },
    async write(key, value) {
      const parsed = parsePreference(key, value);
      if (!parsed.success) throw new PreferenceValidationError(key, parsed.message);
      await kv.set(preferenceKvKey(key), parsed.value);
      publish(key, parsed.value);
      return parsed.value;
    },
    async reset(key) {
      await kv.delete(preferenceKvKey(key));
      const value = preferenceDefault(key);
      publish(key, value);
      return value;
    },
  };
}
