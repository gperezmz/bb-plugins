/**
 * A fake bb and host entry for the engine's tests, on a virtual clock. It
 * records turns the way bb 0.44 does (a request, the turn taking it, the
 * agent's reply, and 2 seconds after a child's turn ends, a report of it in
 * the parent, batched when several end together) and announces them with
 * bb's plugin events.
 */
import Database from "better-sqlite3";
import type { Clock } from "../core/clock";
import { COMPACT_MESSAGE } from "../core/messages";
import { PriceBook } from "../core/pricing";
import type { KeepWarmSetting } from "../core/switch";
import { EMPTY_FACTS, type TranscriptCursor, type TranscriptFacts, type TranscriptRequest } from "../core/transcript";
import type { BbEvent } from "../core/turns";
import { Engine, EVENTS_PAGE, queuedRowOf, type EngineDeps, type QueuedRow } from "./engine";
import type { Timers } from "./scheduler";
import { ensureIncrementalVacuum, MIGRATIONS, Store } from "./store";

export const S = 1_000;
export const MIN = 60 * S;
export const HOUR = 60 * MIN;
export const T0 = Date.UTC(2026, 8, 27, 10, 0);

// Opus 5.5 per token: the 1-hour line at setting 2 is ~139k.
export const PRICE = { input: 5e-6, output: 25e-6, read: 0.5e-6, write5m: 6.25e-6, write1h: 10e-6 };
export const priced = (over: Record<string, number> = {}) =>
  new PriceBook({
    bundled: {
      "claude-opus-5-5": {
        input_cost_per_token: PRICE.input,
        output_cost_per_token: PRICE.output,
        cache_read_input_token_cost: PRICE.read,
        cache_creation_input_token_cost: PRICE.write5m,
        cache_creation_input_token_cost_above_1hr: PRICE.write1h,
        ...over,
      },
    },
  });

/** A thread as `threads.list` gives it, in the fields Cache Keeper reads. */
export interface Row {
  id: string;
  providerId: string;
  status: string;
  parentThreadId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  title: string | null;
  titleFallback: string | null;
  hasPendingInteraction: boolean;
  environmentHostId: string | null;
  queuedWork: "none" | "waiting" | "failed";
  activity: { activeBackgroundCommandCount: number; activeBackgroundAgentCount: number };
  lastReadAt: number | null;
  latestAttentionAt: number;
}

export const busy = { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 };

/** One thread's side of the fake bb: its events, transcript, queue and window. */
export interface Side {
  events: BbEvent[];
  facts: TranscriptFacts;
  requests: TranscriptRequest[];
  queued: QueuedRow[];
  lifetime: "5m" | "1h";
  session: string;
  /** The transcript file's identity: a new one is read from the start. */
  ino: number;
  window: number | null;
  /** Set to say the transcript cannot be read or parsed. */
  unreadable?: string;
}

/** The fields of bb's `client/turn/requested` event that say who sent a request and what it reports. */
export interface Requested {
  initiator: string;
  input: unknown[];
  systemMessageKind?: string;
  systemMessageSubject?: unknown;
}

/** A reply that says what the message asked for: the quoted reply when it asks for one exactly. */
const asked = (text: string) => /reply with exactly "(.+)"/i.exec(text)?.[1] ?? "OK";

/** A queued row as bb lists it. */
export const queued = (over: { id: string; createdAt: number; sendAt?: number | null; failureReason?: string | null; initiator?: string; content?: unknown[] }): QueuedRow =>
  queuedRowOf({ sendAt: null, failureReason: null, initiator: "user", content: [], ...over });

