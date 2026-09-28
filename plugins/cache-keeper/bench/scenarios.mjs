// The benchmark's scenarios: steady state at 50, 500 and 5,000 threads, the
// page's overview on the busy 5,000-thread install, a restart of it, and
// learning one thread with a 1, 10 and 35 MiB transcript.
import Database from "better-sqlite3";
import { appendFileSync, copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA, evict, fakeBb, hostProc, OUT, pluginProc, SLUG } from "./lib.mjs";
import { turnText } from "./transcript.mjs";
import { World } from "./world.mjs";

const WARM_S = 180;
const MEASURE_S = 600;
const MIN = MEASURE_S / 60;

/** Deletes a scenario's generated files (up to a gigabyte at 5,000 threads) unless BENCH_KEEP is set. */
const tidy = (dir) => {
  if (!process.env.BENCH_KEEP) rmSync(dir, { recursive: true, force: true });
};
const per = (a, b, key) => (b[key] - a[key]) / MIN;
const diffCounts = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]));

/**
 * Steady state: 3 simulated minutes of warm-up, then 10 measured. The plugin's
 * CPU is its process's, the fake bb's is what it spent serving the plugin,
 * the host's is its whole process's.
 */
export async function steady({ n, build, seed, noop = false, profile = false, overview = false }) {
  const w = new World({ n, dir: join(DATA, `steady-${n}${noop ? "-noop" : ""}`), seed, build, noop });
  try {
    await w.setup();
    await w.run(WARM_S);
    const a = await w.snapshot();
    if (profile) await w.plugin.ask("profileStart");
    const t0 = performance.now();
    await w.run(MEASURE_S);
    const wallMs = performance.now() - t0;
    if (profile) {
      mkdirSync(join(OUT, "prof"), { recursive: true });
      await w.plugin.ask("profileStop", { path: join(OUT, "prof", `steady-${n}.cpuprofile`) });
    }
    const b = await w.snapshot();
    const out = {
      n,
      mix: w.mix,
      noop,
      pluginCpuMsPerMin: (b.plugin.cpuMs - a.plugin.cpuMs) / MIN,
      pluginMainThreadCpuMsPerMin: (b.plugin.threadCpuMs - a.plugin.threadCpuMs) / MIN,
      pluginSystemCpuMsPerMin: (b.plugin.systemMs - a.plugin.systemMs) / MIN,
      pluginGc: { perMin: (b.plugin.gc.count - a.plugin.gc.count) / MIN, msPerMin: (b.plugin.gc.ms - a.plugin.gc.ms) / MIN },
      bbCpuMsPerMin: per(a.bb, b.bb, "cpuMs"),
      bbCallsPerMin: per(a.bb, b.bb, "calls"),
      bbBytesPerMin: per(a.bb, b.bb, "bytesOut"),
      bbCalls: diffCounts(a.bb.byMethod, b.bb.byMethod),
      hostCpuMsPerMin: per(a.host, b.host, "cpuMs"),
      hostCallsPerMin: per(a.host, b.host, "calls"),
      hostBytesReadPerMin: per(a.host, b.host, "bytesRead"),
      hostCalls: diffCounts(a.host.byMethod, b.host.byMethod),
      sendsPerMin: { keepWarm: (b.sends.keepWarm - a.sends.keepWarm) / MIN, compact: (b.sends.compact - a.sends.compact) / MIN },
      plugin: {
        publishesPerMin: (b.plugin.counts.publishes - a.plugin.counts.publishes) / MIN,
        timerFiresPerMin: (b.plugin.counts.fired - a.plugin.counts.fired) / MIN,
        clockMoveCpuMsPerMin: (b.plugin.counts.clockMovedMs - a.plugin.counts.clockMovedMs) / MIN,
        cliCpuMsPerMin: (b.plugin.counts.cliMs - a.plugin.counts.cliMs) / MIN,
        eventsCpuMsPerMin: (b.plugin.counts.eventsMs - a.plugin.counts.eventsMs) / MIN,
        warnings: b.plugin.counts.warn,
        store: b.plugin.counts.store === undefined ? undefined : diffCounts(a.plugin.counts.store, b.plugin.counts.store),
        engine: b.plugin.counts.engine === undefined ? undefined : diffCounts(a.plugin.counts.engine, b.plugin.counts.engine),
        heapMB: b.plugin.heapMB,
      },
      bbEvents: b.bb.events,
      simWallMsPerMin: wallMs / MIN,
    };
    if (overview) out.overview = await measureOverview(w);
    return out;
  } finally {
    await w.close();
    tidy(w.o.dir);
  }
}

/** The page's overview, five times on the install as the steady state left it; the median call. */
async function measureOverview(w) {
  const calls = [];
  for (let i = 0; i < 5; i++) calls.push(await w.plugin.ask("rpc", { method: "overview", input: null }));
  calls.sort((x, y) => x.cpuMs - y.cpuMs);
  const mid = calls[2];
  await w.plugin.stop();
  const db = new Database(join(w.o.dir, "data.db"), { readonly: true });
  const history = db.prepare("SELECT count(*) AS n FROM history").get().n;
  const threads = db.prepare("SELECT count(*) AS n FROM threads").get().n;
  db.close();
  return { cpuMs: mid.cpuMs, wallMs: mid.wallMs, bytes: mid.bytes, rows: mid.rows, historyRows: history, threadRows: threads };
}

/**
 * A restart of a 5,000-thread install. The install runs 90 s on wall time
 * (the plugin's clock unmoved, so its saved times and bb's agree across the
 * restart), the plugin stops, bb goes on for 20 s, and a new plugin process
 * loads over the same database. Its CPU is counted from importing the server
 * to settled: the catch-up done and every call it queued answered.
 */
