// Pins every text a person or the CLI reads when a value is refused, as 0.7.0
// gave it: `bb thread-glance prefs set`, each RPC method's validation, and
// the warning for a corrupt stored preference.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "zod/mini";
import plugin from "../server";
import type { PreferenceKey } from "../shared/preferences";
import { preferenceKvKey } from "./preference-store";

// zod keeps its locale on globalThis, and the SDK's test host loads full zod,
// which sets English. Cleared, the texts come from what the plugin sets.
beforeEach(() => {
  config({ localeError: undefined });
});

async function load() {
  const host = createFakePluginHost({ pluginId: "thread-glance" });
  await plugin(host.bb);
  return host;
}

const LONG_ID = "a".repeat(1025);
const TOO_MANY = JSON.stringify(Array.from({ length: 10_001 }, (_, index) => `id${index}`));

/** At least one invalid value per key, as typed on the command line. */
const INVALID: [PreferenceKey, string][] = [
  ["showArchived", "yes"],
  ["organizationMode", "sideways"],
  ["environmentGrouping", "1"],
  ["chronologicalSort", "random"],
  ["sortDirection", "up"],
  ["sectionOrder", '[""]'],
  ["sectionOrder", '"pinned"'],
  ["manualSectionOrder", "[1]"],
  ["machineSectionOrder", "null"],
  ["hiddenGroups", '["project:"]'],
  ["hiddenGroups", '["pinned"]'],
  ["hiddenGroups", "{}"],
  ["collapsedSections", '["projects"]'],
  ["collapsedProjects", "{}"],
  ["collapsedThreadSections", TOO_MANY],
  ["collapsedMachines", "true"],
  ["collapsedEnvironments", JSON.stringify([LONG_ID])],
  ["expandedOlder", "[null]"],
  ["openSettledFolds", '"g"'],
  ["settleAfter", "2d"],
  ["expandedChildren", "42"],
  ["childAttention", "all"],
  ["harnessIcon", "hidden"],
];

function failureFields(error: unknown) {
  const { code, message, issues } = error as { code: string; message: string; issues?: unknown };
  return { code, message, issues };
}

/** Names a case by its key and value, the value cut short. */
const invalidCases = INVALID.map(([key, value]) => ({
  key,
  value,
  name: `${key} ${value.length > 40 ? `${value.slice(0, 37)}...` : value}`,
}));

/** At least one invalid input per RPC method; a label stands in for a long one. */
const RPC_CASES = ([
  ["listPreferences", {}],
  ["setPreference", { key: "colour", value: "red" }],
  ["setPreference", { key: "organizationMode", value: "sideways" }],
  ["setPreference", { key: "organizationMode", value: "machine", extra: 1 }],
  ["resetPreference", { key: 1 }],
  ["importPreferences", { bbMirror: null, extra: true }],
  ["importPreferences", "mirror"],
  ["listStamps", { all: true }],
  ["markSeen", { threadIds: [""] }],
  ["markSeen", { threadIds: JSON.parse(TOO_MANY) as string[] }, "10001 ids"],
  ["clearSeen", { threadIds: "t1" }],
  ["markIdle", { threadIds: [LONG_ID] }, "an id of 1025 characters"],
  ["markIdle", {}],
  ["listNotes", 1],
  ["listScheduled", []],
] as [string, unknown, string?][]).map(([method, input, label]) => ({
  method,
  input,
  label: label ?? JSON.stringify(input),
}));

describe("refusal texts", () => {
  it.each(invalidCases)("bb thread-glance prefs set $name", async ({ key, value }) => {
    const { harness } = await load();
    const plain = await harness.behavior.runCli(["prefs", "set", key, value]);
    const json = await harness.behavior.runCli(["prefs", "set", key, value, "--json"]);
    expect({ plain, json }).toMatchSnapshot();
  });

  it.each(RPC_CASES)("rpc $method refuses $label", async ({ method, input }) => {
    const { harness } = await load();
    const error = await harness.behavior.callRpc(method, input).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeDefined();
    expect(failureFields(error)).toMatchSnapshot();
  });

  it.each(invalidCases)("a stored $name logs its warning", async ({ key, value }) => {
    const { bb, harness } = await load();
    let stored: unknown;
    try {
      stored = JSON.parse(value);
    } catch {
      stored = value;
    }
    await bb.storage.kv.set(preferenceKvKey(key), stored);
    await harness.behavior.callRpc("listPreferences", null);
    const warnings = harness.inspection.logEntries
      .filter((entry) => entry.level === "warn")
      .map((entry) => entry.message);
    expect(warnings).toMatchSnapshot();
  });
});
