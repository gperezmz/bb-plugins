// The ports service through the plugin's RPCs, with the real host entry behind
// a fake system and the SDK's fake plugin host: what AC2 and AC7 promise end
// to end, and auto-settle reading GitHub PR Status through the SDK (#330).
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createHostEntry } from "../../host/handlers";
import { createSystemProbe } from "../../host/probe";
import { createFakeSystem, linuxListener, procStat, type FakeSystem } from "../../host/testing/fake-system";
import plugin from "../../server";
import { CHANNELS, type Versioned } from "../../shared/signals";
import type { PortsSnapshot } from "../../shared/ports";
import { CAPTURED_PULL_REQUESTS } from "../../testing/github-pr-status";
import { listedThread, sdkWith } from "../testing/fakes";
import { SETTLE_WAIT_MS } from "./clean";

const SECRET = "s3cr3t";
const LSOF = "lsof -nP -iTCP -sTCP:LISTEN -F pcn +c 0";

function linux(): FakeSystem {
  const sockets = linuxListener(4242, 5173);
  return createFakeSystem({
    platform: "linux",
    dirs: sockets.dirs,
    files: {
      ...sockets.files,
      "/proc/stat": "btime 1700000000\n",
      "/proc/4242/stat": procStat(4242, "node", 123_456),
      "/proc/4242/cmdline": `node\0server.js\0--token=${SECRET}\0`,
      "/proc/4242/environ": `PATH=/bin\0TG_TEST_SECRET=${SECRET}\0BB_THREAD_ID=thr_abc123\0`,
    },
    links: { ...sockets.links, "/proc/4242/cwd": "/work/app/web", "/proc/4242/exe": "/usr/bin/node" },
  });
}

function macos(): FakeSystem {
  const command = `node server.js --token=${SECRET}`;
  return createFakeSystem({
    platform: "darwin",
    commands: {
      [LSOF]: "p4242\ncnode\nf21\nn127.0.0.1:5173\n",
      [`${LSOF} -a -p 4242`]: "p4242\ncnode\nf21\nn127.0.0.1:5173\n",
      "lsof -a -d cwd -Fn -p 4242": "p4242\nfcwd\nn/work/app/web\n",
      "ps -ww -o lstart=,comm= -p 4242": "Sat Oct 11 07:04:05 2026 /usr/local/bin/node\n",
      "ps -ww -o command= -p 4242": `${command}\n`,
      "ps eww -o command= -p 4242": `${command} PATH=/usr/bin TG_TEST_SECRET=${SECRET} BB_THREAD_ID=thr_abc123\n`,
    },
  });
}

/**
 * bb's GitHub PR Status plugin, as `bb.sdk.plugins` reaches it: `answer` gives
 * the rows for the environments asked, every one absent by default, and
 * `enabled`, read at each call, false refuses every call as bb refuses a
 * disabled plugin.
 */
function githubPrStatus(options: { answer?: (keys: string[]) => Record<string, unknown>; enabled?: boolean } = {}) {
  const enabled = () => options.enabled ?? true;
  const answer = options.answer ?? ((): Record<string, unknown> => ({}));
  return {
    async callRpc({ pluginId, method, input }: { pluginId: string; method: string; input: { keys: string[] } }) {
      if (pluginId !== "bb--github-pr-status" || method !== "pullRequests") throw new Error(`unexpected ${pluginId}.${method}`);
      if (!enabled()) throw new Error('HTTP 503: plugin "bb--github-pr-status" is not running (status: disabled)');
      const rows = answer(input.keys);
      return Object.fromEntries(input.keys.map((key) => [key, rows[key] ?? { outcome: "absent" }]));
    },
    async list() {
      return { plugins: [{ id: "bb--github-pr-status", enabled: enabled() }] };
    },
  };
}

