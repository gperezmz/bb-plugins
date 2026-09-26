import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { CHANNELS } from "../shared/contract";
import { defaultPreferences } from "../shared/preferences";
import { createBbCliReader, IMPORT_MARKER_KEY } from "./import";
import { preferenceKvKey } from "./preference-store";
import { stampKvKey } from "./stamps";

type Overrides = NonNullable<Parameters<typeof createFakePluginHost>[0]>["sdk"];

async function load(sdk: Overrides = {}, loopbackBaseUrl?: string) {
  const host = createFakePluginHost({ pluginId: "thread-glance", sdk, loopbackBaseUrl });
  await plugin(host.bb);
  return host;
}

function signalsOn(harness: Awaited<ReturnType<typeof load>>["harness"], channel: string) {
  return harness.inspection.realtimeSignals
    .filter((signal) => signal.channel === channel)
    .map((signal) => signal.payload);
}

let tempDir: string;
const savedBbCli = process.env.BB_CLI;
const savedServerUrl = process.env.BB_SERVER_URL;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "thread-glance-test-"));
  process.env.BB_CLI = join(tempDir, "missing-bb");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (savedBbCli === undefined) delete process.env.BB_CLI;
  else process.env.BB_CLI = savedBbCli;
  if (savedServerUrl === undefined) delete process.env.BB_SERVER_URL;
  else process.env.BB_SERVER_URL = savedServerUrl;
  vi.useRealTimers();
});

/** Points BB_CLI at a script that prints `output` and records its argv. */
function fakeBbCli(output: string): string {
  const script = join(tempDir, "bb");
  const argvFile = join(tempDir, "argv");
  writeFileSync(
    script,
    `#!/bin/sh\necho "$@" > '${argvFile}'\ncat <<'JSON'\n${output}\nJSON\n`,
  );
  chmodSync(script, 0o755);
  process.env.BB_CLI = script;
  return argvFile;
}

/**
 * Points BB_CLI at a script standing in for two bb servers on one machine: it
 * prints `own` when BB_SERVER_URL names `ownUrl`, and `other` otherwise, as the
 * CLI would for whichever server it asked.
 */
function fakeTwoServerBbCli(ownUrl: string, own: string, other: string): void {
  const script = join(tempDir, "bb");
  writeFileSync(
    script,
    `#!/bin/sh\nif [ "$BB_SERVER_URL" = '${ownUrl}' ]; then\ncat <<'JSON'\n${own}\nJSON\nelse\ncat <<'JSON'\n${other}\nJSON\nfi\n`,
  );
  chmodSync(script, 0o755);
  process.env.BB_CLI = script;
}

describe("preferences", () => {
  it("lists the defaults when nothing is stored", async () => {
    const { harness } = await load();
    expect(await harness.behavior.callRpc("listPreferences", null)).toEqual({
      preferences: defaultPreferences(),
    });
  });

  it("stores, publishes and resets a value", async () => {
    const { bb, harness } = await load();
    expect(
      await harness.behavior.callRpc("setPreference", { key: "organizationMode", value: "machine" }),
    ).toEqual({ key: "organizationMode", value: "machine" });
    expect(await bb.storage.kv.get(preferenceKvKey("organizationMode"))).toBe("machine");
    expect(await harness.behavior.callRpc("resetPreference", { key: "organizationMode" })).toEqual({
      key: "organizationMode",
      value: "project",
    });
    expect(await bb.storage.kv.get(preferenceKvKey("organizationMode"))).toBeUndefined();
    expect(signalsOn(harness, CHANNELS.preferences)).toEqual([
      { key: "organizationMode", value: "machine" },
      { key: "organizationMode", value: "project" },
    ]);
  });

  it("rejects an invalid value with an error that names the key", async () => {
    const { harness } = await load();
    await expect(
      harness.behavior.callRpc("setPreference", { key: "organizationMode", value: "sideways" }),
    ).rejects.toThrow(/organizationMode/);
    expect(signalsOn(harness, CHANNELS.preferences)).toEqual([]);
  });

  it("reads an invalid stored value as the default and warns", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(preferenceKvKey("foldOlder"), "yes");
    const { preferences } = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { foldOlder: boolean };
    };
    expect(preferences.foldOlder).toBe(true);
    expect(
      harness.inspection.logEntries.some(
        (entry) => entry.level === "warn" && entry.message.includes("foldOlder"),
      ),
    ).toBe(true);
  });
});

