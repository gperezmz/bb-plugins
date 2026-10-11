// Snooze presets: the grammar of the snooze shortcuts setting, what each entry
// resolves to, and the checks on a wake time. Pure. Calendar entries resolve
// in the local time zone of whoever picks one, so the browser resolves a
// preset and the server only checks the time it is handed.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const DEFAULT_SNOOZE_SHORTCUTS = "1h, Wait refresh (5 hours)=5h, evening@18:00, tomorrow@09:00, next-week@09:00";
export const MAX_SNOOZE_ENTRIES = 8;
export const MAX_SNOOZE_SHORTCUTS_LENGTH = 500;
export const MAX_SNOOZE_LABEL_LENGTH = 40;
/** The shortest and longest duration an entry may be, and the furthest a wake time may lie ahead. */
export const MIN_SNOOZE_MS = MINUTE_MS;
export const MAX_SNOOZE_MS = 365 * DAY_MS;

/** The disabled reason of a preset whose time has passed today. */
export const TIME_PASSED_REASON = "Today's time has passed";

const DURATION_UNITS = { m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: WEEK_MS } as const;
const DURATION_WORDS = { m: "minute", h: "hour", d: "day", w: "week" } as const;
const CALENDAR_LABELS = { evening: "This evening", tomorrow: "Tomorrow morning", "next-week": "Next week" } as const;

export type CalendarDay = keyof typeof CALENDAR_LABELS;

type PresetBody = { label: string } & (
  | { kind: "duration"; durationMs: number }
  | { kind: "calendar"; day: CalendarDay; hour: number; minute: number }
);

/** One snooze preset: a menu entry with its label and the rule for its wake time. */
export type SnoozePreset = { id: string } & PresetBody;

type Entry = { ok: true; preset: PresetBody } | { ok: false; reason: string };

const CALENDAR_PATTERN = /^(evening|tomorrow|next-week)(?:@(\d{1,2}):(\d{2}))?$/;
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*([mhdw])$/;
const EXAMPLE = "1h, Wait refresh=5h, evening@18:00, tomorrow@09:00 or next-week@09:00";

function parseEntry(entry: string): Entry {
  const separator = entry.indexOf("=");
  const label = separator >= 0 ? entry.slice(0, separator).trim() : "";
  const value = (separator >= 0 ? entry.slice(separator + 1) : entry).trim().toLowerCase();
  if (label.length > MAX_SNOOZE_LABEL_LENGTH) {
    return { ok: false, reason: `"${entry}": a label is at most ${MAX_SNOOZE_LABEL_LENGTH} characters.` };
  }
  const calendar = CALENDAR_PATTERN.exec(value);
  if (calendar !== null) {
    const day = calendar[1] as CalendarDay;
    const hour = Number(calendar[2] ?? (day === "evening" ? 18 : 9));
    const minute = Number(calendar[3] ?? 0);
    if (hour > 23 || minute > 59) {
      return { ok: false, reason: `"${entry}": the time must be HH:MM, from 00:00 to 23:59.` };
    }
    return { ok: true, preset: { kind: "calendar", label: label || CALENDAR_LABELS[day], day, hour, minute } };
  }
  const duration = DURATION_PATTERN.exec(value);
  if (duration === null) return { ok: false, reason: `"${entry}": use a duration or a calendar time, such as ${EXAMPLE}.` };
  const amount = Number(duration[1]);
  const unit = duration[2] as keyof typeof DURATION_UNITS;
  const durationMs = amount * DURATION_UNITS[unit];
  if (!Number.isFinite(durationMs) || durationMs < MIN_SNOOZE_MS || durationMs > MAX_SNOOZE_MS) {
    return { ok: false, reason: `"${entry}": a duration runs from 1 minute to 365 days.` };
  }
  const shown = String(Number(amount.toFixed(2)));
  const generated = `${shown} ${DURATION_WORDS[unit]}${amount === 1 ? "" : "s"}`;
  return { ok: true, preset: { kind: "duration", label: label || generated, durationMs } };
}

/** The non-empty entries of the shortcuts text. */
function entriesOf(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Why the shortcuts text cannot be saved, or null when it can. Saving is
 * strict: at most 500 characters and 8 entries, at least one entry, and every
 * entry valid. The reason names the first entry that is not.
 */
export function snoozeShortcutsError(text: string): string | null {
  if (text.length > MAX_SNOOZE_SHORTCUTS_LENGTH) {
    return `Use at most ${MAX_SNOOZE_SHORTCUTS_LENGTH} characters.`;
  }
  const entries = entriesOf(text);
  if (entries.length === 0) return "Enter at least one snooze shortcut.";
  if (entries.length > MAX_SNOOZE_ENTRIES) return `Use at most ${MAX_SNOOZE_ENTRIES} snooze shortcuts.`;
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed.ok) return parsed.reason;
  }
  return null;
}

