import { describe, expect, it } from "vitest";
import {
  combineSnoozeDateTime,
  DEFAULT_SNOOZE_SHORTCUTS,
  defaultPickedSnooze,
  formatWakeTime,
  isPickableSnoozeDay,
  MAX_SNOOZE_MS,
  readSnoozePresets,
  resolveSnoozePreset,
  snoozeChoices,
  snoozeShortcutsError,
  snoozeTimeError,
  snoozeWakeLabel,
  TIME_PASSED_REASON,
} from "./snooze";

// Local-time dates throughout: the grammar resolves in the picker's time zone.
const monday1900 = new Date(2026, 9, 12, 19, 0, 0); // Monday, Oct 12 2026
const sunday1000 = new Date(2026, 9, 11, 10, 0, 0);

describe("the default presets", () => {
  const presets = readSnoozePresets(DEFAULT_SNOOZE_SHORTCUTS);

  it("read as the five entries with their labels", () => {
    expect(presets.map((preset) => preset.label)).toEqual([
      "1 hour",
      "Wait refresh (5 hours)",
      "This evening",
      "Tomorrow morning",
      "Next week",
    ]);
  });

  it("on a Monday at 19:00 disable This evening and resolve Next week to next Monday 09:00", () => {
    const choices = snoozeChoices(presets, monday1900);
    expect(choices[2]).toMatchObject({ wakeAt: null, disabledReason: TIME_PASSED_REASON });
    expect(choices[3]?.wakeAt).toBe(new Date(2026, 9, 13, 9, 0).getTime());
    expect(choices[4]?.wakeAt).toBe(new Date(2026, 9, 19, 9, 0).getTime());
    expect(choices.filter((choice) => choice.disabledReason !== null)).toHaveLength(1);
  });

  it("on a Sunday resolve Next week to the next day, a Monday", () => {
    expect(snoozeChoices(presets, sunday1000)[4]?.wakeAt).toBe(new Date(2026, 9, 12, 9, 0).getTime());
  });

  it("add durations to now", () => {
    expect(snoozeChoices(presets, monday1900)[0]?.wakeAt).toBe(monday1900.getTime() + 3_600_000);
  });
});

describe("the grammar", () => {
  it.each([
    ["30m", "30 minutes", 30 * 60_000],
    ["1.5h", "1.5 hours", 90 * 60_000],
    ["2d", "2 days", 2 * 86_400_000],
    ["1w", "1 week", 7 * 86_400_000],
    ["1m", "1 minute", 60_000],
    ["365d", "365 days", 365 * 86_400_000],
  ])("reads the duration %s", (text, label, durationMs) => {
    expect(readSnoozePresets(text)[0]).toMatchObject({ kind: "duration", label, durationMs });
  });

  it("reads calendar entries with their default times and labels", () => {
    const [evening, tomorrow, nextWeek] = readSnoozePresets("evening, tomorrow, next-week");
    expect(evening).toMatchObject({ day: "evening", hour: 18, minute: 0, label: "This evening" });
    expect(tomorrow).toMatchObject({ day: "tomorrow", hour: 9, label: "Tomorrow morning" });
    expect(nextWeek).toMatchObject({ day: "next-week", hour: 9, label: "Next week" });
    expect(readSnoozePresets("tomorrow@07:30")[0]).toMatchObject({ hour: 7, minute: 30 });
  });

  it("takes a label prefix", () => {
    expect(readSnoozePresets("Quick one=15m")[0]?.label).toBe("Quick one");
  });

  it.each([
    ["30s", /30s/],
    ["0m", /1 minute to 365 days/],
    ["366d", /1 minute to 365 days/],
    ["evening@25:00", /HH:MM/],
    ["tomorrow@09:60", /HH:MM/],
    ["soon", /soon/],
    [`${"x".repeat(41)}=1h`, /at most 40/],
  ])("refuses %s on saving, with the reason", (text, reason) => {
    expect(snoozeShortcutsError(`1h, ${text}`)).toMatch(reason);
  });

  it("refuses more than 8 entries, more than 500 characters, and none", () => {
    expect(snoozeShortcutsError("1h,2h,3h,4h,5h,6h,7h,8h")).toBeNull();
    expect(snoozeShortcutsError("1h,2h,3h,4h,5h,6h,7h,8h,9h")).toMatch(/at most 8/);
    expect(snoozeShortcutsError(`${"a".repeat(499)}=1h`)).toMatch(/at most 500/);
    expect(snoozeShortcutsError(" , ")).toMatch(/at least one/);
    expect(snoozeShortcutsError(DEFAULT_SNOOZE_SHORTCUTS)).toBeNull();
  });

  it("drops invalid entries on reading and uses the defaults only when none is left", () => {
    expect(readSnoozePresets("1h, bogus, 2h").map((preset) => preset.label)).toEqual(["1 hour", "2 hours"]);
    expect(readSnoozePresets("bogus, 30s").map((preset) => preset.label)).toEqual(
      readSnoozePresets(DEFAULT_SNOOZE_SHORTCUTS).map((preset) => preset.label),
    );
    expect(readSnoozePresets("")).toHaveLength(5);
  });

  it("reads at most 8 entries", () => {
    expect(readSnoozePresets("1h,2h,3h,4h,5h,6h,7h,8h,9h")).toHaveLength(8);
  });
});

