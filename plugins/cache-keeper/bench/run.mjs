// Cache Keeper's benchmark: runs the real server (server.ts, bundled with
// esbuild) against a fake bb and the real host entry (host.ts), each in its
// own process behind loopback HTTP, and reports CPU, bb calls, host calls and
// bytes read for each scenario next to the issue's targets.
//
// Run it from plugins/cache-keeper:
//
//   node bench/run.mjs                 every scenario (about 5 minutes)
//   node bench/run.mjs steady 500      one steady-state size, with its no-op baseline
//   node bench/run.mjs restart         the 5,000-thread restart
//   node bench/run.mjs learn           learning one thread, 1, 10 and 35 MiB
//   node bench/run.mjs --profile ...   also writes the plugin's CPU profile of each
//                                      measured steady state and of the restart to
//                                      bench/out/prof; `node bench/profile.mjs <file>`
//                                      sums it (profiling inflates the figures)
//   BENCH_COUNT=1 node bench/run.mjs … also counts and times each store method and
//                                      engine step (results.json, steady[].plugin)
//
// It writes bench/out/results.json and bench/out/results.md. Generated
// transcripts and databases go to bench/.data, and each scenario's are
// deleted when it ends unless BENCH_KEEP=1 is set. Needs python3 to evict
// files from the page cache for the cold reads.
//
// Scenarios, as the issue names them:
// - Steady state at 50 threads (5 running, 3 waiting, 2 compact-on, 1 tree kept
//   warm, 1 open viewer), 500 (20 / 15 / 10 / 5 / 2) and 5,000 (60 / 60 / 50 /
//   20 / 5): 3 simulated minutes of warm-up, 10 measured, on the plugin's
//   drive clock moved a second at a time. The plugin's CPU is net of a no-op
//   plugin receiving the same traffic; the fake bb's is what it spent serving
//   the plugin; the host's is its whole process's.
// - The page's overview on the busy 5,000-thread install the steady state leaves.
// - A restart of a 5,000-thread install after 20 s down: plugin CPU from
//   loading the server to settled.
// - Learning one thread with a 1, 10 and 35 MiB transcript: cold from disk, and
//   after a restart that resumes from the saved cursor.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundle } from "./build.mjs";
import { DATA, OUT } from "./lib.mjs";
import { learn, restart, steady } from "./scenarios.mjs";
import { generate } from "./transcript.mjs";

/** The blind design's floors (plugin + bb serving it + host, ms a minute), and the issue's targets: 2× those. */
const BLIND = {
  50: { plugin: 2.0, bb: 1.1, host: 0.8, total: 3.9 },
  500: { plugin: 9.9, bb: 3.3, host: 2.3, total: 15.5 },
  5000: { plugin: 32.1, bb: 10.4, host: 5.6, total: 48 },
};
const TARGET = { 50: 7.8, 500: 31, 5000: 96 };
const BLIND_LEARN = { 1: 4.2, 10: 17.7, 35: 39.5 };
const RESTART_TARGET_MS = 250;
const RATIO_TARGET = 10;
const BB_METHODS = ["threads.list", "threads.events.list", "threads.get", "threads.interactions.list", "threads.queuedMessages.list", "threads.context", "threads.send", "threads.markRead", "threads.markUnread"];

const args = process.argv.slice(2);
const profile = args.includes("--profile");
const words = args.filter((a) => !a.startsWith("--"));
const which = words[0] ?? "all";
const sizes = words.slice(1).map(Number).filter((x) => x > 0);

mkdirSync(join(DATA, "seed"), { recursive: true });
mkdirSync(OUT, { recursive: true });
const seedFor = (mib) => {
  const path = join(DATA, "seed", `t${mib}.jsonl`);
  if (!existsSync(path)) generate(path, mib * 1048576, { session: "seed" });
  return path;
};

const build = await bundle();
const results = { at: new Date().toISOString(), node: process.version, steady: [], restart: null, learn: [] };
const log = (...m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...m);

