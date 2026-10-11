// What the settings page holds between the person's typing and the server's
// answer: the edited fields as typed, what of them can be sent, and what is
// wrong with the rest.
import {
  SETTING_KEYS,
  validateSettingsPatch,
  type Settings,
  type SettingKey,
  type SettingsErrors,
  type SettingsPatch,
} from "@/shared/settings";

/** The fields the person has edited and not yet saved, as typed (numbers stay text). */
export type Edits = Partial<Record<SettingKey, unknown>>;

/** Every field as the page shows it: the edit where there is one, else the server's value. */
export type ShownSettings = Record<SettingKey, unknown>;

const NUMBER_KEYS: ReadonlySet<SettingKey> = new Set(["hoursBeforeInactive", "daysBeforeAutoSettle"]);

/** The value a typed edit means; text that is no number becomes NaN, which the field's schema refuses. */
export function coerceEdit(key: SettingKey, typed: unknown): unknown {
  if (!NUMBER_KEYS.has(key) || typeof typed !== "string") return typed;
  return typed.trim() === "" ? Number.NaN : Number(typed);
}

export function shownSettings(server: Settings, edits: Edits): ShownSettings {
  const shown: Record<string, unknown> = { ...server };
  for (const key of SETTING_KEYS) if (key in edits) shown[key] = edits[key];
  return shown as ShownSettings;
}

export interface EditAssessment {
  /** The valid edits that differ from the server's settings: what to send. */
  patch: SettingsPatch;
  /** The inline message of each invalid edit. */
  errors: SettingsErrors;
  /** Edited fields whose value is the server's already, which need no sending. */
  unchanged: SettingKey[];
}

/** Sorts the edits into what to send, what to refuse and what already holds. */
export function assessEdits(server: Settings, edits: Edits): EditAssessment {
  const meant: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) if (key in edits) meant[key] = coerceEdit(key, edits[key]);
  const whole = validateSettingsPatch(meant);
  const errors = whole.success ? {} : whole.errors;
  const valid = Object.fromEntries(Object.entries(meant).filter(([key]) => !(key in errors)));
  const checked = validateSettingsPatch(valid);
  const accepted: Record<string, unknown> = checked.success ? checked.value : {};
  const patch: Record<string, unknown> = {};
  const unchanged: SettingKey[] = [];
  for (const [key, value] of Object.entries(accepted)) {
    if (server[key as SettingKey] === value) unchanged.push(key as SettingKey);
    else patch[key] = value;
  }
  return { patch: patch as SettingsPatch, errors, unchanged };
}
