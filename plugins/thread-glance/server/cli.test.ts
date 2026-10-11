import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server";
import { DEFAULT_SETTINGS, SETTING_DESCRIPTIONS, SETTING_KEYS } from "../shared/settings";
import { CHANNELS, type Versioned } from "../shared/signals";

async function load() {
  const host = createFakePluginHost({ pluginId: "thread-glance" });
  await plugin(host.bb);
  return host.harness;
}
type Harness = Awaited<ReturnType<typeof load>>;

const stored = async (harness: Harness) =>
  (await harness.behavior.callRpc("sync", { since: null }) as { settings: Versioned<typeof DEFAULT_SETTINGS> }).settings.value;

const settingsSignals = (harness: Harness) =>
  harness.inspection.realtimeSignals.filter((signal) => signal.channel === CHANNELS.settings);

/** The error a failing command reports under `--json`. */
async function refusal(harness: Harness, argv: string[]) {
  const result = await harness.behavior.runCli([...argv, "--json"]);
  expect(result.exitCode).toBe(1);
  return (JSON.parse(result.stdout ?? "") as { error: { code: string; message: string; hint: string } }).error;
}

describe("bb thread-glance prefs", () => {
  it("lists all 15 keys with a value and a description, as lines and as JSON", async () => {
    const harness = await load();
    const lines = (await harness.behavior.runCli(["prefs", "list"])).stdout?.split("\n") ?? [];
    expect(SETTING_KEYS).toHaveLength(15);
    expect(lines.map((line) => line.split("\t")[0])).toEqual(SETTING_KEYS);
    for (const line of lines) {
      const [key, value, description] = line.split("\t");
      expect(JSON.parse(value ?? "")).toEqual(DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]);
      expect(description?.length).toBeGreaterThan(10);
    }
    const json = await harness.behavior.runCli(["prefs", "list", "--json"]);
    expect(JSON.parse(json.stdout ?? "")).toEqual(DEFAULT_SETTINGS);
  });

  it("sets a value that get prints, that sync serves and that every open window is told", async () => {
    const harness = await load();
    const before = settingsSignals(harness).length;
    const set = await harness.behavior.runCli(["prefs", "set", "hoursBeforeInactive", "12"]);
    expect(set).toMatchObject({ exitCode: 0, stdout: "hoursBeforeInactive = 12" });
    expect((await harness.behavior.runCli(["prefs", "get", "hoursBeforeInactive"])).stdout).toBe("12");
    expect((await harness.behavior.runCli(["prefs", "get", "hoursBeforeInactive", "--json"])).stdout).toBe('{"key":"hoursBeforeInactive","value":12}');
    expect((await stored(harness)).hoursBeforeInactive).toBe(12);
    const signals = settingsSignals(harness);
    expect(signals).toHaveLength(before + 1);
    expect((signals.at(-1)?.payload as Versioned<typeof DEFAULT_SETTINGS>).value.hoursBeforeInactive).toBe(12);
  });

  it("lists what is stored, not the defaults", async () => {
    const harness = await load();
    await harness.behavior.runCli(["prefs", "set", "hoursBeforeInactive", "12"]);
    const lines = (await harness.behavior.runCli(["prefs", "list"])).stdout?.split("\n") ?? [];
    expect(lines.find((line) => line.startsWith("hoursBeforeInactive\t"))?.split("\t")[1]).toBe("12");
    const json = JSON.parse((await harness.behavior.runCli(["prefs", "list", "--json"])).stdout ?? "") as Record<string, unknown>;
    expect(json.hoursBeforeInactive).toBe(12);
  });

  it("reads a bare word as a string and a JSON word as its value", async () => {
    const harness = await load();
    expect((await harness.behavior.runCli(["prefs", "set", "childOrder", "activity", "--json"])).stdout).toBe('{"key":"childOrder","value":"activity"}');
    expect((await harness.behavior.runCli(["prefs", "set", "workingShelf", "true"])).stdout).toBe("workingShelf = true");
    expect((await stored(harness))).toMatchObject({ childOrder: "activity", workingShelf: true });
  });

  it("resets to the default and publishes it", async () => {
    const harness = await load();
    await harness.behavior.runCli(["prefs", "set", "hoursBeforeInactive", "12"]);
    const reset = await harness.behavior.runCli(["prefs", "reset", "hoursBeforeInactive"]);
    expect(reset.stdout).toBe("hoursBeforeInactive = 6");
    expect((await harness.behavior.runCli(["prefs", "reset", "childOrder", "--json"])).stdout).toBe('{"key":"childOrder","value":"created"}');
    expect((await stored(harness)).hoursBeforeInactive).toBe(6);
    expect((settingsSignals(harness).at(-1)?.payload as Versioned<typeof DEFAULT_SETTINGS>).value.hoursBeforeInactive).toBe(6);
  });

  it.each([
    ["hoursBeforeInactive", "0", "Use at least 1 hour."],
    ["hoursBeforeInactive", "2.5", "Enter a whole number of hours."],
    ["childOrder", "sideways", "Use one of: created, activity."],
    ["snoozeShortcuts", "soon", "soon"],
    ["workingShelf", "yes", "Use on or off."],
  ])("refuses set %s %s with invalid_preference_value, a hint describing the key and nothing stored", async (key, value, why) => {
    const harness = await load();
    const signals = settingsSignals(harness).length;
    const error = await refusal(harness, ["prefs", "set", key, value]);
    expect(error.code).toBe("invalid_preference_value");
    expect(error.message).toContain(`${key}:`);
    expect(error.message).toContain(why);
    expect(error.hint).toBe(SETTING_DESCRIPTIONS[key as keyof typeof SETTING_DESCRIPTIONS]);
    expect(await stored(harness)).toEqual(DEFAULT_SETTINGS);
    expect(settingsSignals(harness)).toHaveLength(signals);
  });

  it.each(["organizationMode", "hiddenGroups", "nope"])("refuses the key %s with unknown_preference and lists the current keys", async (key) => {
    const harness = await load();
    for (const argv of [["set", key, "project"], ["get", key], ["reset", key]]) {
      const error = await refusal(harness, ["prefs", ...argv]);
      expect(error.code).toBe("unknown_preference");
      expect(error.hint).toBe(`Known preferences: ${SETTING_KEYS.join(", ")}.`);
    }
    expect(await stored(harness)).toEqual(DEFAULT_SETTINGS);
  });
});
