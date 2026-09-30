import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { CHANNELS, STAMP_KINDS, type RecordsSignal, type Stamps, type ThreadRecord } from "../shared/signals";
import { defaultPreferences } from "../shared/preferences";
import { createBbCliReader, IMPORT_MARKER_KEY } from "./import";
import { noteKvKey } from "./notes";
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

type Harness = Awaited<ReturnType<typeof load>>["harness"];

interface SyncAnswer {
  epoch: string;
  revision: number;
  full: boolean;
  preferences: Record<string, unknown>;
  scheduled: { status: string; scheduled: Record<string, number> };
  records: Record<string, ThreadRecord>;
}

/** `sync` from a window that has seen nothing, or since the point of an earlier answer. */
async function sync(harness: Harness, since: { epoch: string; revision: number } | null = null): Promise<SyncAnswer> {
  const point = since === null ? null : { epoch: since.epoch, revision: since.revision };
  return (await harness.behavior.callRpc("sync", { since: point })) as SyncAnswer;
}

/** The stamps a first `sync` carries, one map per kind. */
async function stampsOf(harness: Harness): Promise<Stamps> {
  const stamps: Stamps = { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {}, idleAt: {} };
  for (const [threadId, record] of Object.entries((await sync(harness)).records)) {
    for (const kind of STAMP_KINDS) {
      const value = record.stamps?.[kind];
      if (value !== undefined) stamps[kind][threadId] = value;
    }
  }
  return stamps;
}

/** One thread's stamps as the server stores them, as a first `sync` carries them. */
async function storedStamps(harness: Harness, threadId: string) {
  return (await sync(harness)).records[threadId]?.stamps ?? undefined;
}