/** The plugin over a fake bb whose threads hold one idle thread, working in /work/app, and whose host entry is the real one over `system`. */
async function load(
  system: FakeSystem,
  options: { threads?: ReturnType<typeof listedThread>[]; hostFails?: boolean; pullRequests?: Parameters<typeof githubPrStatus>[0] } = {},
) {
  const environmentLookup = { fails: false };
  const kill = vi.fn();
  const entry = createHostEntry(createSystemProbe(system), kill);
  const replies: unknown[] = [];
  const threads = options.threads ?? [
    listedThread("thr_abc123", { environmentId: "env-1", environmentHostId: "host-1", environmentPath: "/work/app", createdAt: 1_000, updatedAt: 1_000 }),
  ];
  const closes: string[] = [];
  const sdk = sdkWith(() => threads, () => [], {
    plugins: githubPrStatus(options.pullRequests),
    environments: {
      async get({ environmentId }: { environmentId: string }) {
        if (environmentLookup.fails) throw new Error("bb is busy");
        const thread = threads.find((candidate) => candidate.environmentId === environmentId);
        return { id: environmentId, hostId: "host-1", path: thread?.environmentPath ?? null };
      },
      async list() {
        return [];
      },
    },
    terminals: {
      async list() {
        return { sessions: [{ id: "term-1", status: "running", lastUserInputAt: 5 }] };
      },
      async get({ terminalId }: { terminalId: string }) {
        return { id: terminalId, status: "running", lastUserInputAt: 5 };
      },
      async close({ terminalId, mode }: { terminalId: string; mode: string }) {
        closes.push(`${terminalId} ${mode}`);
      },
    },
  });
  const host = createFakePluginHost({
    pluginId: "thread-glance",
    sdk,
    experimental_callHostRpc: async (call) => {
      if (options.hostFails) throw new Error("the host is unreachable");
      const handler = entry.handlers[call.method as keyof typeof entry.handlers] as (input: unknown, context: never) => unknown;
      const reply = await handler(call.input, {} as never);
      replies.push(reply);
      return reply;
    },
  });
  await plugin(host.bb);
  return { host, harness: host.harness, kill, replies, closes, environmentLookup };
}

const ports = async (harness: Awaited<ReturnType<typeof load>>["harness"], fresh = true) =>
  (await harness.behavior.callRpc("ports", { fresh })) as Versioned<PortsSnapshot>;

/**
 * Runs Clean with its settle wait on a fake clock, advanced one settle wait at
 * a time until Clean answers, however long Clean takes to reach the wait.
 */
async function runClean(harness: Awaited<ReturnType<typeof load>>["harness"], token: string) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let answered = false;
    const running = harness.behavior.callRpc("runClean", { token }).finally(() => (answered = true));
    while (!answered) await vi.advanceTimersByTimeAsync(SETTLE_WAIT_MS);
    return await running;
  } finally {
    vi.useRealTimers();
  }
}

describe.each([
  ["Linux", linux],
  ["macOS", macos],
])("the secret of a process on %s never leaves the host (AC2)", (_name, system) => {
  it("is in no host reply, snapshot, signal, stored preview, RPC answer or log line", async () => {
    const { host, harness, replies, closes, kill } = await load(system());
    const snapshot = await ports(harness);
    expect(snapshot.value.environments["env-1"].listeners).toMatchObject([
      { port: 5173, process: "node", pid: 4242, ownerThreadId: "thr_abc123", container: null },
    ]);

    await harness.behavior.callRpc("settle", { threadId: "thr_abc123" });
    const preview = (await harness.behavior.callRpc("previewClean", { projectIds: [] })) as { token: string; threads: unknown[] };
    expect(preview.threads).toMatchObject([{ threadId: "thr_abc123", terminals: 1, ports: [{ port: 5173, process: "node" }] }]);
    const ran = await runClean(harness, preview.token);
    expect(ran, JSON.stringify(ran)).toMatchObject({ expired: false, closedTerminals: 1, portRequests: 1 });
    expect(closes).toEqual(["term-1 force"]);
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");

    const stored = host.bb.storage.database().prepare("SELECT data FROM clean_previews").all();
    const everything = JSON.stringify({
      replies,
      calls: harness.inspection.experimental_hostRpcCalls,
      snapshot,
      signals: harness.inspection.realtimeSignals,
      preview,
      ran,
      stored,
      logs: harness.inspection.logEntries,
    });
    expect(replies.length).toBeGreaterThan(0);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("--token");
    expect(everything).not.toContain("TG_TEST_SECRET");
  });
});