export async function restart({ build, seed, profile = false }) {
  const w = new World({ n: 5000, dir: join(DATA, "restart-5000"), seed, build, realtime: true });
  try {
    await w.setup();
    await w.run(90);
    await w.plugin.stop();
    w.down = true;
    await w.run(20);
    w.down = false;
    const bbBefore = await w.bb.call("/stats");
    const hostBefore = await w.host.stats();
    if (profile) mkdirSync(join(OUT, "prof"), { recursive: true });
    const load = await w.startPlugin(profile ? { profileLoad: join(OUT, "prof", "restart-5000.cpuprofile") } : {});
    const stats = await w.plugin.ask("stats");
    const bbAfter = await w.bb.call("/stats");
    const hostAfter = await w.host.stats();
    // For comparison: the same install restarted again at once, with nothing to catch up.
    await w.plugin.stop();
    const again = await w.startPlugin(profile ? { profileLoad: join(OUT, "prof", "restart-again-5000.cpuprofile") } : {});
    return {
      againCpuMs: again.cpuMs,
      n: 5000,
      downS: 20,
      pluginCpuMs: load.cpuMs,
      pluginWallMs: load.wallMs,
      pluginProcessCpuMs: stats.cpuMs,
      bbCpuMs: bbAfter.cpuMs - bbBefore.cpuMs,
      bbCalls: diffCounts(bbBefore.byMethod, bbAfter.byMethod),
      bbCallCount: bbAfter.calls - bbBefore.calls,
      hostCpuMs: hostAfter.cpuMs - hostBefore.cpuMs,
      hostCalls: hostAfter.calls - hostBefore.calls,
      hostBytesRead: hostAfter.bytesRead - hostBefore.bytesRead,
    };
  } finally {
    await w.close();
    tidy(w.o.dir);
  }
}

/**
 * Learning one thread: its first view with a transcript of `mib` MiB never
 * read, from disk (page cache evicted); then, switched on, a restart after one
 * more turn was added while the plugin was down: it resumes from the saved
 * cursor and reads only that turn.
 */
export async function learn({ build, seedFor, mib }) {
  const dir = join(DATA, `learn-${mib}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const bb = await fakeBb(join(dir, "bb.db"));
  const host = await hostProc(build.host, dir);
  const id = "thr_learn00001";
  const session = `sess-${id}`;
  const path = join(dir, "claude", "projects", SLUG, `${session}.jsonl`);
  copyFileSync(seedFor(mib), path);
  const old = Date.now() - 3_600_000;
  const row = {
    id,
    providerId: "claude-code",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: old - 86_400_000,
    updatedAt: old,
    title: "Learn",
    titleFallback: null,
    hasPendingInteraction: false,
    environmentHostId: "host_1",
    queuedWork: "none",
    activity: { activeBackgroundCommandCount: 0, activeBackgroundAgentCount: 0 },
    lastReadAt: old,
    latestAttentionAt: old,
  };
  const turnEvents = (at, requestId) => [
    [id, "client/turn/requested", at, { requestId, initiator: "user", input: [{ type: "text", text: "Please carry on.", mentions: [] }], target: { kind: "new-turn" } }],
    [id, "turn/started", at, {}],
    [id, "turn/input/accepted", at, { clientRequestId: requestId }],
    [id, "item/completed", at, { item: { type: "agentMessage", id: "m", text: "Done." } }],
    [id, "turn/completed", at, { status: "completed" }],
  ];
  await bb.call("/threads/put", [row]);
  await bb.call("/ingest", [[id, "thread/identity", old, { providerThreadId: session, threadId: id }], ...turnEvents(old, "creq_1")]);
  const config = { bbPort: bb.port, hostPort: host.port, dbPath: join(dir, "data.db"), settings: { fetchPrices: false } };
  const measure = async (work) => {
    const [bb0, host0] = [await bb.call("/stats"), await host.stats()];
    const t0 = performance.now();
    const plugin = await work();
    const wallMs = performance.now() - t0;
    const [bb1, host1] = [await bb.call("/stats"), await host.stats()];
    return {
      pluginCpuMs: plugin.cpuMs,
      wallMs,
      bbCpuMs: bb1.cpuMs - bb0.cpuMs,
      bbCalls: bb1.calls - bb0.calls,
      hostCpuMs: host1.cpuMs - host0.cpuMs,
      hostCalls: host1.calls - host0.calls,
      bytesRead: host1.bytesRead - host0.bytesRead,
    };
  };
  let plugin = pluginProc(build.server, config);
  try {
    await plugin.ask("load");
    evict(path);
    const cold = await measure(() => plugin.ask("rpc", { method: "view", input: { threadId: id } }));
    await plugin.ask("rpc", { method: "setCompact", input: { threadId: id, on: true } });
    await plugin.stop();
    // One turn while the plugin was down.
    const now = Date.now();
    const size = statSync(path).size;
    appendFileSync(path, turnText({ session, at: now, context: 150_000, lifetime: "5m", calls: 9 }));
    const appended = statSync(path).size - size;
    await bb.call("/ingest", turnEvents(now, "creq_2"));
    await bb.call("/threads/put", [{ ...row, updatedAt: now, latestAttentionAt: now }]);
    evict(path);
    plugin = pluginProc(build.server, config);
    const restarted = await measure(() => plugin.ask("load"));
    return { mib, bytes: size, cold, restart: { ...restarted, appendedBytes: appended } };
  } finally {
    await plugin.stop();
    bb.child.kill();
    host.child.kill();
    tidy(dir);
  }
}