if (which === "all" || which === "steady") {
  for (const n of sizes.length > 0 ? sizes : [50, 500, 5000]) {
    log(`steady ${n}: no-op baseline`);
    const base = await steady({ n, build, seed: seedFor(1), noop: true });
    log(`steady ${n}: plugin`);
    const run = await steady({ n, build, seed: seedFor(1), profile, overview: n === 5000 });
    const pluginNet = run.pluginCpuMsPerMin - base.pluginCpuMsPerMin;
    const total = pluginNet + run.bbCpuMsPerMin + run.hostCpuMsPerMin;
    results.steady.push({ ...run, noopCpuMsPerMin: base.pluginCpuMsPerMin, noopMainThreadCpuMsPerMin: base.pluginMainThreadCpuMsPerMin, noopPlugin: base.plugin, noopSystemCpuMsPerMin: base.pluginSystemCpuMsPerMin, noopGc: base.pluginGc, pluginNetCpuMsPerMin: pluginNet, totalCpuMsPerMin: total, target: TARGET[n], blind: BLIND[n] });
    log(`steady ${n}: plugin ${pluginNet.toFixed(1)} + bb ${run.bbCpuMsPerMin.toFixed(1)} + host ${run.hostCpuMsPerMin.toFixed(1)} = ${total.toFixed(1)} ms/min (target ${TARGET[n]})`);
  }
}
if (which === "all" || which === "restart") {
  log("restart 5000 (about 2 minutes of wall time)");
  results.restart = await restart({ build, seed: seedFor(1), profile });
  log(`restart: plugin ${results.restart.pluginCpuMs.toFixed(1)} ms CPU`);
}
if (which === "all" || which === "learn") {
  for (const mib of [1, 10, 35]) {
    log(`learn ${mib} MiB`);
    results.learn.push(await learn({ build, seedFor, mib }));
  }
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, "results.md"), markdown(results));
console.log(markdown(results));

