// The "Snooze until" dialog's form: the day and the time typed, and what they
// mean at a given moment. Pure.
import { combineSnoozeDateTime, defaultPickedSnooze, formatWakeTime, snoozeTimeError } from "@/shared/snooze";

export interface PickerForm {
  /** The calendar day picked, or null when none is. */
  date: Date | null;
  /** The time field's `HH:MM`, empty when cleared. */
  time: string;
}

/** The form's start: tomorrow at 09:00. */
export function initialPicker(now: Date): PickerForm {
  return defaultPickedSnooze(now);
}

/** The wake time the form names, epoch ms, or null when it names none. */
export function pickedWake(form: PickerForm): number | null {
  return form.date === null ? null : combineSnoozeDateTime(form.date, form.time);
}

/** Why Snooze is disabled at `now`, or null: the time must be entered, in the future and within a year. */
export function pickerError(form: PickerForm, now: number): string | null {
  return snoozeTimeError(pickedWake(form), now);
}

/** "Wakes Sun, Oct 4, 9:00 AM" while the form names a time that can be picked, else null. */
export function pickerPreview(form: PickerForm, now: number, locale?: string, timeZone?: string): string | null {
  const wake = pickedWake(form);
  if (wake === null || pickerError(form, now) !== null) return null;
  return `Wakes ${formatWakeTime(wake, new Date(now), locale, timeZone)}`;
}