describe("picked times", () => {
  const now = monday1900.getTime();

  it("defaults to tomorrow at 09:00", () => {
    const { date, time } = defaultPickedSnooze(monday1900);
    expect(combineSnoozeDateTime(date, time)).toBe(new Date(2026, 9, 13, 9, 0).getTime());
  });

  it("combines a day and a time, and refuses a malformed time", () => {
    expect(combineSnoozeDateTime(new Date(2026, 9, 13), "13:45")).toBe(new Date(2026, 9, 13, 13, 45).getTime());
    expect(combineSnoozeDateTime(new Date(2026, 9, 13), "")).toBeNull();
    expect(combineSnoozeDateTime(new Date(2026, 9, 13), "24:00")).toBeNull();
  });

  it("says why a time cannot be set", () => {
    expect(snoozeTimeError(null, now)).toBe("Enter a time.");
    expect(snoozeTimeError(Number.NaN, now)).toBe("Enter a time.");
    expect(snoozeTimeError(now - 1, now)).toBe("Pick a time in the future.");
    expect(snoozeTimeError(now, now)).toBe("Pick a time in the future.");
    expect(snoozeTimeError(now + MAX_SNOOZE_MS + 1, now)).toBe("Snooze for at most a year.");
    expect(snoozeTimeError(now + MAX_SNOOZE_MS, now)).toBeNull();
    expect(snoozeTimeError(now + 1, now)).toBeNull();
  });

  it("offers the days from today to a year ahead", () => {
    expect(isPickableSnoozeDay(new Date(2026, 9, 12), monday1900)).toBe(true);
    expect(isPickableSnoozeDay(new Date(2026, 9, 11), monday1900)).toBe(false);
    expect(isPickableSnoozeDay(new Date(2027, 9, 12), monday1900)).toBe(true);
    expect(isPickableSnoozeDay(new Date(2027, 9, 14), monday1900)).toBe(false);
  });

  it("previews the wake time, with the year only when it is not this year", () => {
    const sameYear = formatWakeTime(new Date(2026, 9, 4, 9, 0).getTime(), monday1900, "en-US");
    expect(sameYear).toBe("Sun, Oct 4, 9:00 AM");
    expect(formatWakeTime(new Date(2027, 0, 4, 9, 0).getTime(), monday1900, "en-US")).toBe("Mon, Jan 4, 2027, 9:00 AM");
  });
});

describe("snoozeWakeLabel", () => {
  const now = 1_000_000_000;
  it("rounds up to minutes, hours and days, and reads now once the time has come", () => {
    expect(snoozeWakeLabel(now, now)).toBe("now");
    expect(snoozeWakeLabel(now - 5, now)).toBe("now");
    expect(snoozeWakeLabel(now + 1, now)).toBe("1m");
    expect(snoozeWakeLabel(now + 61_000, now)).toBe("2m");
    expect(snoozeWakeLabel(now + 3_600_000, now)).toBe("1h");
    expect(snoozeWakeLabel(now + 3_600_001, now)).toBe("2h");
    expect(snoozeWakeLabel(now + 86_400_000 + 1, now)).toBe("2d");
  });
});

describe("resolveSnoozePreset", () => {
  it("returns null for a calendar time that has passed today", () => {
    const [evening] = readSnoozePresets("evening@18:00");
    expect(resolveSnoozePreset(evening!, new Date(2026, 9, 12, 18, 0, 0))).toBeNull();
    expect(resolveSnoozePreset(evening!, new Date(2026, 9, 12, 17, 59, 0))).toBe(new Date(2026, 9, 12, 18, 0).getTime());
  });
});