/** The records each `records` signal carried, in order. */
function recordSignals(harness: Harness): Record<string, ThreadRecord>[] {
  return signalsOn(harness, CHANNELS.records).map((signal) => (signal as RecordsSignal).records);
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
    expect((await sync(harness)).preferences).toEqual(defaultPreferences());
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
    const { preferences } = (await sync(harness)) as unknown as {
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
    const { preferences } = (await sync(harness)) as unknown as {
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
    const { preferences } = (await sync(harness)) as unknown as {
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
  it("stamps lifecycle events and publishes each event's changes in one signal", async () => {
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
    expect(await stampsOf(harness)).toEqual({
      startedAt: { t1: 1_000 },
      finishedAt: { t1: 3_000, t2: 4_000 },
      pendingAt: { t1: 2_000 },
      seenAt: {},
      idleAt: { t1: 3_000, t2: 4_000 },
    });
    expect(recordSignals(harness).map((records) => Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record.stamps])))).toEqual([
      { t1: { startedAt: 1_000 } },
      { t1: { startedAt: 1_000, pendingAt: 2_000, idleAt: 2_000 } },
      { t1: { startedAt: 1_000, pendingAt: 2_000, finishedAt: 3_000, idleAt: 3_000 } },
      { t2: { finishedAt: 4_000, idleAt: 4_000 } },
    ]);
  });

  it("marks and clears seenAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(5_000);
    const { harness } = await load();
    expect(await harness.behavior.callRpc("markSeen", { threadIds: ["a", "b"] })).toEqual({
      at: 5_000,
    });
    expect(await storedStamps(harness, "a")).toEqual({ seenAt: 5_000 });
    expect(await harness.behavior.callRpc("clearSeen", { threadIds: ["a", "c"] })).toEqual({ ok: true });
    expect(await storedStamps(harness, "a")).toBeUndefined();
    expect(recordSignals(harness)).toEqual([
      { a: { stamps: { seenAt: 5_000 }, notes: null }, b: { stamps: { seenAt: 5_000 }, notes: null } },
      { a: { stamps: null, notes: null } },
    ]);
  });

  it("publishes nothing when clearing seenAt finds none", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "a" }) });
    const before = harness.inspection.realtimeSignals.length;
    expect(await harness.behavior.callRpc("clearSeen", { threadIds: ["a", "b"] })).toEqual({ ok: true });
    expect(harness.inspection.realtimeSignals.length).toBe(before);
  });

  it("keeps the later idleAt, so an event carrying an earlier moment cannot move it back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(6_000);
    const { harness } = await load();
    const a = makeThreadResponse({ id: "a" });
    await harness.behavior.emitThreadEvent("thread.idle", { thread: a, lastAssistantText: null });
    vi.setSystemTime(8_000);
    await harness.behavior.emitThreadEvent("thread.failed", { thread: a, error: null });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "b" }),
      lastAssistantText: null,
    });
    expect(await storedStamps(harness, "a")).toEqual({ finishedAt: 8_000, idleAt: 8_000 });
    vi.setSystemTime(7_000);
    await harness.behavior.emitThreadEvent("interaction.pending", { thread: a, interaction: {} as never });
    expect(await storedStamps(harness, "a")).toEqual({ finishedAt: 8_000, idleAt: 8_000, pendingAt: 7_000 });
    expect(recordSignals(harness).map((records) => Object.entries(records).map(([id, record]) => [id, record.stamps?.idleAt]))).toEqual([
      [["a", 6_000]],
      [["a", 8_000]],
      [["b", 8_000]],
      [["a", 8_000]],
    ]);
  });

  // One signal per busy-to-idle change, whatever the number of windows, none
  // of which has a request to send for it.
  it("records a thread going idle once, with no request from any window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(9_000);
    const { harness } = await load();
    await sync(harness);
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "p" }),
      lastAssistantText: null,
    });
    expect(recordSignals(harness)).toEqual([
      { p: { stamps: { finishedAt: 9_000, idleAt: 9_000 }, notes: null } },
    ]);
  });

  it("records a reported idle moment only when it is later than the stored one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "p" }), lastAssistantText: null });
    vi.setSystemTime(9_000);
    expect(await harness.behavior.callRpc("reportIdle", { threadIds: ["p"] })).toEqual({ ok: true });
    vi.setSystemTime(12_000);
    await harness.behavior.callRpc("reportIdle", { threadIds: ["p"] });
    await harness.behavior.callRpc("reportIdle", { threadIds: ["p"] });
    expect(await storedStamps(harness, "p")).toEqual({ finishedAt: 10_000, idleAt: 12_000 });
    expect(recordSignals(harness).map((records) => records.p?.stamps?.idleAt)).toEqual([10_000, 12_000]);
  });

  it("forgets a deleted thread's stamps, publishing its record as gone", async () => {
    const { harness } = await load();
    const thread = makeThreadResponse({ id: "t1" });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread });
    expect(await storedStamps(harness, "t1")).toBeUndefined();
    expect(recordSignals(harness).at(-1)).toEqual({ t1: { stamps: null, notes: null } });
  });

  it("drops an invalid stored row on a cold read and logs it", async () => {
    const { bb, harness } = await load();
    await bb.storage.kv.set(stampKvKey("good"), { finishedAt: 1_000 });
    await bb.storage.kv.set(stampKvKey("bad"), { finishedAt: "yesterday" });
    const stamps = await stampsOf(harness);
    expect(stamps.finishedAt).toEqual({ good: 1_000 });
    expect(await bb.storage.kv.get(stampKvKey("bad"))).toBeUndefined();
    expect(harness.inspection.logEntries.filter((entry) => entry.level === "warn").map((entry) => entry.message)).toEqual([
      "stored stamps for bad are invalid; dropping them",
    ]);
  });

  it("reloads stored stamps after a restart", async () => {
    const first = await load();
    await first.harness.behavior.callRpc("markSeen", { threadIds: ["t1"] });
    const restarted = await first.harness.lifecycle.reload(plugin);
    const stamps = await stampsOf(restarted.harness);
    expect(Object.keys(stamps.seenAt)).toEqual(["t1"]);
  });
});

describe("sync", () => {
  it("answers everything first, then only what changed since the window's revision", async () => {
    const { harness } = await load();
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "a" }) });
    await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "b" }) });
    const first = await sync(harness);
    expect(first).toMatchObject({ full: true, preferences: defaultPreferences(), scheduled: { status: "error", scheduled: {} } });
    expect(Object.keys(first.records).sort()).toEqual(["a", "b"]);

    const unchanged = await sync(harness, first);
    expect(unchanged).toMatchObject({ full: false, records: {}, revision: first.revision });

    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "b" }), lastAssistantText: "Done." });
    await harness.behavior.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "a" }) });
    const delta = await sync(harness, first);
    expect(delta.full).toBe(false);
    expect(delta.records).toEqual({
      a: { stamps: null, notes: null },
      b: { stamps: expect.objectContaining({ finishedAt: expect.any(Number) }), notes: { done: expect.objectContaining({ text: "Done." }) } },
    });
    expect(delta.revision).toBeGreaterThan(first.revision);
  });

  it("answers in full to a window from an earlier server start", async () => {
    const first = await load();
    await first.harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "a" }) });
    const seen = await sync(first.harness);
    const { harness } = await first.harness.lifecycle.reload(plugin);
    const answer = await sync(harness, seen);
    expect(answer.epoch).not.toBe(seen.epoch);
    expect(answer).toMatchObject({ full: true, records: { a: expect.any(Object) } });
  });
});