function parseValid(text: string): SnoozePreset[] {
  const presets: SnoozePreset[] = [];
  for (const entry of entriesOf(text.slice(0, MAX_SNOOZE_SHORTCUTS_LENGTH))) {
    const parsed = parseEntry(entry);
    if (parsed.ok && presets.length < MAX_SNOOZE_ENTRIES) {
      presets.push({ ...parsed.preset, id: `preset-${presets.length}` });
    }
  }
  return presets;
}

/**
 * The presets a stored shortcuts text means. Reading is tolerant: invalid
 * entries and entries past the limits are dropped, and the defaults stand in
 * only when none is left.
 */
export function readSnoozePresets(text: string): SnoozePreset[] {
  const presets = parseValid(text);
  return presets.length > 0 ? presets : parseValid(DEFAULT_SNOOZE_SHORTCUTS);
}

/**
 * The wake time of `preset` picked at `now`, in `now`'s local time zone, or
 * null when it has already passed today. Duration presets add to `now`; a
 * calendar preset is a day plus a time, and `next-week` is the next Monday
 * strictly after today.
 */
export function resolveSnoozePreset(preset: SnoozePreset, now: Date): number | null {
  if (preset.kind === "duration") return now.getTime() + preset.durationMs;
  const addDays =
    preset.day === "next-week" ? ((1 - now.getDay() + 7) % 7 || 7) : preset.day === "tomorrow" ? 1 : 0;
  const wake = new Date(now);
  // Calendar-day arithmetic keeps the local hour across a clock change.
  wake.setDate(wake.getDate() + addDays);
  wake.setHours(preset.hour, preset.minute, 0, 0);
  return wake.getTime() > now.getTime() ? wake.getTime() : null;
}

/** A preset as a menu shows it: enabled with its wake time, or disabled with the reason. */
export interface SnoozeChoice {
  preset: SnoozePreset;
  wakeAt: number | null;
  /** "Today's time has passed" when the preset cannot be picked now. */
  disabledReason: string | null;
}

/** The menu choices for `presets` at `now`. */
export function snoozeChoices(presets: readonly SnoozePreset[], now: Date): SnoozeChoice[] {
  return presets.map((preset) => {
    const wakeAt = resolveSnoozePreset(preset, now);
    return { preset, wakeAt, disabledReason: wakeAt === null ? TIME_PASSED_REASON : null };
  });
}

/** Why a wake time cannot be set, or null: it must be a time, in the future and within a year. */
export function snoozeTimeError(until: number | null, now: number): string | null {
  if (until === null || !Number.isFinite(until)) return "Enter a time.";
  if (until <= now) return "Pick a time in the future.";
  if (until - now > MAX_SNOOZE_MS) return "Snooze for at most a year.";
  return null;
}

/** "5m", "2h" or "3d" until the wake, rounded up, and "now" once it has come. */
export function snoozeWakeLabel(until: number, now: number): string {
  const remaining = until - now;
  if (remaining <= 0) return "now";
  if (remaining < HOUR_MS) return `${Math.max(1, Math.ceil(remaining / MINUTE_MS))}m`;
  if (remaining < DAY_MS) return `${Math.ceil(remaining / HOUR_MS)}h`;
  return `${Math.ceil(remaining / DAY_MS)}d`;
}

/** A wake time as the toast and the picker's preview show it: "Sun, Oct 4, 9:00 AM", with the year only when it is not this year. */
export function formatWakeTime(until: number, now: Date, locale?: string, timeZone?: string): string {
  const wake = new Date(until);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(wake.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(wake);
}

/** Where "Pick date & time…" starts: tomorrow at 09:00. */
export function defaultPickedSnooze(now: Date): { date: Date; time: string } {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return { date, time: "09:00" };
}

/** A picked calendar day and an `HH:MM` time as epoch ms in local time, or null when the time is not `HH:MM`. */
export function combineSnoozeDateTime(date: Date, time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const wake = new Date(date);
  wake.setHours(hour, minute, 0, 0);
  return wake.getTime();
}

/** Whether the calendar offers `day`: not before today and not after a year from `now`. */
export function isPickableSnoozeDay(day: Date, now: Date): boolean {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDay = new Date(day);
  startOfDay.setHours(0, 0, 0, 0);
  return startOfDay.getTime() >= startOfToday.getTime() && startOfDay.getTime() <= now.getTime() + MAX_SNOOZE_MS;
}