export class FakeBb {
  now = T0;
  rows = new Map<string, Row>();
  sides = new Map<string, Side>();
  /** Task events by thread, merged into its events. */
  outputs = new Map<string, number>();
  sent: { threadId: string; text: string; at: number; ran: boolean }[] = [];
  deleted: string[] = [];
  warnings: string[] = [];
  infos: string[] = [];
  checkIns = true;
  /** Every waiting thread by default here, so the tests of how a tree is kept warm need no switch. */
  keepWarm: KeepWarmSetting = "every";
  waitMs = 15 * MIN;
  prices = priced();
  /** Machines that do not answer. */
  down = new Set<string>();
  /** Threads whose send bb refuses as busy. */
  refuse = new Set<string>();
  /** Threads whose send fails outright. */
  failSend = new Set<string>();
  /** Replies by thread, overriding the one the message asked for. */
  replies = new Map<string, string>();
  /** Run before bb answers a `threads.get` or a transcript read: a test changes things there. */
  onGet: ((threadId: string) => void) | null = null;
  onTranscript: ((threadId: string) => void) | null = null;
  onTasks: ((sessionId: string) => void) | null = null;
  /** What bb puts on each report it delivers; a test changes it to drop a field. */
  reportFields = (r: Requested): Requested => r;
  /** Fields to leave out of every list row and get. */
  drop: string[] = [];
  calls = { list: 0, get: 0, events: 0, transcript: 0, tasks: 0, window: 0, pending: 0, queued: 0, send: 0 };
  retained: { hostId: string; at: number }[] = [];
  transcriptCursors: (TranscriptCursor | null)[] = [];
  db: Database.Database;
  store: Store;
  engine: Engine;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private timerId = 0;
  private seq = 0;
  private req = 0;
  private inoNext = 1;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    ensureIncrementalVacuum(this.db);
    for (const m of MIGRATIONS) this.db.exec(m);
    this.store = new Store(this.db);
    this.engine = this.build();
  }

  clock: Clock = { now: () => this.now, fromWall: (wall) => wall, jumps: () => [] };

  private fakeTimers: Timers = {
    set: (fn, ms) => {
      const id = ++this.timerId;
      this.timers.push({ at: this.now + Math.max(0, ms), fn, id });
      return id;
    },
    clear: (handle) => {
      this.timers = this.timers.filter((t) => t.id !== handle);
    },
  };

  /** An engine over this fake bb and the same store, as after a restart. */
  build(): Engine {
    this.timers = [];
    const deps: EngineDeps = {
      store: this.store,
      clock: this.clock,
      timers: this.fakeTimers,
      settings: () => ({ keepWarm: this.keepWarm, checkIns: this.checkIns, waitMs: this.waitMs, fetchPrices: false }),
      prices: () => this.prices,
      listThreads: async () => {
        this.calls.list++;
        return [...this.rows.values()].filter((r) => r.archivedAt === null && r.deletedAt === null).map((r) => this.strip({ ...r }));
      },
      getThread: async (id) => {
        this.calls.get++;
        this.onGet?.(id);
        const r = this.rows.get(id);
        if (r === undefined || r.deletedAt !== null) return null;
        return this.strip(this.dto(r));
      },
      hostOf: async (id) => this.rows.get(id)?.environmentHostId ?? null,
      pendingInteractions: async (id) => {
        this.calls.pending++;
        if (this.drop.includes("pendingInteractions")) return { error: "no" };
        return this.rows.get(id)?.hasPendingInteraction ? [{ id: "int_1" }] : [];
      },
      queuedMessages: async (id) => {
        this.calls.queued++;
        return this.side(id).queued;
      },
      deleteQueued: async (id, rowId) => {
        this.deleted.push(rowId);
        this.side(id).queued = this.side(id).queued.filter((r) => r.id !== rowId);
      },
      contextWindow: async (id) => {
        this.calls.window++;
        return this.side(id).window;
      },
      sessionId: async (id) => this.side(id).session,
      events: async (id, after) => {
        this.calls.events++;
        return this.side(id).events.filter((e) => e.seq > after).slice(0, EVENTS_PAGE);
      },
      latestEventSeq: async (id) => this.side(id).events.at(-1)?.seq ?? 0,
      transcript: async (hostId, session, cursor) => {
        this.calls.transcript++;
        this.transcriptCursors.push(cursor);
        const id = [...this.sides.entries()].find(([, s]) => s.session === session)?.[0];
        if (id !== undefined) this.onTranscript?.(id);
        if (this.down.has(hostId)) throw new Error(`host ${hostId} timed out`);
        if (id === undefined) return { found: false, cwdSlug: null, cursor: null, facts: { ...EMPTY_FACTS }, requests: [], bytesRead: 0, unreadable: null };
        const side = this.side(id);
        const from = cursor !== null && cursor.ino === side.ino ? cursor.offset : 0;
        const requests = side.requests.slice(from);
        return {
          found: true,
          cwdSlug: "-work",
          cursor: { cwdSlug: "-work", ino: side.ino, offset: side.requests.length, fold: { facts: side.facts, lastKey: null, contextAt: null, keeperTurn: false, awaitingRequest: false } },
          facts: side.facts,
          requests,
          bytesRead: requests.length * 1_000,
          unreadable: side.unreadable ?? null,
        };
      },
      tasks: async (hostId, input) => {
        this.calls.tasks++;
        this.onTasks?.(input.sessionId);
        if (this.down.has(hostId)) throw new Error(`host ${hostId} timed out`);
        return {
          commands: input.commands.map((id) => ({ id, outputFile: `/tmp/claude-1000/-work/${input.sessionId}/tasks/${id}.output`, changedAt: this.outputs.get(id) ?? null })),
          subagents: input.subagents.map((id) => ({ id, lastTool: "Grep", changedAt: null })),
        };
      },
      retain: async (hostId) => {
        this.retained.push({ hostId, at: this.now });
      },
      send: async (threadId, text) => {
        this.calls.send++;
        if (this.failSend.has(threadId)) throw new Error("HTTP 500: boom");
        if (this.refuse.has(threadId)) return "busy";
        this.sent.push({ threadId, text, at: this.now, ran: false });
        // bb takes a plugin's send as the user's, and marks the thread read.
        this.patch(threadId, { lastReadAt: this.now });
        this.request(threadId, this.now, { initiator: "user", input: [{ type: "text", text, mentions: [] }] });
        return "sent";
      },
      markRead: async (id) => this.patch(id, { lastReadAt: this.now }),
      markUnread: async (id) => this.patch(id, { lastReadAt: null }),
      publish: () => {},
      log: { info: (m) => this.infos.push(m), warn: (m) => this.warnings.push(m) },
    };
    return new Engine(deps);
  }

  /** Restarts the engine over the same store, as after a restart of bb or the plugin. */
  async restart(): Promise<void> {
    this.engine.stop();
    this.engine = this.build();
    await this.start();
  }

  async start(): Promise<void> {
    await this.engine.start();
    await this.settle();
  }

  private strip<T extends object>(raw: T): T {
    const out = { ...raw } as Record<string, unknown>;
    for (const key of this.drop) delete out[key];
    return out as T;
  }

  /** The thread as bb's events and `threads.get` give it: no pending interaction, machine or command count. */
  dto(r: Row) {
    const { hasPendingInteraction: _p, environmentHostId: _h, queuedWork, activity, ...rest } = r;
    return { ...rest, activeBackgroundAgentCount: activity.activeBackgroundAgentCount, queuedMessageCount: queuedWork === "waiting" ? 1 : 0 };
  }

  thread(over: Partial<Row> & { id: string }): Row {
    const row: Row = {
      providerId: "claude-code",
      status: "idle",
      parentThreadId: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: T0,
      updatedAt: T0,
      title: over.id,
      titleFallback: null,
      hasPendingInteraction: false,
      environmentHostId: "host_1",
      queuedWork: "none",
      activity: { activeBackgroundCommandCount: 0, activeBackgroundAgentCount: 0 },
      lastReadAt: T0,
      latestAttentionAt: T0,
      ...over,
    };
    this.rows.set(row.id, row);
    this.side(row.id);
    return row;
  }

  get(id: string): Row {
    return this.rows.get(id)!;
  }

  patch(id: string, over: Partial<Row>) {
    const r = this.rows.get(id);
    if (r !== undefined) this.rows.set(id, { ...r, ...over, updatedAt: over.updatedAt ?? r.updatedAt });
  }

  side(id: string): Side {
    let side = this.sides.get(id);
    if (side === undefined) {
      side = { events: [], facts: { ...EMPTY_FACTS }, requests: [], queued: [], lifetime: "1h", session: `session-${id}`, ino: this.inoNext++, window: 1_000_000 };
      this.sides.set(id, side);
    }
    return side;
  }

  /** A thread's transcript: its last request at `at` with `context` tokens on a cache of `lifetime`. */
  transcript(id: string, at: number, context: number, lifetime: "5m" | "1h" = "1h", over: Partial<TranscriptFacts> = {}) {
    const side = this.side(id);
    side.lifetime = lifetime;
    side.facts = { ...EMPTY_FACTS, lastRequestAt: at, lifetime, context, model: "claude-opus-5-5", requests: 30, userMessages: 10, ...over };
  }

  event(id: string, type: string, at: number, data: unknown) {
    this.side(id).events.push({ seq: ++this.seq, type, createdAt: at, data });
  }

  request(id: string, at: number, fields: Requested): string {
    const requestId = `creq_${++this.req}`;
    this.event(id, "client/turn/requested", at, { requestId, ...fields, target: { kind: "new-turn" } });
    return requestId;
  }

  /** A background task starting in `id`'s turn. */
  task(id: string, taskId: string, kind: "command" | "subagent", at: number, description = "npm test") {
    this.event(id, "item/started", at, { item: { type: "backgroundTask", familyId: taskId, taskType: kind === "command" ? "local_bash" : "local_agent", description, taskStatus: "running" } });
  }

  taskDone(id: string, taskId: string, at: number) {
    this.event(id, "item/backgroundTask/completed", at, { item: { type: "backgroundTask", familyId: taskId, taskType: "local_bash", taskStatus: "completed" } });
  }

  /** A turn in `id` from `at`, lasting 1 second, taking the requests given and replying; one request to the model at its start. */
  turn(id: string, at: number, requestIds: string[], reply: string, usage = true, status = "completed") {
    this.event(id, "turn/started", at, {});
    for (const r of requestIds) this.event(id, "turn/input/accepted", at, { clientRequestId: r });
    this.event(id, "item/completed", at + 500, { item: { type: "agentMessage", id: "m", text: reply } });
    this.event(id, "turn/completed", at + S, { status });
    const side = this.side(id);
    const context = side.facts.context ?? 100_000;
    const write = { cacheWrite5m: side.lifetime === "5m" ? 200 : 0, cacheWrite1h: side.lifetime === "1h" ? 200 : 0 };
    // `/compact` writes no usage line to the transcript.
    if (usage) side.requests.push({ at, model: side.facts.model ?? "claude-opus-5-5", input: 3, output: 20, cacheRead: context, ...write });
    side.facts = { ...side.facts, lastRequestAt: at, lifetime: side.lifetime, requests: side.facts.requests + 1 };
    this.patch(id, { updatedAt: at + S });
    // bb draws attention to a top-level thread whose turn ends.
    if (this.get(id).parentThreadId === null) this.patch(id, { latestAttentionAt: at + S });
  }

  /** Tells the engine what bb would announce about `id` now. */
  emit(event: "created" | "active" | "idle" | "failed" | "archived" | "unarchived" | "deleted" | "pending", id: string) {
    this.engine.onThread(event, this.dto(this.get(id)));
  }

  /** A turn that runs in `id` now and ends, announced as bb does: active, then idle (or failed). */
  async ranTurn(id: string, requestIds: string[], reply: string, over: { usage?: boolean; status?: string } = {}) {
    this.patch(id, { status: "active" });
    this.emit("active", id);
    this.turn(id, this.now, requestIds, reply, over.usage ?? true, over.status ?? "completed");
    this.now += S;
    this.patch(id, { status: over.status === "failed" ? "error" : "idle" });
    this.emit(over.status === "failed" ? "failed" : "idle", id);
    await this.settle();
  }

  /** A message you type, and its turn. */
  async typed(id: string, text: string) {
    const r = this.request(id, this.now, { initiator: "user", input: [{ type: "text", text, mentions: [] }] });
    this.patch(id, { lastReadAt: this.now });
    this.side(id).facts = { ...this.side(id).facts, userMessages: this.side(id).facts.userMessages + 1 };
    await this.ranTurn(id, [r], "Done.");
  }

  /**
   * Runs every message Cache Keeper sent that has not run, then bb's reports
   * up the tree: each thread's turn ends a second after it starts, and its
   * report reaches the parent 2 seconds later, batched per parent.
   */
  async deliver() {
    let ended = new Set<string>();
    const runSent = async () => {
      const batch = new Set<string>();
      for (const s of this.sent.filter((x) => !x.ran)) {
        s.ran = true;
        const request = [...this.side(s.threadId).events].reverse().find((e) => e.type === "client/turn/requested")!;
        this.patch(s.threadId, { status: "active" });
        this.emit("active", s.threadId);
        this.turn(s.threadId, this.now, [(request.data as { requestId: string }).requestId], this.replies.get(s.threadId) ?? asked(s.text), s.text !== COMPACT_MESSAGE);
        batch.add(s.threadId);
      }
      if (batch.size === 0) return;
      await this.settle();
      this.now += S;
      for (const id of batch) {
        this.patch(id, { status: "idle" });
        this.emit("idle", id);
        ended.add(id);
      }
      await this.settle();
    };
    await runSent();
    while (ended.size > 0) {
      const byParent = new Map<string, string[]>();
      for (const id of ended) {
        const parent = this.get(id).parentThreadId;
        if (parent !== null) byParent.set(parent, [...(byParent.get(parent) ?? []), id]);
      }
      ended = new Set();
      if (byParent.size === 0) break;
      this.now += 2 * S;
      for (const [parent, children] of byParent) {
        const r = this.request(parent, this.now, this.reportFields(reportRequest(children.map((c) => ({ id: c, reply: this.lastReply(c) })))));
        this.patch(parent, { status: "active" });
        this.emit("active", parent);
        this.turn(parent, this.now, [r], "Noted.");
      }
      await this.settle();
      // A keep-warm the report's arrival set off runs beside the report's turn.
      await runSent();
      this.now += S;
      for (const parent of byParent.keys()) {
        this.patch(parent, { status: "idle" });
        this.emit("idle", parent);
        ended.add(parent);
      }
      await this.settle();
    }
  }

  /** bb queues a row for `id` and announces it with message.queued. */
  async queueRow(id: string, row: { id: string; createdAt: number; initiator?: string; content?: unknown[]; sendAt?: number | null; failureReason?: string | null }) {
    const raw = { sendAt: null, failureReason: null, initiator: "user", content: [], ...row, threadId: id };
    this.side(id).queued = [...this.side(id).queued.filter((r) => r.id !== row.id), queuedRowOf(raw)];
    this.patch(id, { queuedWork: "waiting" });
    this.engine.onQueued("queued", raw);
    await this.settle();
  }

  /** Starts the turn of the last message sent to `id`, leaving it running. */
  startTurn(id: string) {
    const s = this.sent.filter((x) => x.threadId === id).at(-1)!;
    s.ran = true;
    const request = [...this.side(id).events].reverse().find((e) => e.type === "client/turn/requested")!;
    this.event(id, "turn/started", this.now, {});
    this.event(id, "turn/input/accepted", this.now, { clientRequestId: (request.data as { requestId: string }).requestId });
    this.patch(id, { status: "active" });
    this.emit("active", id);
  }

  /** bb's request of a report of `child` into `parent`, before the turn that takes it starts. */
  requestReport(parent: string, child: string) {
    this.request(parent, this.now, reportRequest([{ id: child, reply: this.lastReply(child) }]));
  }

  lastReply(id: string): string {
    const e = [...this.side(id).events].reverse().find((x) => x.type === "item/completed");
    return (e?.data as { item: { text: string } } | undefined)?.item.text ?? "";
  }

  /** Report turns in `id` so far. */
  reportTurns(id: string) {
    return this.side(id).events.filter((e) => e.type === "client/turn/requested" && (e.data as { initiator: string }).initiator === "system").length;
  }

  /** Waits for every piece of work the engine queued. */
  async settle() {
    for (let i = 0; i < 5; i++) {
      await this.engine.idle();
      await new Promise((r) => setImmediate(r));
    }
  }

  /** When the engine's timer is next due, or null. */
  nextTimer(): number | null {
    return this.timers.length === 0 ? null : Math.min(...this.timers.map((t) => t.at));
  }

  /**
   * Moves the clock to `until`, firing the engine's timer at each moment it
   * was set for, and running whatever it sent (`deliver`) unless told not to.
   */
  async advance(until: number, deliver = true) {
    for (;;) {
      const next = this.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.now = Math.max(this.now, next.at);
      next.fn();
      await this.settle();
      if (deliver && this.sent.some((s) => !s.ran)) await this.deliver();
    }
    this.now = Math.max(this.now, until);
  }
}

