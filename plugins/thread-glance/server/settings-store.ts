// The settings record: one validated value in the plugin's KV store.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  readSettings,
  SETTING_KEYS,
  validateSettingsPatch,
  type SettingKey,
  type Settings,
} from "../shared/settings";

/** The KV key of the record. The `preference:`, `stamp:` and `note:` prefixes belong to data `removeLegacyData` deletes. */
export const SETTINGS_KEY = "settings";

/** An edit that fails validation. `errors` holds each field's message. */
export class SettingsValidationError extends Error {
  readonly errors: Partial<Record<SettingKey, string>>;

  constructor(errors: Partial<Record<SettingKey, string>>, unknown: readonly string[]) {
    const messages = [
      ...Object.entries(errors).map(([key, message]) => `${key}: ${message}`),
      ...unknown.map((key) => `${key}: not a setting`),
    ];
    super(`Invalid settings. ${messages.join(" ")}`);
    this.name = "SettingsValidationError";
    this.errors = errors;
  }
}

export interface SettingsStore {
  /** The record; a field that is stored invalid or absent reads as its default. */
  read(): Promise<Settings>;
  /**
   * Applies the edited fields to the record and stores it. Returns the record
   * and the fields that changed.
   *
   * @throws SettingsValidationError when a field is invalid; nothing is stored.
   */
  write(patch: unknown): Promise<{ settings: Settings; changed: SettingKey[] }>;
  /** Resets the named fields, or all, to their defaults. */
  reset(keys?: readonly SettingKey[]): Promise<{ settings: Settings; changed: SettingKey[] }>;
}

export function createSettingsStore(bb: Pick<BbPluginApi, "storage">): SettingsStore {
  const { kv } = bb.storage;
  let cache: Settings | null = null;

  async function read(): Promise<Settings> {
    cache ??= readSettings(await kv.get<unknown>(SETTINGS_KEY));
    return cache;
  }

  async function replace(next: Settings): Promise<{ settings: Settings; changed: SettingKey[] }> {
    const before = await read();
    const changed = SETTING_KEYS.filter((key) => before[key] !== next[key]);
    if (changed.length > 0) {
      await kv.set(SETTINGS_KEY, next);
      cache = next;
    }
    return { settings: next, changed };
  }

  return {
    read,
    async write(patch) {
      const checked = validateSettingsPatch(patch);
      if (!checked.success) throw new SettingsValidationError(checked.errors, checked.unknown);
      return replace(applySettingsPatch(await read(), checked.value));
    },
    async reset(keys = SETTING_KEYS) {
      return replace(applySettingsPatch(await read(), Object.fromEntries(keys.map((key) => [key, DEFAULT_SETTINGS[key]]))));
    },
  };
}
