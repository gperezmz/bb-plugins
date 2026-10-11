// The settings record: every sidebar setting the settings page edits, with its
// default and range, stored on the server as one validated record. Settings
// that belong to the device (shelf collapse, Active's sort, group collapse,
// child expansion) are not here.
import * as z from "zod/mini";
import { DEFAULT_SNOOZE_SHORTCUTS, snoozeShortcutsError } from "./snooze";

export const HOURS_BEFORE_INACTIVE_RANGE = { min: 1, max: 720 } as const;
export const DAYS_BEFORE_AUTO_SETTLE_RANGE = { min: 1, max: 90 } as const;

export const STRIPE_CHOICES = ["full-and-collapsed", "full", "grouped"] as const;
export const CHILD_ORDERS = ["created", "activity"] as const;
export const CHILD_DIRECTIONS = ["oldest", "newest"] as const;
export const CHILD_ICONS = ["colour-circle", "provider-icon"] as const;

const hoursSchema = z
  .int({ error: "Enter a whole number of hours." })
  .check(
    z.minimum(HOURS_BEFORE_INACTIVE_RANGE.min, { error: "Use at least 1 hour." }),
    z.maximum(HOURS_BEFORE_INACTIVE_RANGE.max, { error: "Use at most 720 hours." }),
  );
const daysSchema = z
  .int({ error: "Enter a whole number of days." })
  .check(
    z.minimum(DAYS_BEFORE_AUTO_SETTLE_RANGE.min, { error: "Use at least 1 day." }),
    z.maximum(DAYS_BEFORE_AUTO_SETTLE_RANGE.max, { error: "Use at most 90 days." }),
  );
const shortcutsSchema = z.string({ error: "Enter the snooze shortcuts as text." }).check(
  z.superRefine((value, context) => {
    const reason = snoozeShortcutsError(value);
    if (reason !== null) context.addIssue({ code: "custom", message: reason, input: value });
  }),
);
const flag = z.boolean({ error: "Use on or off." });
const choice = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: `Use one of: ${values.join(", ")}.` });

/** Each setting's schema, keyed by the setting's name. */
const fields = {
  /** Working threads draw as a Folded card. */
  compactWorkingThreads: flag,
  /** The Working shelf. */
  workingShelf: flag,
  /** The Inactive shelf. */
  inactiveShelf: flag,
  hoursBeforeInactive: hoursSchema,
  /** The lower group sits at the bottom of the sidebar's viewport. */
  dockShelves: flag,
  /** Project colours. */
  projectColours: flag,
  /** Where stripes show: Full and collapsed mode, Full mode only, or Grouped projects only. */
  stripesIn: choice(STRIPE_CHOICES),
  /** The snooze presets, as comma-separated text (see snooze.ts). */
  snoozeShortcuts: shortcutsSchema,
  /** Auto-settle quiet threads. */
  settleQuietThreads: flag,
  daysBeforeAutoSettle: daysSchema,
  /** Auto-settle threads whose pull request merged; a closed one always counts. */
  settleMergedPullRequests: flag,
  /** Children that need attention show on a collapsed shelf and a closed child list. */
  showChildrenNeedingAttention: flag,
  childOrder: choice(CHILD_ORDERS),
  childDirection: choice(CHILD_DIRECTIONS),
  childIcon: choice(CHILD_ICONS),
} as const;

export type SettingKey = keyof typeof fields;
export const SETTING_KEYS = Object.keys(fields) as SettingKey[];

export const settingsSchema = z.strictObject(fields);
export type Settings = z.infer<typeof settingsSchema>;

/** The write RPC's input: only the fields the user edited. */
export const settingsPatchSchema = z.partial(z.strictObject(fields));
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** The settings of a fresh install, and what the app shows until the server's arrive. Inactive is on. */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  compactWorkingThreads: false,
  workingShelf: false,
  inactiveShelf: true,
  hoursBeforeInactive: 6,
  dockShelves: false,
  projectColours: false,
  stripesIn: "full-and-collapsed",
  snoozeShortcuts: DEFAULT_SNOOZE_SHORTCUTS,
  settleQuietThreads: true,
  daysBeforeAutoSettle: 3,
  settleMergedPullRequests: true,
  showChildrenNeedingAttention: true,
  childOrder: "created",
  childDirection: "oldest",
  childIcon: "colour-circle",
});

export type SettingsErrors = Partial<Record<SettingKey, string>>;

export type SettingsValidation =
  | { success: true; value: SettingsPatch }
  | { success: false; errors: SettingsErrors; unknown: string[] };

/** The message of the first issue the field's schema reports. */
function fieldError(key: SettingKey, value: unknown): string | null {
  const parsed = fields[key].safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid value.");
}

/**
 * Checks an edit field by field, so the page shows each error inline and
 * saves nothing while any field is invalid. Fields the record does not have
 * are listed in `unknown`.
 */
export function validateSettingsPatch(input: unknown): SettingsValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, errors: {}, unknown: ["(not an object)"] };
  }
  const errors: SettingsErrors = {};
  const unknown: string[] = [];
  const value: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (entry === undefined) continue;
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      unknown.push(key);
      continue;
    }
    const message = fieldError(key as SettingKey, entry);
    if (message === null) value[key] = entry;
    else errors[key as SettingKey] = message;
  }
  if (unknown.length > 0 || Object.keys(errors).length > 0) return { success: false, errors, unknown };
  return { success: true, value: value as SettingsPatch };
}

/**
 * The record a stored value means. Reading is tolerant: a field that is
 * missing or invalid is its default, so one bad field cannot lose the rest.
 */
export function readSettings(stored: unknown): Settings {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return { ...DEFAULT_SETTINGS };
  const record = stored as Record<string, unknown>;
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (key in record && fieldError(key, record[key]) === null) settings[key] = record[key];
  }
  return settings as Settings;
}

/** `current` with the edited fields replaced. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) next[key] = value;
  return next as Settings;
}

/** The fields of `after` that differ from `before`. */
export function changedSettingKeys(before: Settings, after: Settings): SettingKey[] {
  return SETTING_KEYS.filter((key) => before[key] !== after[key]);
}

/** Whether a change to these fields changes what an auto-settle pass would do. */
export function affectsAutoSettle(keys: readonly SettingKey[]): boolean {
  return keys.some(
    (key) => key === "settleQuietThreads" || key === "daysBeforeAutoSettle" || key === "settleMergedPullRequests",
  );
}
