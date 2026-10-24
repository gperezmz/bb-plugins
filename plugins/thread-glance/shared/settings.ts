// The settings record: every sidebar setting the settings page edits, with its
// default and range, stored on the server as one validated record. Settings
// that belong to the device (shelf collapse, Active's sort, group collapse,
// child expansion) are not here.
import * as z from "zod/mini";
import { DEFAULT_SNOOZE_SHORTCUTS, MAX_SNOOZE_ENTRIES, snoozeShortcutsError } from "./snooze";

export const HOURS_BEFORE_INACTIVE_RANGE = { min: 1, max: 720 } as const;
export const DAYS_BEFORE_AUTO_SETTLE_RANGE = { min: 1, max: 90 } as const;

export const STRIPE_CHOICES = ["full-and-collapsed", "full", "grouped"] as const;
export const CHILD_ORDERS = ["created", "activity"] as const;
export const CHILD_DIRECTIONS = ["oldest", "newest"] as const;
export const CHILD_ICONS = ["colour-circle", "provider-icon"] as const;
export const THREAD_DISPLAYS = ["full-cards", "compact-working", "compact-all"] as const;

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
  /** Which Pinned, Active and Inactive threads draw as a Folded card: none, the working ones, or all. */
  threadDisplay: choice(THREAD_DISPLAYS),
  /** Under Compact all threads, pinned threads stay Full cards. */
  keepPinnedAsFullCards: flag,
  /** Under Compact all threads, a woke thread stays a Full card until it is opened. */
  keepWokeAsFullCards: flag,
  /** The Working shelf. */
  workingShelf: flag,
  /** The Inactive shelf. */
  inactiveShelf: flag,
  hoursBeforeInactive: hoursSchema,
  /** The lower group sits at the bottom of the sidebar's viewport. */
  dockShelves: flag,
  /** Project colours. */
  projectColours: flag,
  /** Under the Project sort, root threads sharing a bb worktree sit in a group named by its branch. */
  groupByWorktree: flag,
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

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export const settingsSchema = z.strictObject(fields);
export type Settings = z.infer<typeof settingsSchema>;

/** The write RPC's input: only the fields the user edited. */
export const settingsPatchSchema = z.partial(z.strictObject(fields));
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** The settings of a fresh install, and what the app shows until the server's arrive. Inactive is on. */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  threadDisplay: "full-cards",
  keepPinnedAsFullCards: false,
  keepWokeAsFullCards: false,
  workingShelf: false,
  inactiveShelf: true,
  hoursBeforeInactive: 6,
  dockShelves: false,
  projectColours: false,
  groupByWorktree: false,
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

/** What each setting does and the values it takes, in the words `bb thread-glance prefs` shows. */
export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  threadDisplay: `Which Pinned, Active and Inactive threads draw as a one-line folded card: ${THREAD_DISPLAYS.join(", ")}. "full-cards" folds none, "compact-working" the working ones, "compact-all" all of them; a thread that fails or needs you unfolds to a full card, under "compact-all" until you open it or the question clears, and after a send failure until the message sends or is deleted.`,
  keepPinnedAsFullCards: 'Under threadDisplay "compact-all", draw pinned threads as full cards. true or false.',
  keepWokeAsFullCards: 'Under threadDisplay "compact-all", draw a woke thread as a full card until it is opened. true or false.',
  workingShelf: "Move threads whose tree is working to their own Working shelf. true or false.",
  inactiveShelf: "Move threads with no activity for a while to the Inactive shelf. true or false.",
  hoursBeforeInactive: `Hours without activity before a thread moves to the Inactive shelf. A whole number, ${HOURS_BEFORE_INACTIVE_RANGE.min} to ${HOURS_BEFORE_INACTIVE_RANGE.max}.`,
  dockShelves: "Keep the lower shelves at the bottom of the sidebar. true or false.",
  projectColours: "Give each project a colour, shown on its name, stripe and monogram. true or false.",
  groupByWorktree: "Under the Project sort on Active, group root threads that share a worktree under its branch. true or false.",
  stripesIn: `Where the project's stripe shows: ${STRIPE_CHOICES.join(", ")}. "full-and-collapsed" is Full and collapsed mode, "full" Full mode only, "grouped" Grouped projects only.`,
  snoozeShortcuts: `The snooze presets, comma-separated text: durations (1h, 2d) or times (evening@18:00, tomorrow, next-week@09:00), each optionally named as Label=value. At most ${MAX_SNOOZE_ENTRIES} entries.`,
  settleQuietThreads: "Settle a thread with no open pull request once it has been quiet for daysBeforeAutoSettle days. true or false.",
  daysBeforeAutoSettle: `Days a thread is quiet before it is settled automatically. A whole number, ${DAYS_BEFORE_AUTO_SETTLE_RANGE.min} to ${DAYS_BEFORE_AUTO_SETTLE_RANGE.max}.`,
  settleMergedPullRequests: "A merged pull request settles its thread; a closed one always does. true or false.",
  showChildrenNeedingAttention: "Keep children with a status in a closed child list, and on a collapsed shelf or group. true or false.",
  childOrder: `How a thread's children are sorted: ${CHILD_ORDERS.join(", ")}.`,
  childDirection: `Which children come first: ${CHILD_DIRECTIONS.join(", ")}.`,
  childIcon: `A child's mark: ${CHILD_ICONS.join(", ")}.`,
};

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
    if (!isSettingKey(key)) {
      unknown.push(key);
      continue;
    }
    const message = fieldError(key, entry);
    if (message === null) value[key] = entry;
    else errors[key] = message;
  }
  if (unknown.length > 0 || Object.keys(errors).length > 0) return { success: false, errors, unknown };
  return { success: true, value: value as SettingsPatch };
}

/**
 * The record a stored value means. Reading is tolerant: a field that is
 * missing or invalid is its default, so one bad field cannot lose the rest.
 * A record from before Thread display, which has no `threadDisplay`, reads its
 * `compactWorkingThreads` switch as Compact working threads when it was on.
 */
export function readSettings(stored: unknown): Settings {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return { ...DEFAULT_SETTINGS };
  const record = stored as Record<string, unknown>;
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (key in record && fieldError(key, record[key]) === null) settings[key] = record[key];
  }
  if (!("threadDisplay" in record) && record.compactWorkingThreads === true) settings.threadDisplay = "compact-working";
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
