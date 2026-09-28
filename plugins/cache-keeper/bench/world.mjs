// A bb install on the plugin's drive clock: N threads, a few running turns,
// waiting on background work, switched on, kept warm and open in a viewer.
// Each simulated second it writes what bb would (event rows, thread rows,
// transcript lines, background output), announces bb's plugin events to the
// plugin, moves the plugin's clock a second on, runs every message the plugin
// sent as a short turn, and delivers the report of a keep-warm's turn to the
// parent. bb's rows are stamped with wall time, which the plugin reads on its
// moved clock. Transcript lines and background output are stamped with the
// plugin's clock itself (wall time plus every move so far), and the host is
// given no clock moves (pluginproc.mjs drops them): it reads them as it would
// on wall time. The moves would grow by one a simulated second, a cost in
// every host call that the plugin never has outside the drive harness.
import { appendFileSync, copyFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeBb, hostProc, pluginProc, SLUG } from "./lib.mjs";
import { compactText, turnText } from "./transcript.mjs";

/** The mixes the issue names: running, waiting, compact-on, trees kept warm, open viewers. */
export const MIXES = {
  50: { R: 5, W: 3, S: 2, K: 1, V: 1 },
  500: { R: 20, W: 15, S: 10, K: 5, V: 2 },
  5000: { R: 60, W: 60, S: 50, K: 20, V: 5 },
};

const S = 1_000;
const HOST = "host_1";
const COMPACT_PREFIX = "/compact";
/** The reply a Cache Keeper message asks for when nothing is wrong, as bb's fake in the unit tests reads it. */
const asked = (text) => /reply with exactly "(.+)"/i.exec(text)?.[1] ?? "OK";

export class World {
  /**
   * @param {object} o
   * @param {number} o.n threads
   * @param {string} o.dir data directory, emptied first
   * @param {string} o.seed a transcript to start every eligible thread's from
   * @param {{ server: string, host: string }} o.build the bundled entries
   * @param {boolean} [o.noop] load the no-op baseline instead of the server
   * @param {boolean} [o.realtime] leave the plugin's clock on wall time: each step waits out its second
   */
  constructor(o) {
    this.o = o;
    this.mix = MIXES[o.n];
    this.threads = [];
    this.byId = new Map();
    this.pending = [];
    this.announce = [];
    this.dirty = new Set();
    this.running = new Map();
    this.reports = [];
    this.tasks = [];
    this.sec = 0;
    this.sends = { keepWarm: 0, compact: 0 };
    this.req = 0;
    /** How far the plugin's clock has been moved ahead of the wall. */
    this.offset = 0;
  }

  path(t) {
    return join(this.o.dir, "claude", "projects", SLUG, `${t.session}.jsonl`);
  }

  outputPath(t, taskId) {
    return join(this.o.dir, "tmp", `claude-${process.getuid()}`, SLUG, t.session, "tasks", `${taskId}.output`);
  }

  // ---- bb's writes ----

  event(t, type, data) {
    this.pending.push([t.id, type, Date.now(), data]);
  }

  touch(t) {
    t.updatedAt = Date.now();
    this.dirty.add(t);
  }

  row(t) {
    const { session: _s, role: _r, transcript: _t, ...row } = t;
    return row;
  }

  // ---- setup ----

  /** Starts the plugin process over this install's database, and loads it. */
  async startPlugin(extra = {}) {
    this.plugin = pluginProc(this.o.noop ? "noop" : this.o.build.server, { bbPort: this.bb.port, hostPort: this.host.port, dbPath: join(this.o.dir, "data.db"), settings: { fetchPrices: false }, ...extra });
    return this.plugin.ask("load");
  }

