import { describe, expect, it } from "vitest";
import { DEFAULT_SNOOZE_SHORTCUTS } from "./snooze";
import {
  affectsAutoSettle,
  applySettingsPatch,
  changedSettingKeys,
  DEFAULT_SETTINGS,
  readSettings,
  settingsSchema,
  validateSettingsPatch,
} from "./settings";

describe("settings defaults", () => {
  it("are the spec's, with Inactive on", () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe("validateSettingsPatch", () => {
  it("accepts only the edited fields", () => {
    expect(validateSettingsPatch({ hoursBeforeInactive: 12 })).toEqual({ success: true, value: { hoursBeforeInactive: 12 } });
    expect(validateSettingsPatch({})).toEqual({ success: true, value: {} });
  });

  it.each([
    ["hoursBeforeInactive", 0],
    ["hoursBeforeInactive", 721],
    ["hoursBeforeInactive", 1.5],
    ["daysBeforeAutoSettle", 0],
    ["daysBeforeAutoSettle", 91],
    ["daysBeforeAutoSettle", 2.5],
    ["daysBeforeAutoSettle", "3"],
    ["stripesIn", "everywhere"],
    ["childOrder", "alphabetical"],
    ["childDirection", "up"],
    ["childIcon", "emoji"],
    ["inactiveShelf", "yes"],
  ])("refuses %s = %j with a message for that field", (key, value) => {
    const result = validateSettingsPatch({ [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[key as keyof typeof result.errors]).toEqual(expect.any(String));
  });

  it("takes the edges of the ranges", () => {
    expect(validateSettingsPatch({ hoursBeforeInactive: 1, daysBeforeAutoSettle: 90 }).success).toBe(true);
    expect(validateSettingsPatch({ hoursBeforeInactive: 720, daysBeforeAutoSettle: 1 }).success).toBe(true);
  });

  it("refuses days before auto-settle of 0 with its own message and saves nothing", () => {
    expect(validateSettingsPatch({ daysBeforeAutoSettle: 0, workingShelf: true })).toEqual({
      success: false,
      errors: { daysBeforeAutoSettle: "Use at least 1 day." },
      unknown: [],
    });
  });

  it("refuses snooze shortcuts with an invalid entry and says why", () => {
    const result = validateSettingsPatch({ snoozeShortcuts: "1h, nonsense" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.snoozeShortcuts).toContain("nonsense");
  });

  it("reports fields the record does not have", () => {
    expect(validateSettingsPatch({ colour: true })).toEqual({ success: false, errors: {}, unknown: ["colour"] });
    expect(validateSettingsPatch(null).success).toBe(false);
  });
});

describe("readSettings", () => {
  it("reads a field that is invalid or missing as its default and keeps the rest", () => {
    expect(readSettings({ workingShelf: true, hoursBeforeInactive: 0, extra: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      workingShelf: true,
    });
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings([])).toEqual(DEFAULT_SETTINGS);
  });
});

describe("applying a patch", () => {
  it("replaces the edited fields and reports which changed", () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { workingShelf: true, inactiveShelf: true });
    expect(next.workingShelf).toBe(true);
    expect(changedSettingKeys(DEFAULT_SETTINGS, next)).toEqual(["workingShelf"]);
  });

  it("knows which fields change what an auto-settle pass does", () => {
    expect(affectsAutoSettle(["daysBeforeAutoSettle"])).toBe(true);
    expect(affectsAutoSettle(["settleMergedPullRequests"])).toBe(true);
    expect(affectsAutoSettle(["workingShelf"])).toBe(false);
  });
});
