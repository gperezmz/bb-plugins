import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
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
import { createNoteStore, noteKvKey } from "./notes";
import { preferenceKvKey } from "./preference-store";
import { createStampStore, stampKvKey } from "./stamps";

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
    await bb.storage.kv.set(preferenceKvKey("settleAfter"), "2d");
    const { preferences } = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { settleAfter: string };
    };
    expect(preferences.settleAfter).toBe("1d");
    expect(
      harness.inspection.logEntries.some(
        (entry) => entry.level === "warn" && entry.message.includes("settleAfter"),
      ),
    ).toBe(true);
  });

  it("reads a stored Hidden harness icon as Muted, without a warning", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(preferenceKvKey("harnessIcon"), "hidden");
    const { preferences } = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { harnessIcon: string };
    };
    expect(preferences.harnessIcon).toBe("muted");
    expect(harness.inspection.logEntries.some((entry) => entry.level === "warn")).toBe(false);
  });

  it("ignores values saved under removed settings, and a saved foldOlder leaves Settle after at 1d", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set("preference:foldOlder", false);
    await bb.storage.kv.set("preference:workingFirst", true);
    await bb.storage.kv.set("preference:showPullRequests", false);
    await bb.storage.kv.set("preference:threadLifecycles", ["active", "archived"]);
    const { preferences } = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: Record<string, unknown>;
    };
    expect(preferences).toEqual(defaultPreferences());
    expect(preferences.settleAfter).toBe("1d");
    expect(preferences.showArchived).toBe(false);
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
        bbMirror: { preferences: { environmentGrouping: true } },
      }),
    ).toMatchObject({ source: "local-storage", keys: ["environmentGrouping"] });
  });

  it("falls back to bb's CLI when there is no mirror", async () => {
    const argvFile = fakeBbCli(JSON.stringify({ organizationMode: "chronological" }));
    const { harness } = await load();
    expect(await harness.behavior.callRpc("importPreferences", { bbMirror: null })).toEqual({
      status: "imported",
      source: "cli",
      keys: ["organizationMode"],
    });
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
    expect(existsSync(argvFile)).toBe(false);
    expect(warnings).toEqual([
      "could not tell which bb server Thread Glance runs in (server not listening yet); " +
        "importing nothing from bb's CLI and asking no other server",
    ]);
  });

  it("starts from the defaults, or the browser copy, when its own server has no URL", async () => {
    const argvFile = fakeBbCli(JSON.stringify({ organizationMode: "machine" }));
    const bare = await load({}, "");
    expect(await bare.harness.behavior.callRpc("importPreferences", { bbMirror: null })).toEqual({
      status: "defaults",
      source: "none",
      keys: [],
    });
    expect(await bare.bb.storage.kv.get(IMPORT_MARKER_KEY)).toMatchObject({ source: "none" });
    expect(existsSync(argvFile)).toBe(false);
    expect(
      bare.harness.inspection.logEntries.some(
        (entry) =>
          entry.level === "warn" &&
          entry.message.includes("could not tell which bb server Thread Glance runs in (it has no URL)"),
      ),
    ).toBe(true);
    const mirrored = await load({}, "");
    expect(
      await mirrored.harness.behavior.callRpc("importPreferences", {
        bbMirror: { organizationMode: "chronological" },
      }),
    ).toMatchObject({ source: "local-storage", keys: ["organizationMode"] });
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
        idleAt: {},
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
    expect(await harness.behavior.callRpc("clearSeen", { threadIds: ["a", "c"] })).toEqual({ ok: true });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toBeUndefined();
    expect(signalsOn(harness, CHANNELS.stamps)).toEqual([
      { kind: "seenAt", threadIds: ["a", "b"], value: 5_000 },
      { kind: "seenAt", threadIds: ["a"], value: null },
    ]);
  });

  it("publishes nothing when clearing seenAt finds none", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "a" }) });
    const before = harness.inspection.realtimeSignals.length;
    expect(await harness.behavior.callRpc("clearSeen", { threadIds: ["a", "b"] })).toEqual({ ok: true });
    expect(harness.inspection.realtimeSignals.length).toBe(before);
  });

  it("keeps the later idleAt, so a window reporting late cannot move it back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(6_000);
    const { bb, harness } = await load();
    expect(await harness.behavior.callRpc("markIdle", { threadIds: ["a"] })).toEqual({ at: 6_000 });
    vi.setSystemTime(8_000);
    await harness.behavior.callRpc("markIdle", { threadIds: ["a", "b"] });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toEqual({ idleAt: 8_000 });
    vi.setSystemTime(7_000);
    await harness.behavior.callRpc("markIdle", { threadIds: ["a"] });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toEqual({ idleAt: 8_000 });
    expect(signalsOn(harness, CHANNELS.stamps)).toEqual([
      { kind: "idleAt", threadIds: ["a"], value: 6_000 },
      { kind: "idleAt", threadIds: ["a", "b"], value: 8_000 },
    ]);
    await harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "a" }) });
    expect(await bb.storage.kv.get(stampKvKey("a"))).toBeUndefined();
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

  it("drops an invalid stored row on a cold read and logs it", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(stampKvKey("good"), { finishedAt: 1_000 });
    await bb.storage.kv.set(stampKvKey("bad"), { finishedAt: "yesterday" });
    const { stamps } = (await harness.behavior.callRpc("listStamps", null)) as {
      stamps: { finishedAt: Record<string, number> };
    };
    expect(stamps.finishedAt).toEqual({ good: 1_000 });
    expect(await bb.storage.kv.get(stampKvKey("bad"))).toBeUndefined();
    expect(harness.inspection.logEntries.filter((entry) => entry.level === "warn").map((entry) => entry.message)).toEqual([
      "stored stamps for bad are invalid; dropping them",
    ]);
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

/**
 * Plugin KV over SQLite, shaped as bb 0.44 keeps it: JSON rows namespaced by
 * plugin in one table of a WAL database, each call a synchronous query in the
 * server's own process behind a promise.
 */
function sqliteKv(file: string) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS plugin_kv (plugin_id TEXT, key TEXT, value TEXT, PRIMARY KEY (plugin_id, key))");
  const plugin = "thread-glance";
  const select = db.prepare("SELECT value FROM plugin_kv WHERE plugin_id = ? AND key = ?");
  const keys = db.prepare("SELECT key FROM plugin_kv WHERE plugin_id = ? AND key >= ? AND key < ? ORDER BY key");
  const upsert = db.prepare("INSERT OR REPLACE INTO plugin_kv (plugin_id, key, value) VALUES (?, ?, ?)");
  const remove = db.prepare("DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?");
  return {
    db,
    kv: {
      async get<T>(key: string): Promise<T | undefined> {
        const row = select.get(plugin, key) as { value: string } | undefined;
        return row === undefined ? undefined : (JSON.parse(row.value) as T);
      },
      async set(key: string, value: unknown): Promise<void> {
        upsert.run(plugin, key, JSON.stringify(value));
      },
      async delete(key: string): Promise<void> {
        remove.run(plugin, key);
      },
      async list(prefix = ""): Promise<string[]> {
        return (keys.all(plugin, prefix, `${prefix}\uffff`) as { key: string }[]).map((row) => row.key);
      },
    },
  };
}

