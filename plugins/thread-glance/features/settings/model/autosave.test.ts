// The saving rule of the settings page, without rendering it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from "@/shared/settings";
import { createAutosave, SAVE_DELAY_MS } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A host whose writes wait for `finish`, and then apply to the settings it reads. */
function slowHost() {
  let settings: Settings = DEFAULT_SETTINGS;
  const written: SettingsPatch[] = [];
  const pending: (() => void)[] = [];
  const host = {
    current: () => settings,
    write: (patch: SettingsPatch) =>
      new Promise<void>((resolve) => {
        written.push(patch);
        pending.push(() => {
          settings = { ...settings, ...patch };
          resolve();
        });
      }),
    failed: () => {},
  };
  return { host, written, finish: () => pending.shift()!() };
}

describe("a field edited again while its save is in flight", () => {
  it("stays an edit, is saved after the first save, and ends saved", async () => {
    const { host, written, finish } = slowHost();
    const autosave = createAutosave(host);
    autosave.edit("hoursBeforeInactive", "8");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(written).toEqual([{ hoursBeforeInactive: 8 }]);

    autosave.edit("hoursBeforeInactive", "9");
    finish();
    await vi.advanceTimersByTimeAsync(0);
    // The answer to the first save does not clear the newer edit, and the heading still says saving.
    expect(autosave.state().edits).toEqual({ hoursBeforeInactive: "9" });
    expect(autosave.state().status).toBe("saving");

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(written).toEqual([{ hoursBeforeInactive: 8 }, { hoursBeforeInactive: 9 }]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.state().edits).toEqual({});
    expect(autosave.state().status).toBe("saved");
  });
});