describe("the ports RPC and channel", () => {
  it("answers the snapshot as a versioned value, publishes it on the channel once, and shares the scan", async () => {
    const { harness } = await load(linux());
    const first = await ports(harness, false);
    const second = await ports(harness, false);
    expect(second.version).toBe(first.version);
    expect(second.epoch).toBe(first.epoch);
    const published = harness.inspection.realtimeSignals.filter((signal) => signal.channel === CHANNELS.ports);
    expect(published).toHaveLength(1);
    expect(harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "scan")).toHaveLength(1);
  });

  it("answers with no listeners and no failure for a machine that does not support ports", async () => {
    const { harness } = await load(createFakeSystem({ platform: "win32" }));
    expect((await ports(harness)).value).toMatchObject({ environments: {}, failedHosts: [] });
  });

  it("keeps the last snapshot, and lists no failure, when one refresh errors (AC3)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let fail = false;
      const system = linux();
      const flaky = {
        ...system,
        readFile: (path: string) => (fail && path.startsWith("/proc/net/") ? Promise.reject(new Error("EIO")) : system.readFile(path)),
      };
      const { harness } = await load(flaky as FakeSystem);
      const before = await ports(harness);
      expect(Object.keys(before.value.environments)).toEqual(["env-1"]);
      fail = true;
      vi.setSystemTime(Date.now() + 31_000);
      const after = await ports(harness, false);
      expect(harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "scan")).toHaveLength(2);
      expect(after.value.environments).toEqual(before.value.environments);
      expect(after.value.failedHosts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("when bb cannot say where the environments are", () => {
  const DAY = 24 * 60 * 60 * 1_000;

  it("answers the previous snapshot, and auto-settle settles nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const old = Date.now() - 9 * DAY;
      const { harness, environmentLookup } = await load(linux(), {
        threads: [
          listedThread("thr_abc123", { environmentId: "env-1", environmentHostId: "host-1", environmentPath: "/work/app", createdAt: old, updatedAt: old, latestAttentionAt: old }),
        ],
      });
      const before = await ports(harness);
      expect(Object.keys(before.value.environments)).toEqual(["env-1"]);
      environmentLookup.fails = true;
      // Past the environment cache (60 s) and the snapshot (30 s).
      vi.setSystemTime(Date.now() + 61_000);
      const after = await ports(harness, false);
      expect(after.value.environments).toEqual(before.value.environments);
      expect(((await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] }).settled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Stop through the plugin (AC4)", () => {
  it("refuses a port, PID or start time the snapshot does not list and signals nothing", async () => {
    const { harness, kill } = await load(linux());
    const snapshot = await ports(harness);
    const listener = snapshot.value.environments["env-1"].listeners[0];
    const base = { threadId: "thr_abc123", port: listener.port, pid: listener.pid!, startedAt: listener.startedAt! };
    expect(await harness.behavior.callRpc("stopPort", { ...base, pid: 1 })).toEqual({ outcome: "refused" });
    expect(await harness.behavior.callRpc("stopPort", { ...base, startedAt: base.startedAt + 1 })).toEqual({ outcome: "refused" });
    expect(await harness.behavior.callRpc("stopPort", { ...base, port: 1 })).toEqual({ outcome: "refused" });
    expect(kill).not.toHaveBeenCalled();
    expect(await harness.behavior.callRpc("stopPort", base)).toEqual({ outcome: "requested" });
    expect(kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGTERM");
  });

  it("signals nothing when the PID was reused since the scan: the host finds another start time", async () => {
    const system = linux();
    const { harness, kill } = await load(system);
    const snapshot = await ports(harness);
    const listener = snapshot.value.environments["env-1"].listeners[0];
    // The same PID now belongs to a process that started later.
    const files = (system as unknown as { readFile: FakeSystem["readFile"] });
    const original = files.readFile;
    files.readFile = (path) => (path === "/proc/4242/stat" ? Promise.resolve(procStat(4242, "other", 999_999)) : original(path));
    const outcome = await harness.behavior.callRpc("stopPort", { threadId: "thr_abc123", port: 5173, pid: 4242, startedAt: listener.startedAt! });
    expect(outcome).toEqual({ outcome: "gone" });
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("auto-settle hold-back (AC7)", () => {
  const DAY = 24 * 60 * 60 * 1_000;
  const quiet = (id: string, overrides: Partial<ReturnType<typeof listedThread>> = {}) =>
    listedThread(id, { createdAt: Date.now() - 9 * DAY, updatedAt: Date.now() - 9 * DAY, latestAttentionAt: Date.now() - 9 * DAY, ...overrides });

  it("settles a quiet thread that serves no port, and not one that owns a port", async () => {
    const { harness } = await load(linux(), {
      threads: [
        quiet("thr_abc123", { environmentId: "env-1", environmentHostId: "host-1", environmentPath: "/work/app" }),
        quiet("thr_free", { environmentId: "env-3", environmentHostId: "host-1", environmentPath: "/work/nothing-listens-here" }),
      ],
    });
    const result = (await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] };
    expect(result.settled).toEqual(["thr_free"]);
  });

  it("holds back a thread that is alone in an environment with an unowned port", async () => {
    const { harness } = await load(linux(), {
      threads: [quiet("thr_alone", { environmentId: "env-2", environmentHostId: "host-1", environmentPath: "/work/app" })],
    });
    expect(((await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] }).settled).toEqual([]);
  });

  it("settles a thread that shares an environment with another thread that has an unowned port there", async () => {
    const { harness } = await load(linux(), {
      threads: [
        quiet("thr_one", { environmentId: "env-2", environmentHostId: "host-1", environmentPath: "/work/app" }),
        quiet("thr_two", { environmentId: "env-2", environmentHostId: "host-1", environmentPath: "/work/app" }),
      ],
    });
    expect((await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] }).toEqual({ settled: ["thr_one", "thr_two"], unsettled: [] });
  });

  it("settles nothing on a machine that cannot be scanned", async () => {
    const { harness } = await load(linux(), { hostFails: true, threads: [quiet("thr_quiet", { environmentId: "env-1", environmentHostId: "host-1", environmentPath: "/work/app" })] });
    expect(((await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] }).settled).toEqual([]);
  });

  it("settles a quiet thread with no environment", async () => {
    const { harness } = await load(linux(), { hostFails: true, threads: [quiet("thr_free")] });
    expect(((await harness.behavior.callRpc("runAutoSettle", {})) as { settled: string[] }).settled).toEqual(["thr_free"]);
  });
});

describe("#330: auto-settle reads GitHub PR Status through the SDK", () => {
  const DAY = 24 * 60 * 60 * 1_000;
  const quiet = (id: string, environmentId: string, days: number) =>
    listedThread(id, {
      environmentId,
      environmentHostId: "host-1",
      environmentPath: "/work/nothing-listens-here",
      createdAt: Date.now() - days * DAY,
      updatedAt: Date.now() - days * DAY,
      latestAttentionAt: Date.now() - days * DAY,
    });
  const merged = () => ({
    ...CAPTURED_PULL_REQUESTS.env_merged,
    pullRequest: { ...CAPTURED_PULL_REQUESTS.env_merged.pullRequest, updatedAt: new Date().toISOString() },
  });

  it("AC2: settles a thread whose pull request merged, and keeps a quiet one whose lookup failed", async () => {
    const { harness } = await load(linux(), {
      threads: [quiet("thr_merged", "env-merged", 1), quiet("thr_offline", "env-offline", 9)],
      pullRequests: { answer: () => ({ "env-merged": merged(), "env-offline": CAPTURED_PULL_REQUESTS.env_offline }) },
    });
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: ["thr_merged"], unsettled: [] });
  });

  it("settles a quiet thread whose workspace is gone", async () => {
    const { harness } = await load(linux(), { threads: [quiet("thr_gone", "env-gone", 9)], pullRequests: { answer: () => ({ "env-gone": CAPTURED_PULL_REQUESTS.env_gone }) } });
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: ["thr_gone"], unsettled: [] });
  });

  it("AC3: settles a quiet thread when GitHub PR Status is disabled", async () => {
    const { harness } = await load(linux(), { threads: [quiet("thr_quiet", "env-quiet", 9)], pullRequests: { enabled: false } });
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: ["thr_quiet"], unsettled: [] });
  });

  it("keeps a thread it settled on a merge when GitHub PR Status is then disabled", async () => {
    const status = { answer: () => ({ "env-merged": merged() }), enabled: true };
    const { harness } = await load(linux(), { threads: [quiet("thr_merged", "env-merged", 1)], pullRequests: status });
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: ["thr_merged"], unsettled: [] });
    status.enabled = false;
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: [], unsettled: [] });
  });

  it("AC4: logs an answer out of shape to bb's log as an error and keeps the thread", async () => {
    const { harness } = await load(linux(), { threads: [quiet("thr_quiet", "env-quiet", 9)], pullRequests: { answer: () => ({ "env-quiet": { outcome: "found" } }) } });
    expect(await harness.behavior.callRpc("runAutoSettle", {})).toEqual({ settled: [], unsettled: [] });
    expect(harness.inspection.logEntries).toContainEqual({
      level: "error",
      message: expect.stringMatching(/^GitHub PR Status answered environment env-quiet in a shape Thread Glance does not expect: outcome: /),
    });
  });
});