describe("the move from KV", () => {
  // A 0.7.0 server's KV rows: stamps and notes, one of them invalid.
  async function seedKv(bb: Awaited<ReturnType<typeof load>>["bb"]) {
    await bb.storage.kv.set(stampKvKey("a"), { startedAt: 1_000, finishedAt: 2_000, seenAt: 3_000 });
    await bb.storage.kv.set(stampKvKey("b"), { pendingAt: 4_000, idleAt: 4_000 });
    await bb.storage.kv.set(noteKvKey("a"), { done: { kind: "done", text: "All done.", at: 2_000 } });
    await bb.storage.kv.set(noteKvKey("c"), { failed: { kind: "failed", text: "Out of credits", at: 5_000 } });
    await bb.storage.kv.set("preference:organizationMode", "machine");
  }

  it("moves every stamp and note into the database unchanged, then removes their KV rows", async () => {
    const { bb, harness } = await load();
    await seedKv(bb);
    expect((await sync(harness)).records).toEqual({
      a: {
        stamps: { startedAt: 1_000, finishedAt: 2_000, seenAt: 3_000 },
        notes: { done: { kind: "done", text: "All done.", at: 2_000 } },
      },
      b: { stamps: { pendingAt: 4_000, idleAt: 4_000 }, notes: null },
      c: { stamps: null, notes: { failed: { kind: "failed", text: "Out of credits", at: 5_000 } } },
    });
    expect(await bb.storage.kv.list("stamp:")).toEqual([]);
    expect(await bb.storage.kv.list("note:")).toEqual([]);
    expect(await bb.storage.kv.get("preference:organizationMode")).toBe("machine");
    const db = bb.storage.database();
    expect(db.prepare("SELECT * FROM stamps ORDER BY thread_id").all()).toEqual([
      { thread_id: "a", started_at: 1_000, finished_at: 2_000, seen_at: 3_000, idle_at: null, pending_at: null },
      { thread_id: "b", started_at: null, finished_at: null, seen_at: null, idle_at: 4_000, pending_at: 4_000 },
    ]);
    expect(harness.inspection.logEntries.filter((entry) => entry.level === "info").map((entry) => entry.message)).toEqual([
      "moved the stamps of 2 threads from KV into the plugin database",
      "moved the notes of 2 threads from KV into the plugin database",
    ]);
  });

  it("moves nothing on a second start", async () => {
    const first = await load();
    await seedKv(first.bb);
    await sync(first.harness);
    const { bb, harness } = await first.harness.lifecycle.reload(plugin);
    const before = harness.inspection.logEntries.length;
    expect(Object.keys((await sync(harness)).records).sort()).toEqual(["a", "b", "c"]);
    expect(harness.inspection.logEntries.slice(before).filter((entry) => entry.message.startsWith("moved"))).toEqual([]);
    expect(bb.storage.database().prepare("SELECT count(*) AS n FROM stamps").get()).toEqual({ n: 2 });
  });

  it("keeps every KV row when the move fails before it commits", async () => {
    const { bb, harness } = await load();
    await seedKv(bb);
    const db = bb.storage.database();
    // The insert fails midway, as a crash inside the transaction would leave it.
    db.exec("CREATE TRIGGER fail_b BEFORE INSERT ON stamps WHEN NEW.thread_id = 'b' BEGIN SELECT RAISE(ABORT, 'disk gone'); END");
    await expect(sync(harness)).rejects.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM stamps").get()).toEqual({ n: 0 });
    expect((await bb.storage.kv.list("stamp:")).sort()).toEqual([stampKvKey("a"), stampKvKey("b")]);
    db.exec("DROP TRIGGER fail_b");
    const restarted = await harness.lifecycle.reload(plugin);
    expect(Object.keys((await sync(restarted.harness)).records).sort()).toEqual(["a", "b", "c"]);
    expect(await restarted.bb.storage.kv.list("stamp:")).toEqual([]);
  });

  it("neither loses nor duplicates when a restart comes after the commit and before the KV rows are removed", async () => {
    const { bb, harness } = await load();
    await seedKv(bb);
    await sync(harness);
    // The KV rows back, as a restart between the commit and their removal leaves them.
    await seedKv(bb);
    const db = bb.storage.database();
    // A write after the commit that the KV copy must not overwrite.
    db.prepare("UPDATE stamps SET started_at = 9000, finished_at = NULL, seen_at = NULL WHERE thread_id = 'a'").run();
    const restarted = await harness.lifecycle.reload(plugin);
    const { records } = await sync(restarted.harness);
    expect(records.a?.stamps).toEqual({ startedAt: 9_000 });
    expect(records.b?.stamps).toEqual({ pendingAt: 4_000, idleAt: 4_000 });
    const reopened = restarted.bb.storage.database();
    expect(reopened.prepare("SELECT count(*) AS n FROM stamps").get()).toEqual({ n: 2 });
    expect(reopened.prepare("SELECT count(*) AS n FROM notes").get()).toEqual({ n: 2 });
    expect(await restarted.bb.storage.kv.list("stamp:")).toEqual([]);
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
    const stored = () =>
      (bb.storage.database().prepare("SELECT thread_id FROM stamps ORDER BY thread_id").all() as { thread_id: string }[]).map(
        (row) => row.thread_id,
      );
    const service = harness.behavior.runService("startup");
    await vi.waitFor(() => {
      expect(stored()).toEqual(["live", "old"]);
    });
    expect(recordSignals(harness).at(-1)).toEqual({ gone: { stamps: null, notes: null } });
    const listCalls = harness.inspection.sdk.callsTo("threads.list");
    expect(listCalls.map((args) => (args[0] as { archived: boolean }).archived)).toEqual([
      false,
      true,
    ]);
    expect(listCalls[0]?.[0]).toMatchObject({ includeHidden: true });
    service.controller.abort();
    await service.done;
  });

  it("has a full sync wait for the startup listing, so archived records stay out right after a start", async () => {
    let answerList: () => void = () => undefined;
    const listed = new Promise<void>((resolve) => (answerList = resolve));
    const { bb, harness } = await load({
      threads: {
        list: (async (args?: { archived?: boolean }) => {
          await listed;
          return args?.archived ? [makeThreadResponse({ id: "old" })] : [makeThreadResponse({ id: "live" })];
        }) as never,
        queue: { list: async () => [] },
      },
    });
    await bb.storage.kv.set(stampKvKey("live"), { finishedAt: 1 });
    await bb.storage.kv.set(stampKvKey("old"), { finishedAt: 2 });
    const service = harness.behavior.runService("startup");
    const answer = sync(harness);
    answerList();
    expect(Object.keys((await answer).records)).toEqual(["live"]);
    service.controller.abort();
    await service.done;
  });

  it("leaves archived threads' records out of a full sync, and serves them by id", async () => {
    const { bb, harness } = await load({
      threads: {
        list: threadsListStub(["live"], ["old"]) as never,
        queue: { list: async () => [] },
      },
    });
    await bb.storage.kv.set(stampKvKey("live"), { finishedAt: 1 });
    await bb.storage.kv.set(stampKvKey("old"), { finishedAt: 2 });
    // Until the startup listing arrives, nothing is known archived.
    expect(Object.keys((await sync(harness)).records).sort()).toEqual(["live", "old"]);
    const service = harness.behavior.runService("startup");
    await vi.waitFor(async () => {
      expect(Object.keys((await sync(harness)).records)).toEqual(["live"]);
    });
    expect(await harness.behavior.callRpc("fetchArchived", { threadIds: ["old", "never"] })).toMatchObject({
      records: { old: { stamps: { finishedAt: 2 }, notes: null } },
    });
    await harness.behavior.emitThreadEvent("thread.unarchived", { thread: makeThreadResponse({ id: "old" }) });
    expect(Object.keys((await sync(harness)).records).sort()).toEqual(["live", "old"]);
    await harness.behavior.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id: "live" }) });
    expect(Object.keys((await sync(harness)).records)).toEqual(["old"]);
    // Archiving keeps the record, as it is.
    expect((await harness.behavior.callRpc("fetchArchived", { threadIds: ["live"] })) as { records: unknown }).toMatchObject({
      records: { live: { stamps: { finishedAt: 1 }, notes: null } },
    });
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
      expect((await sync(harness)).scheduled).toEqual({
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
    expect((await sync(harness)).scheduled).toEqual({
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

  it("refuses unknown and removed keys with their code, publishing nothing", async () => {
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
  });
});