// Ledger row B25: the first listStamps and listNotes after a server start, at
// 5,000 stored threads. It records the figures without failing on them; the
// performance ledger enforces the threshold.
describe("cold read benchmark", () => {
  it("reads 1,500 and 5,000 stored threads' stamps and notes", async () => {
    const { db, kv } = sqliteKv(join(tempDir, "bb.db"));
    const bb = {
      storage: { kv },
      realtime: { publish: () => undefined },
      log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    } as unknown as Parameters<typeof createStampStore>[0];
    const insert = db.transaction((from: number, to: number) => {
      for (let i = from; i < to; i++) {
        const id = `thr_${String(i).padStart(6, "0")}`;
        void kv.set(stampKvKey(id), { startedAt: 1_000 + i, finishedAt: 2_000 + i, seenAt: 3_000 + i, idleAt: 2_000 + i });
        void kv.set(noteKvKey(id), { done: { kind: "done", text: `Finished task ${i}.`, at: 2_000 + i } });
      }
    });
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const time = async (read: () => Promise<unknown>) => {
      const start = performance.now();
      await read();
      return performance.now() - start;
    };
    const figures: Record<string, string> = {};
    for (const [from, to] of [[0, 1_500], [1_500, 5_000]]) {
      insert(from, to);
      const stampRuns: number[] = [];
      const noteRuns: number[] = [];
      for (let run = 0; run < 7; run++) {
        stampRuns.push(await time(() => createStampStore(bb).list()));
        noteRuns.push(await time(() => createNoteStore(bb).list()));
      }
      expect(Object.keys((await createStampStore(bb).list()).startedAt)).toHaveLength(to);
      expect(Object.keys(await createNoteStore(bb).list())).toHaveLength(to);
      figures[to] = `listStamps ${median(stampRuns).toFixed(1)} ms, listNotes ${median(noteRuns).toFixed(1)} ms`;
    }
    db.close();
    process.stdout.write(`B25 cold read (median of 7): ${JSON.stringify(figures)}\n`);
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

    for (const period of ["12h", "1d", "3d", "1w", "never"]) {
      const settle = await harness.behavior.runCli(["prefs", "set", "settleAfter", period]);
      expect(settle).toMatchObject({ exitCode: 0, stdout: `settleAfter = "${period}"` });
    }

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

    for (const removed of ["workingFirst", "foldOlder", "showPullRequests", "threadLifecycles"]) {
      const result = await harness.behavior.runCli(["prefs", "set", removed, "true", "--json"]);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "unknown_preference" } });
    }

    const hidden = await harness.behavior.runCli(["prefs", "set", "harnessIcon", "hidden", "--json"]);
    expect(JSON.parse(hidden.stdout)).toMatchObject({ ok: false, error: { code: "invalid_preference_value" } });

    const invalid = await harness.behavior.runCli(["prefs", "set", "organizationMode", "sideways", "--json"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      error: { code: "invalid_preference_value", message: expect.stringContaining("organizationMode") },
    });
  });
});