describe("importPreferences", () => {
  it("imports bb's localStorage mirror once, skipping defaults and stored keys", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(preferenceKvKey("sortDirection"), "ascending");
    const mirror = {
      organizationMode: "machine",
      environmentGrouping: "auto",
      sortDirection: "descending",
      collapsedThreads: ["t1"],
      collapsedProjects: ["p1"],
      threadLifecycles: ["active"],
    };
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: mirror })).toEqual({
      status: "imported",
      source: "local-storage",
      keys: ["organizationMode", "collapsedProjects"],
    });
    expect(await bb.storage.kv.get(preferenceKvKey("sortDirection"))).toBe("ascending");
    expect(signalsOn(harness, CHANNELS.preferences)).toEqual([
      { key: "organizationMode", value: "machine" },
      { key: "collapsedProjects", value: ["p1"] },
    ]);
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: mirror })).toEqual({
      status: "already-imported",
      source: null,
      keys: [],
    });
  });

  it("unwraps a mirror sent as a JSON string or a { preferences } object", async () => {
    const first = await load();
    expect(
      await first.harness.behavior.callRpc("importPreferences", {
        bbMirror: JSON.stringify({ organizationMode: "machine" }),
      }),
    ).toMatchObject({ source: "local-storage", keys: ["organizationMode"] });
    const second = await load();
    expect(
      await second.harness.behavior.callRpc("importPreferences", {
        bbMirror: { preferences: { workingFirst: true } },
      }),
    ).toMatchObject({ source: "local-storage", keys: ["workingFirst"] });
  });

  it("falls back to bb's CLI when there is no mirror", async () => {
    const argvFile = fakeBbCli(JSON.stringify({ organizationMode: "chronological" }));
    const { harness } = await load();
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: null })).toEqual({
      status: "imported",
      source: "cli",
      keys: ["organizationMode"],
    });
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(argvFile, "utf8").trim()).toBe("thread-list prefs list --json");
  });

  it.each([
    ["the CLI's default server", undefined],
    ["the server BB_SERVER_URL names", "http://127.0.0.1:38886"],
  ])("reads its own server's preferences, never %s", async (_, inherited) => {
    const ownUrl = "http://127.0.0.1:41886";
    if (inherited === undefined) delete process.env.BB_SERVER_URL;
    else process.env.BB_SERVER_URL = inherited;
    fakeTwoServerBbCli(
      ownUrl,
      JSON.stringify({ organizationMode: "machine" }),
      JSON.stringify({ organizationMode: "chronological" }),
    );
    const { bb, harness } = await load({}, ownUrl);
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: null })).toEqual({
      status: "imported",
      source: "cli",
      keys: ["organizationMode"],
    });
    expect(await bb.storage.kv.get(preferenceKvKey("organizationMode"))).toBe("machine");
  });

  it("falls back to bb's CLI when the mirror holds no bb preferences", async () => {
    fakeBbCli(JSON.stringify({ organizationMode: "machine" }));
    const { harness } = await load();
    expect(
      await harness.behavior.callRpc("importPreferences", { bbMirror: { unrelated: 1 } }),
    ).toMatchObject({ source: "cli", keys: ["organizationMode"] });
  });

  it("uses the defaults and marks the import done when every source fails", async () => {
    const { bb, harness } = await load();
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: null })).toEqual({
      status: "defaults",
      source: "none",
      keys: [],
    });
    expect(await bb.storage.kv.get(IMPORT_MARKER_KEY)).toMatchObject({ source: "none" });
    expect(
      harness.inspection.logEntries.some((entry) => entry.message.includes("thread-list prefs")),
    ).toBe(true);
  });

  it("asks no server when it cannot tell which one it runs in", async () => {
    const argvFile = fakeBbCli(JSON.stringify({ organizationMode: "machine" }));
    const warnings: string[] = [];
    const log = { ...createFakePluginHost().bb.log, warn: (message: string) => warnings.push(message) };
    const read = createBbCliReader(log, () => {
      throw new Error("server not listening yet");
    });
    expect(await read()).toBeNull();
    const { existsSync } = await import("node:fs");
    expect(existsSync(argvFile)).toBe(false);
    expect(warnings).toEqual([
      "could not tell which bb server Thread Glance runs in (server not listening yet); " +
        "importing nothing from bb's CLI and asking no other server",
    ]);
  });

  it("runs once when two windows import at the same time", async () => {
    const { harness } = await load();
    const results = await Promise.all([
      harness.behavior.callRpc("importPreferences", { bbMirror: { organizationMode: "machine" } }),
      harness.behavior.callRpc("importPreferences", { bbMirror: { organizationMode: "machine" } }),
    ]);
    expect(results.map((result) => (result as { status: string }).status).sort()).toEqual([
      "already-imported",
      "imported",
    ]);
  });
});

