/**
 * Cache Keeper's four settings, kept in its own storage and drawn by its own
 * settings sections. Up to 0.2.0 bb held them as declared settings; the first
 * load after upgrading copies them from there once.
 */
import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import type { KeepWarmSetting } from "../core/switch";
import type { Store } from "./store";

export const WAIT_OPTIONS = ["10 min", "15 min", "30 min"] as const;
export const WAIT_MINUTES = [10, 15, 30] as const;

/** The "Keep caches warm while waiting" choices, as Settings shows them, and what each parses to. */
export const KEEP_WARM_OPTIONS: Record<string, KeepWarmSetting> = {
  "Every waiting thread": "every",
  "Only threads switched on": "switched",
  Never: "never",
};

/**
 * The four settings as bb declared them up to 0.2.0. Declaring them is what
 * reads their values, and also what makes bb draw them in one box, so they
 * are declared only on the load that copies them.
 */
export const DECLARED_SETTINGS = {
  keepWarm: { type: "select", label: "Keep caches warm while waiting", options: Object.keys(KEEP_WARM_OPTIONS), default: "Only threads switched on" },
  stalledCheckIns: { type: "boolean", label: "Check in on stalled background work", default: false },
  noOutputWait: { type: "select", label: "No-output wait", options: [...WAIT_OPTIONS], default: "15 min" },
  fetchPrices: { type: "boolean", label: "Fetch current prices daily", default: true },
} satisfies PluginSettingDescriptors;

export interface KeeperSettings {
  keepWarm: KeepWarmSetting;
  checkIns: boolean;
  waitMs: number;
  fetchPrices: boolean;
}

export const DEFAULT_SETTINGS: KeeperSettings = { keepWarm: "switched", checkIns: false, waitMs: 15 * 60_000, fetchPrices: true };

/** The declared settings' values, as bb holds them, parsed. */
export function parseDeclared(values: Record<string, unknown>): KeeperSettings {
  const wait = typeof values.noOutputWait === "string" ? Number.parseInt(values.noOutputWait, 10) : NaN;
  return {
    keepWarm: (typeof values.keepWarm === "string" ? KEEP_WARM_OPTIONS[values.keepWarm] : undefined) ?? DEFAULT_SETTINGS.keepWarm,
    checkIns: values.stalledCheckIns === true,
    waitMs: ((WAIT_MINUTES as readonly number[]).includes(wait) ? wait : 15) * 60_000,
    fetchPrices: values.fetchPrices !== false,
  };
}

const KEEP_WARM_VALUES: readonly KeepWarmSetting[] = ["every", "switched", "never"];
const isWaitMs = (ms: unknown) => typeof ms === "number" && (WAIT_MINUTES as readonly number[]).includes(ms / 60_000);

/** Stored settings, each field that is not a value it can take put back to its default. */
export function normalizeSettings(stored: Partial<Record<keyof KeeperSettings, unknown>> | null): KeeperSettings {
  const s = stored ?? {};
  return {
    keepWarm: KEEP_WARM_VALUES.includes(s.keepWarm as KeepWarmSetting) ? (s.keepWarm as KeepWarmSetting) : DEFAULT_SETTINGS.keepWarm,
    checkIns: typeof s.checkIns === "boolean" ? s.checkIns : DEFAULT_SETTINGS.checkIns,
    waitMs: isWaitMs(s.waitMs) ? (s.waitMs as number) : DEFAULT_SETTINGS.waitMs,
    fetchPrices: typeof s.fetchPrices === "boolean" ? s.fetchPrices : DEFAULT_SETTINGS.fetchPrices,
  };
}

const META = "settings";
/** Set once the declared settings were copied, before the reload that stops bb drawing them. */
export const COPIED_META = "declaredSettingsCopied";

export class Settings {
  private cache: KeeperSettings | null = null;

  constructor(private readonly store: Store) {}

  get(): KeeperSettings {
    this.cache ??= normalizeSettings(this.store.getMeta(META));
    return this.cache;
  }

  set(patch: Partial<KeeperSettings>): KeeperSettings {
    this.cache = normalizeSettings({ ...this.get(), ...patch });
    this.store.setMeta(META, this.cache);
    return this.cache;
  }

  /** True once the declared settings were copied, on this install or one before it whose storage bb kept. */
  copied(): boolean {
    return this.store.getMeta(COPIED_META) !== null;
  }

  /**
   * Copies the declared settings' values, the defaults for any it cannot
   * read, and marks them copied in the same write, so a failed copy is not
   * tried again.
   */
  async copyDeclared(read: () => Promise<Record<string, unknown>>, now: number, warn: (message: string) => void): Promise<void> {
    const values = await read().catch((error: unknown) => {
      warn(`could not read the settings bb held, so they start at their defaults: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    });
    const next = parseDeclared(values);
    this.store.transaction(() => {
      this.store.setMeta(META, next);
      this.store.setMeta(COPIED_META, { at: now });
    });
    this.cache = next;
  }
}
