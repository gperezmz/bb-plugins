// The "Snooze until" form's meaning at a moment (AC5, picker half).
import { describe, expect, it } from "vitest";
import { initialPicker, pickedWake, pickerError, pickerPreview } from "./snooze-form";

const NOW = new Date(2026, 9, 3, 14, 30).getTime(); // Sat, Oct 3 2026

describe("snooze form", () => {
  it("starts at tomorrow 09:00, which can be picked and previews the wake time", () => {
    const form = initialPicker(new Date(NOW));
    expect(pickedWake(form)).toBe(new Date(2026, 9, 4, 9, 0).getTime());
    expect(pickerError(form, NOW)).toBeNull();
    expect(pickerPreview(form, NOW, "en-US")).toBe("Wakes Sun, Oct 4, 9:00 AM");
  });

  it("shows the year in the preview only when it is not this year", () => {
    const form = { date: new Date(2027, 0, 5), time: "10:15" };
    expect(pickerPreview(form, NOW, "en-US")).toBe("Wakes Tue, Jan 5, 2027, 10:15 AM");
  });

  it("asks for a time when the field is empty or no day is picked", () => {
    expect(pickerError({ date: new Date(2026, 9, 4), time: "" }, NOW)).toBe("Enter a time.");
    expect(pickerError({ date: null, time: "09:00" }, NOW)).toBe("Enter a time.");
  });

  it("refuses a time in the past with 'Pick a time in the future.' and previews nothing", () => {
    const form = { date: new Date(2026, 9, 3), time: "09:00" };
    expect(pickerError(form, NOW)).toBe("Pick a time in the future.");
    expect(pickerPreview(form, NOW)).toBeNull();
  });

  it("refuses more than a year with 'Snooze for at most a year.'", () => {
    expect(pickerError({ date: new Date(2027, 11, 1), time: "09:00" }, NOW)).toBe("Snooze for at most a year.");
  });
});