  async setup() {
    const { dir, n } = this.o;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    this.bb = await fakeBb(join(dir, "bb.db"));
    this.host = await hostProc(this.o.build.host, dir);
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const id = `thr_b${String(i).padStart(5, "0")}`;
      // Last active from an hour to about a week ago, as an install's threads are.
      const last = now - 3_600_000 - i * 120_000;
      const t = {
        id,
        providerId: i % 7 === 6 ? "codex" : "claude-code",
        status: "idle",
        parentThreadId: null,
        archivedAt: null,
        deletedAt: null,
        createdAt: last - 86_400_000,
        updatedAt: last,
        title: `Thread ${i}`,
        titleFallback: null,
        hasPendingInteraction: false,
        environmentHostId: HOST,
        queuedWork: "none",
        activity: { activeBackgroundCommandCount: 0, activeBackgroundAgentCount: 0 },
        lastReadAt: last,
        latestAttentionAt: last,
        session: `sess-${id}`,
        role: "pool",
        transcript: false,
      };
      this.threads.push(t);
      this.byId.set(id, t);
    }
    const claude = this.threads.filter((t) => t.providerId === "claude-code");
    let at = 0;
    const take = (count, role) => claude.slice(at, (at += count)).map((t) => ((t.role = role), t));
    // A kept-warm tree: a top waiting on two children, each waiting on a background subagent.
    this.trees = take(this.mix.K * 3, "tree");
    this.tops = [];
    for (let i = 0; i < this.trees.length; i += 3) {
      this.trees[i + 1].parentThreadId = this.trees[i].id;
      this.trees[i + 2].parentThreadId = this.trees[i].id;
      this.tops.push(this.trees[i]);
    }
    this.waitingIdle = take(this.mix.W, "waiting");
    this.compactOn = take(this.mix.S, "compact");
    this.viewed = take(this.mix.V, "viewed");
    this.pool = claude.slice(at);
    // Ordinary trees among the rest: every fifth thread has a child.
    for (let i = 0; i + 1 < this.pool.length; i += 5) this.pool[i + 1].parentThreadId = this.pool[i].id;

    // Every Claude Code thread has a session, a transcript and a past turn; the ones whose deadline matters a long transcript and a recent turn.
    for (const t of claude) {
      t.transcript = true;
      this.event(t, "thread/identity", { providerThreadId: t.session, threadId: t.id });
      this.pastTurn(t, t.updatedAt);
      writeFileSync(this.path(t), turnText({ session: t.session, at: t.updatedAt, context: 60_000, lifetime: "5m", calls: 1, keeper: true, text: "Please carry on." }));
    }
    const eligible = [...this.trees, ...this.waitingIdle, ...this.compactOn, ...this.viewed];
    // Their last turns ended 1 to 4 minutes ago: on a 5-minute cache, their deadlines fall through the first 3 minutes.
    eligible.forEach((t, i) => {
      const ended = now - (60 + ((i * 37) % 180)) * S;
      copyFileSync(this.o.seed, this.path(t));
      appendFileSync(this.path(t), turnText({ session: t.session, at: ended, context: 120_000, lifetime: "5m", calls: 3 }));
      this.pastTurn(t, ended);
      t.updatedAt = t.lastReadAt = t.latestAttentionAt = ended;
    });
    // Waiting threads and tree leaves each own a background task, half of them commands.
    this.waitingIdle.forEach((t, i) => this.startTask(t, i % 2 === 0 ? "command" : "subagent"));
    for (const top of this.tops) for (const c of this.trees.filter((x) => x.parentThreadId === top.id)) this.startTask(c, "subagent");
    // The running threads are running when the plugin loads.
    this.poolAt = 0;
    for (let i = 0; i < this.mix.R; i++) this.startTurn(this.nextPool(), { kind: "real" });
    this.announce = [];
    this.dirty.clear();
    await this.bb.call("/threads/put", this.threads.map((t) => this.row(t)));
    await this.flushEvents();