describe("stamps", () => {
  it("stamps lifecycle events and publishes each change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const { harness } = await load();
    const thread = makeThreadResponse({ id: "t1" });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    vi.setSystemTime(2_000);
    await harness.behavior.emitThreadEvent("interaction.pending", {
      thread,
      interaction: {} as never,
    });
    vi.setSystemTime(3_000);
    await harness.behavior.emitThreadEvent("thread.idle", { thread, lastAssistantText: null });
    vi.setSystemTime(4_000);
    await harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "t2" }),
      error: null,
    });
    expect(await harness.behavior.callRpc("listStamps", null)).toEqual({
      stamps: {
        startedAt: { t1: 1_000 },
        finishedAt: { t1: 3_000, t2: 4_000 },
        pendingAt: { t1: 2_000 },
        seenAt: {},
      },
    });
    expect(signalsOn(harness, CHANNELS.stamps)).toEqual([
      { kind: "startedAt", threadIds: ["t1"], value: 1_000 },
      { kind: "pendingAt", threadIds: ["t1"], value: 2_000 },
      { kind: "finishedAt", threadIds: ["t1"], value: 3_000 },
      { kind: "finishedAt", threadIds: ["t2"], value: 4_000 },
    ]);
  });

  it("marks and clears seenAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);
    const { bb, harness } = await load();
    expect(await harness.behavior.callRpc("markSeen", { threadIds: ["a", "b"] })).toEqual({
      at: 5_000,
    });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toEqual({ seenAt: 5_000 });
    expect(await harness.behavior.callRpc("clearSeen", { threadIds: ["a"] })).toEqual({ ok: true });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toBeUndefined();
    expect(signalsOn(harness, CHANNELS.stamps)).toEqual([
      { kind: "seenAt", threadIds: ["a", "b"], value: 5_000 },
      { kind: "seenAt", threadIds: ["a"], value: null },
    ]);
  });

  it("forgets a deleted thread's stamps without publishing", async () => {
    const { bb, harness } = await load();
    const thread = makeThreadResponse({ id: "t1" });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    const before = harness.inspection.realtimeSignals.length;
    await harness.behavior.emitThreadEvent("thread.deleted", { thread });
    expect(await bb.storage.kv.get(stampKvKey("t1"))).toBeUndefined();
    expect(harness.inspection.realtimeSignals.length).toBe(before);
  });

  it("reloads stored stamps after a restart", async () => {
    const first = await load();
    await first.harness.behavior.callRpc("markSeen", { threadIds: ["t1"] });
    await first.harness.lifecycle.reload(plugin);
    const { stamps } = (await first.harness.behavior.callRpc("listStamps", null)) as {
      stamps: { seenAt: Record<string, number> };
    };
    expect(Object.keys(stamps.seenAt)).toEqual(["t1"]);
  });
});

