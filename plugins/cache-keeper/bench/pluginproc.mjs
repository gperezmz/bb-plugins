// The plugin process: loads the bundled real server (bench/.build/server.mjs)
// and calls its default export with a fake `BbPluginApi` that implements
// exactly what server.ts uses. `bb.sdk` calls go to the fake bb and host calls
// to the host process over loopback HTTP; bb's plugin events, RPC calls and
// the drive clock's CLI commands arrive from the benchmark over IPC.
//
// With `noop` in place of the server path it loads a plugin that registers
// the same handlers and does nothing: the harness's own cost, measured on the
// same traffic, is subtracted from the plugin's.
//
//   node pluginproc.mjs <server.mjs | noop>     (forked by the benchmark, with a JSON config on argv[3])
import { cliCommand, defineCli } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { PerformanceObserver } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const target = process.argv[2];
const config = JSON.parse(process.argv[3]);
/** The whole process's CPU: every thread, the JIT's and the garbage collector's included. */
const cpuMs = () => {
  const c = process.cpuUsage();
  return (c.user + c.system) / 1000;
};
/** The main thread's alone. */
const threadCpuMs = () => {
  const c = process.threadCpuUsage();
  return (c.user + c.system) / 1000;
};

// ---- the fake BbPluginApi ----

const handlers = { events: new Map(), rpc: null, rpcContract: null, cli: null, service: null, schedules: [], tools: [], install: null };
const gc = { count: 0, ms: 0 };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gc.count++;
    gc.ms += e.duration;
  }
}).observe({ entryTypes: ["gc"] });
const counts = { publishes: 0, publishBytes: 0, warn: 0, info: 0, error: 0, rpc: 0, clockMovedMs: 0, fired: 0, cliMs: 0, eventsMs: 0 };
const warnings = [];

async function bbCall(method, args) {
  const res = await fetch(`http://127.0.0.1:${config.bbPort}/sdk/${method}`, { method: "POST", body: JSON.stringify(args ?? {}) });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${body.error ?? ""}`), { status: res.status });
  return body;
}

/** `bb.sdk`: `bb.sdk.threads.events.list(args)` posts to `/sdk/threads.events.list`. */
function sdkProxy(path) {
  return new Proxy(() => {}, {
    get: (_t, key) => (typeof key === "string" ? sdkProxy([...path, key]) : undefined),
    apply: (_t, _this, [args]) => bbCall(path.join("."), args),
  });
}

async function validate(schema, value, what) {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) throw new Error(`${what} validation failed: ${JSON.stringify(result.issues).slice(0, 300)}`);
  return result.value;
}

let database = null;
const settingsValues = {};
const settingsListeners = [];

const bb = {
  pluginId: "cache-keeper",
  log: {
    debug() {},
    info() {
      counts.info++;
    },
    warn(m) {
      counts.warn++;
      if (warnings.length < 50) warnings.push(m);
      if (process.env.BENCH_VERBOSE) console.error(`[plugin warn] ${m}`);
    },
    error(m) {
      counts.error++;
      console.error(`[plugin error] ${m}`);
    },
  },
  settings: {
    define(descriptors) {
      for (const [key, d] of Object.entries(descriptors)) settingsValues[key] = d.default;
      Object.assign(settingsValues, config.settings ?? {});
      return {
        get: async () => ({ ...settingsValues }),
        onChange: (fn) => settingsListeners.push(fn),
        experimental_set: async (patch) => {
          const prev = { ...settingsValues };
          Object.assign(settingsValues, patch);
          for (const fn of settingsListeners) fn({ ...settingsValues }, prev);
        },
      };
    },
  },
  storage: {
    database() {
      if (database === null) {
        database = new Database(config.dbPath);
        database.pragma("journal_mode = WAL");
        database.pragma("busy_timeout = 5000");
      }
      return database;
    },
    migrate(db, statements) {
      db.exec("CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL)");
      const applied = new Map(db.prepare("SELECT id, hash FROM _bb_migrations").all().map((r) => [r.id, r.hash]));
      db.transaction(() => {
        statements.forEach((sql, id) => {
          const hash = createHash("sha256").update(sql).digest("hex");
          if (applied.has(id)) {
            if (applied.get(id) !== hash) throw new Error(`migration ${id} changed`);
            return;
          }
          db.exec(sql);
          db.prepare("INSERT INTO _bb_migrations (id, hash) VALUES (?, ?)").run(id, hash);
        });
      })();
    },
  },
  hosts: {
    experimental_client({ contract }) {
      return {
        async call(method, input, { hostId, timeoutMs } = {}) {
          if (typeof hostId !== "string") throw new Error(`host rpc method "${method}" requires a host id`);
          // The world stamps what the host reads on the plugin's clock already (see world.mjs).
          if (Array.isArray(input?.jumps)) input = { ...input, jumps: [] };
          const valid = await validate(contract[method].input, input, "input");
          const res = await fetch(`http://127.0.0.1:${config.hostPort}/call`, {
            method: "POST",
            body: JSON.stringify({ method, input: valid }),
            signal: AbortSignal.timeout(timeoutMs ?? 30_000),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? `host call failed: ${res.status}`);
          return validate(contract[method].output, body, "output");
        },
      };
    },
  },
  realtime: {
    publish(channel, payload) {
      counts.publishes++;
      counts.publishBytes += JSON.stringify({ channel, payload }).length;
    },
  },
  events: {
    on(name, handler) {
      handlers.events.set(name, [...(handlers.events.get(name) ?? []), handler]);
    },
  },
  background: {
    service(name, service) {
      handlers.service = service;
    },
    schedule(name, cron, fn) {
      handlers.schedules.push({ name, cron, fn });
    },
  },
  rpc: {
    register(contract, rpc) {
      handlers.rpcContract = contract;
      handlers.rpc = rpc;
    },
  },
  cli: {
    register(cli) {
      handlers.cli = cli;
    },
  },
  agents: {
    registerTool(tool) {
      handlers.tools.push(tool);
    },
    configure() {},
  },
  onInstall(fn) {
    handlers.install = fn;
  },
  sdk: sdkProxy([]),
};