    await this.startPlugin();
    if (!this.o.noop) {
      // The user's switches: each tree kept warm, each compact-on thread at its lowest line, each viewer's thread opened.
      for (const top of this.tops) await this.plugin.ask("rpc", { method: "setKeepWarm", input: { threadId: top.id, on: true } });
      for (const t of this.compactOn) await this.plugin.ask("rpc", { method: "setCompact", input: { threadId: t.id, on: true, setting: 1 } });
    }
    for (const t of this.viewed) await this.plugin.ask("rpc", { method: "view", input: { threadId: t.id } });
  }

  /** A turn that ended at `at`, as bb's history holds it, with no transcript lines. */
  pastTurn(t, at) {
    const requestId = `creq_${t.id}_${at}`;
    this.pending.push(
      [t.id, "client/turn/requested", at, { requestId, initiator: "user", input: [{ type: "text", text: "Please carry on.", mentions: [] }], target: { kind: "new-turn" } }],
      [t.id, "turn/started", at, {}],
      [t.id, "turn/input/accepted", at, { clientRequestId: requestId }],
      [t.id, "item/completed", at, { item: { type: "agentMessage", id: "m", text: "Done." } }],
      [t.id, "turn/completed", at, { status: "completed" }],
    );
  }

  startTask(t, kind) {
    const taskId = `task_${t.id}`;
    this.tasks.push({ t, id: taskId, kind });
    const item = { type: "backgroundTask", id: `item_${taskId}`, familyId: taskId, taskType: kind === "command" ? "local_bash" : "local_agent", description: kind === "command" ? "npm run dev" : "Review the parser", taskStatus: "running" };
    this.event(t, "item/started", { item });
    if (kind === "command") {
      t.activity = { ...t.activity, activeBackgroundCommandCount: 1 };
      mkdirSync(join(this.outputPath(t, taskId), ".."), { recursive: true });
      writeFileSync(this.outputPath(t, taskId), "listening on :3000\n");
    } else t.activity = { ...t.activity, activeBackgroundAgentCount: 1 };
  }

  nextPool() {
    for (let i = 0; i < this.pool.length; i++) {
      const t = this.pool[this.poolAt++ % this.pool.length];
      if (t.status === "idle") return t;
    }
    return null;
  }

  // ---- turns ----

  /** Starts a turn: a user's, a report's, or one a Cache Keeper message started (bb already recorded its request). */
  startTurn(t, { kind, requestId = null, text = null, report = null }) {
    if (t === null || t.status !== "idle") return;
    if (requestId === null) {
      requestId = `creq_w${++this.req}`;
      const request =
        report === null
          ? { requestId, initiator: "user", input: [{ type: "text", text: "Please do the next part of the plan.", mentions: [] }], target: { kind: "new-turn" } }
          : {
              requestId,
              initiator: "system",
              systemMessageKind: "child-completed",
              systemMessageSubject: { kind: "thread", threadId: report.id, threadName: report.title },
              input: [{ type: "text", text: `[bb system]\n\n@thread:${report.id} completed:\n\n${report.reply}`, mentions: [{ start: 13, end: 13 + 8 + report.id.length, resource: { kind: "thread", threadId: report.id, label: report.title } }] }],
              target: { kind: "new-turn" },
            };
      this.event(t, "client/turn/requested", request);
    }
    this.event(t, "turn/started", {});
    this.event(t, "turn/input/accepted", { clientRequestId: requestId });
    t.status = "active";
    this.touch(t);
    const length = kind === "real" || kind === "own" ? 90 + Math.floor(Math.random() * 60) : kind === "report" ? 10 : 15;
    this.running.set(t.id, { endAt: this.sec + length, kind, text });
    this.announce.push(["thread.active", t.id]);
  }

  endTurn(t, r) {
    const reply = r.kind === "keeper" ? asked(r.text) : r.kind === "compact" ? "Compacted." : r.kind === "report" ? "Noted." : "Done with this part.";
    this.event(t, "item/completed", { item: { type: "agentMessage", id: `m${this.sec}`, text: reply } });
    this.event(t, "turn/completed", { status: "completed" });
    if (t.transcript) {
      const at = this.clockNow();
      const text =
        r.kind === "compact"
          ? compactText({ session: t.session, at, pre: 125_000, post: 22_000 })
          : turnText({ session: t.session, at, context: 125_000, lifetime: "5m", calls: r.kind === "real" || r.kind === "own" ? 9 : 1, keeper: r.kind === "keeper", text: r.text ?? undefined });
      appendFileSync(this.path(t), text);
    }
    t.status = "idle";
    if (t.parentThreadId === null) t.latestAttentionAt = Date.now();
    this.touch(t);
    this.running.delete(t.id);
    this.announce.push(["thread.idle", t.id]);
    // bb reports a child's turn to its parent 2 seconds after it ends; the keep-warm's report is what climbs.
    if (r.kind === "keeper" && t.parentThreadId !== null) this.reports.push({ at: this.sec + 2, parent: t.parentThreadId, child: t, reply });
    if (r.kind === "real") this.startTurn(this.nextPool(), { kind: "real" });
  }

  // ---- one second ----

  async second(advanceMs) {
    // Messages the plugin sent: bb starts each as a turn.
    for (const s of await this.bb.call("/drain")) {
      const t = this.byId.get(s.threadId);
      const kind = s.text.startsWith(COMPACT_PREFIX) ? "compact" : "keeper";
      this.sends[kind === "compact" ? "compact" : "keepWarm"]++;
      t.lastReadAt = Date.now();
      this.startTurn(t, { kind, requestId: s.requestId, text: s.text });
    }
    this.sec++;
    for (const [id, r] of [...this.running]) {
      const t = this.byId.get(id);
      // What a running turn writes that the plugin never reads: streamed text and token usage.
      for (let j = 0; j < 5; j++) this.event(t, "item/agentMessage/delta", { itemId: `i${this.sec}`, delta: "x".repeat(80) });
      if (this.sec % 10 === 0) this.event(t, "thread/tokenUsage/updated", { tokenUsage: { last: { inputTokens: 3, cachedInputTokens: 120_000, outputTokens: 400 }, modelContextWindow: 1_000_000 } });
      if (this.sec >= r.endAt) this.endTurn(t, r);
    }
    // Each compact-on thread gets a message of yours every 10 minutes, staggered, so compactions keep falling due.
    this.compactOn.forEach((t, i) => {
      if ((this.sec + Math.floor((i * 600) / this.compactOn.length)) % 600 === 0) this.startTurn(t, { kind: "own" });
    });
    for (const k of this.tasks) {
      if ((this.sec + k.id.length) % 10 !== 0) continue;
      if (k.kind === "subagent") this.event(k.t, "item/backgroundTask/progress", { item: { type: "backgroundTask", id: `item_${k.id}`, familyId: k.id, taskType: "local_agent", description: "Review the parser", taskStatus: "running", lastToolName: "Grep" } });
      else if (this.sec % 30 === 0) {
        appendFileSync(this.outputPath(k.t, k.id), `GET /health 200 ${this.sec}\n`);
        const at = this.clockNow() / 1000;
        utimesSync(this.outputPath(k.t, k.id), at, at);
      }
    }
    this.reports = this.reports.filter((r) => {
      if (r.at > this.sec) return true;
      const parent = this.byId.get(r.parent);
      if (parent.status === "idle") this.startTurn(parent, { kind: "report", report: { id: r.child.id, title: r.child.title, reply: r.reply } });
      return false;
    });
    await this.flush(advanceMs);
  }

  async flushEvents() {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    await this.bb.call("/ingest", batch);
  }

  /**
   * Writes the second's rows and events to bb, then has the plugin hear its
   * events and move its clock on. While the plugin is down its events are
   * lost, as bb loses them.
   */
  async flush(advanceMs = 0) {
    await this.flushEvents();
    if (this.dirty.size > 0) {
      const rows = [...this.dirty].map((t) => {
        const { lastReadAt: _r, ...row } = this.row(t);
        return row;
      });
      this.dirty.clear();
      await this.bb.call("/threads/put", rows);
    }
    const list = [];
    if (this.down) this.announce = [];
    if (this.announce.length > 0) {
      const ids = this.announce.map(([, id]) => id);
      const rows = await this.bb.call("/threads/get", ids);
      this.announce.forEach(([name, id], i) => list.push([name, { thread: dto(rows[i]) }]));
      this.announce = [];
    }
    if (!this.down) await this.plugin.ask("step", { ms: advanceMs, list });
    this.offset += advanceMs;
  }

  /** The plugin's clock. */
  clockNow() {
    return Date.now() + this.offset;
  }

  /** Runs `seconds` simulated seconds; each viewer opens the page and its thread once a minute. */
  async run(seconds, { onMinute } = {}) {
    for (let i = 0; i < seconds; i++) {
      const t0 = Date.now();
      await this.second(this.o.realtime ? 0 : S);
      if (this.o.realtime) await new Promise((r) => setTimeout(r, Math.max(0, S - (Date.now() - t0))));
      if (this.sec % 60 === 0 && !this.down) {
        for (const v of this.viewed) {
          await this.plugin.ask("rpc", { method: "overview", input: null });
          await this.plugin.ask("rpc", { method: "view", input: { threadId: v.id } });
        }
        await onMinute?.(this.sec / 60);
      }
    }
  }

  async snapshot() {
    const [plugin, bb, host] = await Promise.all([this.plugin.ask("stats"), this.bb.call("/stats"), this.host.stats()]);
    return { plugin, bb, host, sec: this.sec, sends: { ...this.sends } };
  }

  async close() {
    await this.plugin?.stop();
    this.bb?.child.kill();
    this.host?.child.kill();
  }
}

/** The thread as bb's plugin events carry it. */
export function dto(row) {
  const { hasPendingInteraction: _p, environmentHostId: _h, queuedWork, activity, ...rest } = row;
  return { ...rest, activeBackgroundAgentCount: activity.activeBackgroundAgentCount, queuedMessageCount: queuedWork === "waiting" ? 1 : 0 };
}