describe("startup service", () => {
  function threadsListStub(active: string[], archived: string[]) {
    return async (args?: { archived?: boolean; limit?: number; offset?: number }) => {
      const ids = args?.archived ? archived : active;
      const offset = args?.offset ?? 0;
      return ids.slice(offset, offset + (args?.limit ?? ids.length)).map((id) =>
        makeThreadResponse({ id }),
      );
    };
  }

  it("prunes stamps of threads bb no longer lists, keeping archived and hidden ones", async () => {
    const { bb, harness } = await load({
      threads: {
        list: threadsListStub(["live"], ["old"]) as never,
        queue: { list: async () => [] },
      },
    });
    await bb.storage.kv.set(stampKvKey("live"), { finishedAt: 1 });
    await bb.storage.kv.set(stampKvKey("old"), { finishedAt: 1 });
    await bb.storage.kv.set(stampKvKey("gone"), { finishedAt: 1 });
    const service = harness.behavior.runService("startup");
    await vi.waitFor(async () => {
      expect(await bb.storage.kv.get(stampKvKey("gone"))).toBeUndefined();
    });
    expect(await bb.storage.kv.list("stamp:")).toEqual(
      expect.arrayContaining([stampKvKey("live"), stampKvKey("old")]),
    );
    const listCalls = harness.inspection.sdk.callsTo("threads.list");
    expect(listCalls.map((args) => (args[0] as { archived: boolean }).archived)).toEqual([
      false,
      true,
    ]);
    expect(listCalls[0]?.[0]).toMatchObject({ includeHidden: true });
    service.controller.abort();
    await service.done;
  });

  it("seeds scheduled sends and follows queue events", async () => {
    const future = Date.now() + 60_000;
    const { harness } = await load({
      threads: {
        list: threadsListStub([], []) as never,
        queue: {
          list: async () => [makeQueueEntry({ id: "q1", threadId: "t1", sendAt: future })],
        },
      },
    });
    const service = harness.behavior.runService("startup");
    await vi.waitFor(async () => {
      expect(await harness.behavior.callRpc("listScheduled", null)).toEqual({
        status: "ready",
        scheduled: { t1: future },
      });
    });
    await harness.behavior.emitThreadEvent("message.queued", {
      entry: makeQueueEntry({ id: "q2", threadId: "t2", sendAt: future + 1 }),
    });
    await harness.behavior.emitThreadEvent("message.dispatched", {
      entry: makeQueueEntry({ id: "q1", threadId: "t1" }),
    });
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "t2" }),
    });
    expect(signalsOn(harness, CHANNELS.scheduled)).toEqual([
      { status: "ready", scheduled: { t1: future } },
      { status: "ready", scheduled: { t1: future, t2: future + 1 } },
      { status: "ready", scheduled: { t2: future + 1 } },
      { status: "ready", scheduled: {} },
    ]);
    service.controller.abort();
    await service.done;
  });

  it("reports error when the queue cannot be listed", async () => {
    const { harness } = await load({
      threads: {
        list: threadsListStub([], []) as never,
        queue: {
          list: async () => {
            throw new Error("offline");
          },
        },
      },
    });
    const service = harness.behavior.runService("startup");
    await vi.waitFor(() => {
      expect(harness.inspection.sdk.callsTo("threads.queue.list")).toHaveLength(1);
    });
    expect(await harness.behavior.callRpc("listScheduled", null)).toEqual({
      status: "error",
      scheduled: {},
    });
    service.controller.abort();
    await service.done;
  });
});

describe("bb thread-glance prefs", () => {
  it("lists, gets, sets and resets through the store", async () => {
    const { harness } = await load();
    const list = await harness.behavior.runCli(["prefs", "list", "--json"]);
    expect(JSON.parse(list.stdout)).toEqual(defaultPreferences());

    const set = await harness.behavior.runCli(["prefs", "set", "organizationMode", "machine"]);
    expect(set).toMatchObject({ exitCode: 0, stdout: 'organizationMode = "machine"' });
    expect(signalsOn(harness, CHANNELS.preferences)).toEqual([{ key: "organizationMode", value: "machine" }]);

    const get = await harness.behavior.runCli(["prefs", "get", "organizationMode", "--json"]);
    expect(JSON.parse(get.stdout)).toEqual({ key: "organizationMode", value: "machine" });

    const setList = await harness.behavior.runCli([
      "prefs",
      "set",
      "collapsedSections",
      '["pinned"]',
    ]);
    expect(setList.exitCode).toBe(0);

    const reset = await harness.behavior.runCli(["prefs", "reset", "organizationMode"]);
    expect(reset.stdout).toBe('organizationMode = "project"');
  });

  it("reports unknown keys and invalid values with codes and hints", async () => {
    const { harness } = await load();
    const unknown = await harness.behavior.runCli(["prefs", "get", "colour", "--json"]);
    expect(unknown.exitCode).not.toBe(0);
    expect(JSON.parse(unknown.stdout)).toMatchObject({
      ok: false,
      error: { code: "unknown_preference" },
    });

    const tree = await harness.behavior.runCli(["prefs", "set", "nesting", "tree", "--json"]);
    expect(JSON.parse(tree.stdout)).toMatchObject({ ok: false, error: { code: "unknown_preference" } });
    expect(signalsOn(harness, CHANNELS.preferences)).toEqual([]);

    const invalid = await harness.behavior.runCli(["prefs", "set", "organizationMode", "sideways", "--json"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      error: { code: "invalid_preference_value", message: expect.stringContaining("organizationMode") },
    });
  });
});