/** bb's report of child turns, as bb 0.44 requests it: one line with the reply, or a batch naming each. */
export function reportRequest(children: { id: string; reply: string }[]): Requested {
  if (children.length === 1) {
    const c = children[0]!;
    const mention = `@thread:${c.id}`;
    return {
      initiator: "system",
      systemMessageKind: "child-completed",
      systemMessageSubject: { kind: "thread", threadId: c.id, threadName: c.id },
      input: [{ type: "text", text: `[bb system]\n\n${mention} completed:\n\n${c.reply}`, mentions: [{ start: 13, end: 13 + mention.length, resource: { kind: "thread", threadId: c.id, label: c.id } }] }],
    };
  }
  let text = "[bb system]\n\nChild thread updates:\n\n";
  const mentions: { start: number; end: number; resource: { kind: "thread"; threadId: string; label: string } }[] = [];
  children.forEach((c, i) => {
    text += i === 0 ? "- " : "\n- ";
    const mention = `@thread:${c.id}`;
    mentions.push({ start: text.length, end: text.length + mention.length, resource: { kind: "thread", threadId: c.id, label: c.id } });
    text += `${mention} completed.`;
  });
  return { initiator: "system", systemMessageKind: "child-outcome-batch", systemMessageSubject: { kind: "thread-batch", count: children.length }, input: [{ type: "text", text, mentions }] };
}

/** bb's queued report row, as it queues one behind a question: the report's text and mentions, and no kind. */
export const reportRow = (id: string, createdAt: number, children: { id: string; reply: string }[]) =>
  queued({ id, createdAt, initiator: "system", content: reportRequest(children).input });