// ---- the no-op baseline ----

async function noop(api) {
  const names = ["thread.created", "thread.active", "thread.idle", "thread.failed", "thread.archived", "thread.unarchived", "thread.deleted", "interaction.pending", "message.queued", "message.dispatched", "message.cancelled"];
  for (const name of names) api.events.on(name, () => {});
  api.background.service("keeper", {
    async start(signal) {
      await new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  });
  api.rpc.register(
    { view: {}, overview: {} },
    { view: async () => null, overview: async () => ({}) },
  );
  // The drive clock's commands, parsed by the SDK as the server's are, doing nothing.
  const command = (positionals) => cliCommand({ summary: "no-op", hidden: true, positionals, run: async () => ({ exitCode: 0, stdout: "{}" }) });
  api.cli.register(
    defineCli({
      name: "cache-keeper",
      summary: "no-op",
      commands: { "drive advance": command([{ name: "duration", description: "How far", required: true }]), "drive now": command([]) },
    }),
  );
}

// ---- driving it ----

/** Runs a CLI command; the main thread's CPU until it returns is counted (with what else ran meanwhile). */
async function cliRun(argv) {
  const c0 = threadCpuMs();
  try {
    return await handlers.cli.run(argv, {});
  } finally {
    counts.cliMs += threadCpuMs() - c0;
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

/** The server's engine, caught as it starts; its clock is the drive clock the "drive" commands move. */
let engine = null;

/**
 * Waits until the engine has done everything due: its timer's work and every
 * call it queued. By default the harness waits on the engine and moves its
 * clock directly, as "drive now" and "drive advance" do, rather than through
 * the plugin's CLI, whose parsing on every simulated second is harness
 * plumbing the plugin never does in use; `config.viaCli` goes through the CLI.
 */
async function barrier() {
  for (let i = 0; i < 3; i++) {
    await tick();
    if (config.viaCli) await cliRun(["drive", "now"]);
    else if (engine !== null) await engine.idle();
  }
}

/** Moves the plugin's clock `ms` forward, as "drive advance" does. */
async function advance(ms) {
  if (config.viaCli || target === "noop") {
    if (config.viaCli) await cliRun(["drive", "advance", `${ms}ms`]);
    return;
  }
  engine.deps.clock.advance(ms);
  engine.clockMoved();
}

let started = null;
let profiler = null;

/**
 * On wall time the engine's timer fires each due key when it falls due, and
 * nothing else runs. Moving the drive clock instead re-plans every watched
 * tree (`clockMoved`), once a simulated second here: work the plugin never
 * does outside the drive harness. Unless `config.fullClockMoved` is set, a
 * move here only sets the timer again from the new time, so due keys fire
 * through the timer as on wall time. Either way the time it takes is counted.
 */
function instrument() {
  const Engine = globalThis.__cacheKeeperBench?.Engine;
  if (Engine === undefined) throw new Error("the bundle does not expose the engine; build it with bench/build.mjs");
  const start = Engine.prototype.start;
  Engine.prototype.start = function () {
    engine = this;
    return start.call(this);
  };
  const clockMoved = Engine.prototype.clockMoved;
  Engine.prototype.clockMoved = function () {
    const c0 = cpuMs();
    if (config.fullClockMoved) clockMoved.call(this);
    else this.scheduler.reset();
    counts.clockMovedMs += cpuMs() - c0;
  };
  // With BENCH_COUNT set, counts the calls and CPU of each store method and each synchronous engine step, and the calls of the async ones.
  if (process.env.BENCH_COUNT) {
    counts.store = {};
    counts.engine = {};
    const timed = (into, name, fn, nested = { depth: 0 }) =>
      function (...a) {
        into[name] = (into[name] ?? 0) + 1;
        // A step called inside itself is counted, and timed once, from the outer call.
        if (nested.depth++ > 0) {
          try {
            return fn.apply(this, a);
          } finally {
            nested.depth--;
          }
        }
        const c0 = threadCpuMs();
        try {
          return fn.apply(this, a);
        } finally {
          nested.depth--;
          into[`${name}Ms`] = (into[`${name}Ms`] ?? 0) + threadCpuMs() - c0;
        }
      };
    const sync = ["planOf", "replan", "observe", "treeNode", "view", "forecast", "account", "onThread", "onQueued", "patch", "watched", "waiting", "logHeld", "decide", "keeperInput", "reconcile", "fire"];
    const async = ["learn", "readEvents", "readTranscript", "act", "deliver", "prepare", "fresh", "putBack", "restoreRead", "refreshQueue", "readPending", "readWindow", "hostOf", "deleteNothingNewReports", "checkInIfStalled", "keepAlive", "viewOf", "sendKeepWarms", "sendCompact"];
    for (const name of sync) if (typeof Engine.prototype[name] === "function") Engine.prototype[name] = timed(counts.engine, name, Engine.prototype[name]);
    for (const name of async) {
      const fn = Engine.prototype[name];
      if (typeof fn !== "function") continue;
      Engine.prototype[name] = function (...a) {
        counts.engine[name] = (counts.engine[name] ?? 0) + 1;
        return fn.apply(this, a);
      };
    }
    const record = Engine.prototype.record;
    Engine.prototype.record = function (threadId) {
      if (!this.__counted) {
        this.__counted = true;
        const store = this.deps.store;
        for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(store))) {
          if (typeof store[key] === "function" && key !== "constructor") store[key] = timed(counts.store, key, store[key]);
        }
      }
      return record.call(this, threadId);
    };
  }
  const fire = Engine.prototype.fire;
  Engine.prototype.fire = function (keys) {
    counts.fired += keys.length;
    return fire.call(this, keys);
  };
}

/** Calls the factory, then starts the background service; resolves once the service's start has settled into waiting. */
async function load() {
  const factory = target === "noop" ? noop : (await import(pathToFileURL(target).href)).default;
  if (target !== "noop") instrument();
  await factory(bb);
  let settled;
  const ready = new Promise((resolve) => (settled = resolve));
  const listeners = [];
  const signal = {
    aborted: false,
    addEventListener(_type, fn) {
      listeners.push(fn);
      settled();
    },
  };
  started = { stop: () => listeners.forEach((fn) => fn()) };
  void handlers.service.start(signal);
  await ready;
  await barrier();
}

const ops = {
  async load() {
    if (config.profileLoad) await ops.profileStart();
    const c0 = cpuMs();
    const t0 = performance.now();
    await load();
    const out = { cpuMs: cpuMs() - c0, wallMs: performance.now() - t0 };
    if (config.profileLoad) await ops.profileStop({ path: config.profileLoad });
    return out;
  },
  /** A second of the world: bb's events as they happened, then the clock moved on past them. */
  async step({ ms, list }) {
    const c0 = threadCpuMs();
    for (const [name, payload] of list) {
      for (const fn of handlers.events.get(name) ?? []) await fn(payload);
    }
    counts.eventsMs += threadCpuMs() - c0;
    if (ms > 0) await advance(ms);
    await barrier();
    return null;
  },
  async rpc({ method, input }) {
    counts.rpc++;
    const c0 = cpuMs();
    const t0 = performance.now();
    let out;
    if (target === "noop") out = await handlers.rpc[method](input);
    else {
      const contract = handlers.rpcContract[method];
      out = await validate(contract.output, await handlers.rpc[method](await validate(contract.input, input, "rpc input")), "rpc output");
    }
    const bytes = JSON.stringify(out ?? null).length;
    const cpu = cpuMs() - c0;
    const wallMs = performance.now() - t0;
    await barrier();
    return { cpuMs: cpu, wallMs, bytes, rows: out && typeof out === "object" ? rowsOf(out) : null };
  },
  /** Profiles the plugin process from here to `profileStop`, which writes the profile to `path`. */
  async profileStart() {
    profiler = new Session();
    profiler.connect();
    await profiler.post("Profiler.enable");
    await profiler.post("Profiler.setSamplingInterval", { interval: 200 });
    await profiler.post("Profiler.start");
    return null;
  },
  async profileStop({ path }) {
    const { profile } = await profiler.post("Profiler.stop");
    writeFileSync(path, JSON.stringify(profile));
    profiler.disconnect();
    return null;
  },
  /** CPU of `times` runs of a CLI command in a row, for telling the harness's cost from the plugin's. */
  async cliCost({ argv, times }) {
    const c0 = threadCpuMs();
    for (let i = 0; i < times; i++) await handlers.cli.run(argv, {});
    return (threadCpuMs() - c0) / times;
  },
  /** CPU of `times` `bb.sdk` calls in a row. */
  async sdkCost({ method, args, times }) {
    const c0 = threadCpuMs();
    const p0 = cpuMs();
    for (let i = 0; i < times; i++) await bbCall(method, args);
    return { thread: (threadCpuMs() - c0) / times, process: (cpuMs() - p0) / times };
  },
  async stats() {
    const c = process.cpuUsage();
    return { cpuMs: cpuMs(), userMs: c.user / 1000, systemMs: c.system / 1000, threadCpuMs: threadCpuMs(), gc: { ...gc }, counts, warnings, heapMB: process.memoryUsage().heapUsed / 1048576, rssMB: process.memoryUsage().rss / 1048576 };
  },
  /** Stops the service as bb does on shutdown and exits, which writes a CPU profile when one is being taken. */
  async stop() {
    started?.stop();
    await tick();
    database?.close();
    setTimeout(() => process.exit(0), 10);
    return null;
  },
};

/** How many thread rows an RPC answer holds. */
function rowsOf(out) {
  if (Array.isArray(out)) return out.length;
  if (Array.isArray(out.switchedOn)) return out.switchedOn.length + out.waiting.length + out.recent.length;
  return 1;
}

process.on("message", async ({ id, op, ...args }) => {
  try {
    process.send({ id, ok: true, value: await ops[op](args) });
  } catch (error) {
    process.send({ id, ok: false, error: error?.stack ?? String(error) });
  }
});
// Exits with the benchmark that forked it, however that ends.
process.on("disconnect", () => process.exit(0));
process.send({ ready: true });