function markdown(r) {
  const f = (n, d = 1) => (n === null || n === undefined ? "–" : Number(n).toFixed(d));
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const lines = [`Cache Keeper benchmark, ${r.at}, Node ${r.node}.`, ""];
  if (r.steady.length > 0) {
    lines.push(
      "### Steady state (CPU in ms a minute)",
      "",
      "| Threads | Plugin (net) | Fake bb | Host | **Total** | Target | Blind (plugin + bb + host) | Met |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const s of r.steady) {
      lines.push(`| ${s.n} | ${f(s.pluginNetCpuMsPerMin)} | ${f(s.bbCpuMsPerMin)} | ${f(s.hostCpuMsPerMin)} | **${f(s.totalCpuMsPerMin)}** | ≤ ${s.target} | ${s.blind.total} (${s.blind.plugin} + ${s.blind.bb} + ${s.blind.host}) | ${s.totalCpuMsPerMin <= s.target ? "yes" : "**no**"} |`);
    }
    lines.push(
      "",
      "| Threads | Plugin gross | No-op baseline | bb calls/min | bb bytes/min | Host calls/min | Transcript read/min | Keep-warms/min | Compactions/min | Timer fires/min | Publishes/min |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const s of r.steady) {
      lines.push(
        `| ${s.n} | ${f(s.pluginCpuMsPerMin)} | ${f(s.noopCpuMsPerMin)} | ${f(s.bbCallsPerMin)} | ${kb(s.bbBytesPerMin)} | ${f(s.hostCallsPerMin)} | ${kb(s.hostBytesReadPerMin)} | ${f(s.sendsPerMin.keepWarm)} | ${f(s.sendsPerMin.compact)} | ${f(s.plugin.timerFiresPerMin)} | ${f(s.plugin.publishesPerMin)} |`,
      );
    }
    lines.push("", "bb calls per 10 measured minutes, by method:", "", "| Threads | " + BB_METHODS.join(" | ") + " |", "|---" + "|---".repeat(BB_METHODS.length) + "|");
    for (const s of r.steady) lines.push(`| ${s.n} | ${BB_METHODS.map((m) => s.bbCalls[m] ?? 0).join(" | ")} |`);
    lines.push(
      "",
      "Plugin process detail (ms a minute): main thread, other threads (JIT compiler, GC helpers), kernel time, GC pauses; the no-op baseline's main thread; and the CPU of the drive clock's moves (resetting the timer), which the plugin never spends on wall time and which is counted in its figure.",
      "",
      "| Threads | Main thread | Other threads | Kernel | GC pauses | No-op main thread | Drive clock moves |",
      "|---|---|---|---|---|---|---|",
    );
    for (const s of r.steady) {
      lines.push(`| ${s.n} | ${f(s.pluginMainThreadCpuMsPerMin)} | ${f(s.pluginCpuMsPerMin - s.pluginMainThreadCpuMsPerMin)} | ${f(s.pluginSystemCpuMsPerMin)} | ${f(s.pluginGc.msPerMin)} | ${f(s.noopMainThreadCpuMsPerMin)} | ${f(s.plugin.clockMoveCpuMsPerMin)} |`);
    }
    const s500 = r.steady.find((s) => s.n === 500);
    const s5000 = r.steady.find((s) => s.n === 5000);
    if (s500 && s5000) {
      const ratio = s5000.totalCpuMsPerMin / s500.totalCpuMsPerMin;
      lines.push("", `CPU from 500 to 5,000 threads: ×${f(ratio, 2)} (target ≤ ×${RATIO_TARGET}): ${ratio <= RATIO_TARGET ? "met" : "**not met**"}. Plugin alone: ×${f(s5000.pluginNetCpuMsPerMin / s500.pluginNetCpuMsPerMin, 2)}.`);
    }
    if (s5000?.overview) {
      const o = s5000.overview;
      lines.push("", "### The page's overview, busy 5,000-thread install", "", "| CPU | Wall | Bytes | Rows | History rows | Blind |", "|---|---|---|---|---|---|");
      lines.push(`| ${f(o.cpuMs, 2)} ms | ${f(o.wallMs, 2)} ms | ${kb(o.bytes)} | ${o.rows} | ${o.historyRows} | 0.75 ms, 18 KB, 171 rows |`);
    }
  }
  if (r.restart) {
    const x = r.restart;
    lines.push(
      "",
      "### Restart of a 5,000-thread install after 20 s down",
      "",
      "| Plugin CPU, load to settled | Target | Met | Wall | Fake bb CPU | bb calls | Host CPU | Host calls | Transcript read | Plugin process CPU incl. Node start | Restarted again at once, nothing to catch up | Blind (process CPU incl. Node start) |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
      `| ${f(x.pluginCpuMs)} ms | < ${RESTART_TARGET_MS} ms | ${x.pluginCpuMs < RESTART_TARGET_MS ? "yes" : "**no**"} | ${f(x.pluginWallMs)} ms | ${f(x.bbCpuMs)} ms | ${x.bbCallCount} | ${f(x.hostCpuMs)} ms | ${x.hostCalls} | ${kb(x.hostBytesRead)} | ${f(x.pluginProcessCpuMs)} ms | ${f(x.againCpuMs)} ms | 104 ms CPU, 121 ms wall |`,
    );
  }
  if (r.learn.length > 0) {
    lines.push(
      "",
      "### Learning one thread",
      "",
      "| Transcript | Cold: plugin CPU | bb CPU | Host CPU | Total | Wall | Bytes read | Blind cold (wall) | Restart: plugin CPU | Host CPU | Bytes read | Bytes appended | Reads only appended |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const l of r.learn) {
      const c = l.cold;
      const re = l.restart;
      lines.push(
        `| ${l.mib} MiB | ${f(c.pluginCpuMs)} ms | ${f(c.bbCpuMs)} ms | ${f(c.hostCpuMs)} ms | ${f(c.pluginCpuMs + c.bbCpuMs + c.hostCpuMs)} ms | ${f(c.wallMs)} ms | ${kb(c.bytesRead)} | ${BLIND_LEARN[l.mib]} ms | ${f(re.pluginCpuMs)} ms | ${f(re.hostCpuMs)} ms | ${re.bytesRead} | ${re.appendedBytes} | ${re.bytesRead === re.appendedBytes ? "yes" : "**no**"} |`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
