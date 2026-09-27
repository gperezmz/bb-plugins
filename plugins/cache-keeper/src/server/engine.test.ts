import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { COMPACT_MESSAGE } from "../core/messages";
import { PriceBook } from "../core/pricing";
import { EMPTY_FACTS, type TranscriptFacts, type TranscriptRequest } from "../core/transcript";
import type { BbEvent } from "../core/turns";
import { ClaudeOnlyError, Engine, EVENTS_PAGE, NotReadyError, type EngineDeps, type ListedThread, type QueuedRow, type TaskEvent } from "./engine";
import { MIGRATIONS, Store } from "./store";

const S = 1_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 8, 27, 10, 0);

// Opus 5.5 per token: the 1-hour line at setting 2 is ~139k.
const PRICE = { input: 5e-6, output: 25e-6, read: 0.5e-6, write5m: 6.25e-6, write1h: 10e-6 };
const prices = new PriceBook({
  bundled: {
    "claude-opus-5-5": {
      input_cost_per_token: PRICE.input,
      output_cost_per_token: PRICE.output,
      cache_read_input_token_cost: PRICE.read,
      cache_creation_input_token_cost: PRICE.write5m,
      cache_creation_input_token_cost_above_1hr: PRICE.write1h,
    },
  },
});

const thread = (over: Partial<ListedThread> & { id: string }): ListedThread => ({
  providerId: "claude-code",
  status: "idle",
  parentThreadId: null,
  archivedAt: null,
  deletedAt: null,
  createdAt: T0,
  title: over.id,
  titleFallback: null,
  hasPendingInteraction: false,
  environmentHostId: "host_1",
  queuedWork: "none",
  activity: { activeBackgroundCommandCount: 0, activeBackgroundAgentCount: 0 },
  lastReadAt: T0,
  latestAttentionAt: T0,
  ...over,
});

const busy = { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 };

/** One thread's side of the fake bb: its events, its transcript and its queue. */
interface Side {
  events: BbEvent[];
  facts: TranscriptFacts;
  requests: TranscriptRequest[];
  queued: QueuedRow[];
  lifetime: "5m" | "1h";
}

/** A reply that says what the message asked for: the quoted reply when it asks for one exactly. */
const asked = (text: string) => /reply with exactly "(.+)"/i.exec(text)?.[1] ?? "OK";

/**
 * A fake bb that records turns the way bb 0.44 does: a request, the turn
 * taking it, the agent's reply, and 2 seconds after a child's turn ends, a
 * report of it in the parent, batched when several end together.
 */
class Harness {
  now = T0;
  threads: ListedThread[] = [];
  sides = new Map<string, Side>();
  taskEvents = new Map<string, TaskEvent[]>();
  outputs = new Map<string, number>();
  sent: { threadId: string; text: string; marker: unknown; ran: boolean }[] = [];
  deleted: string[] = [];
  checkIns = true;
  failTasks = false;
  failEvents = false;
  /** Replies by thread, overriding the one the message asked for. */
  replies = new Map<string, string>();
  db = new Database(":memory:");
  store: Store;
  engine: Engine;
  private seq = 0;
  private req = 0;

  constructor() {
    for (const m of MIGRATIONS) this.db.exec(m);
    this.store = new Store(this.db);
    this.engine = this.build();
  }

  build(): Engine {
    const deps: EngineDeps = {
      store: this.store,
      now: () => this.now,
      settings: () => ({ checkIns: this.checkIns, waitMs: 15 * MIN, fetchPrices: false }),
      prices: () => prices,
      listThreads: async () => this.threads.map((t) => ({ ...t })),
      queuedMessages: async (id) => this.side(id).queued,
      deleteQueued: async (id, rowId) => {
        this.deleted.push(rowId);
        this.side(id).queued = this.side(id).queued.filter((r) => r.id !== rowId);
      },
      contextWindow: async () => 1_000_000,
      sessionId: async (id) => `session-${id}`,
      taskEvents: async (id, after) => {
        if (this.failEvents) throw new Error("HTTP 400: Thread event limit cannot exceed 100");
        return (this.taskEvents.get(id) ?? []).filter((e) => e.seq > after);
      },
      turnEvents: async (id, after) => this.side(id).events.filter((e) => e.seq > after).slice(0, EVENTS_PAGE),
      latestEventSeq: async (id) => this.side(id).events.at(-1)?.seq ?? 0,
      transcript: async (_host, session, since) => {
        const side = this.side(session.replace("session-", ""));
        return { found: true, cwdSlug: "-work", facts: side.facts, requests: since === null ? [] : side.requests.filter((r) => r.at >= since) };
      },
      tasks: async (_host, input) => {
        if (this.failTasks) throw new Error("machine offline");
        return {
          commands: input.commands.map((id) => ({ id, outputFile: `/tmp/claude-1000/-work/${input.sessionId}/tasks/${id}.output`, changedAt: this.outputs.get(id) ?? null })),
          subagents: input.subagents.map((id) => ({ id, lastTool: "Grep", changedAt: null })),
        };
      },
      send: async (threadId, text, marker) => {
        this.sent.push({ threadId, text, marker, ran: false });
        // bb takes a plugin's send as the user's, and marks the thread read.
        this.patch(threadId, { lastReadAt: this.now });
        this.request(threadId, this.now, [{ type: "text", text, mentions: [] }], "user");
      },
      readState: async (id) => {
        const t = this.get(id);
        return { lastReadAt: t.lastReadAt, latestAttentionAt: t.latestAttentionAt };
      },
      markRead: async (id) => this.patch(id, { lastReadAt: this.now }),
      markUnread: async (id) => this.patch(id, { lastReadAt: null }),
      publish: () => {},
      log: { info: () => {}, warn: () => {} },
    };
    return new Engine(deps);
  }

  get(id: string) {
    return this.threads.find((t) => t.id === id)!;
  }

  patch(id: string, over: Partial<ListedThread>) {
    this.threads = this.threads.map((t) => (t.id === id ? { ...t, ...over } : t));
  }

  side(id: string): Side {
    let side = this.sides.get(id);
    if (side === undefined) {
      side = { events: [], facts: { ...EMPTY_FACTS }, requests: [], queued: [], lifetime: "1h" };
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

  private event(id: string, type: string, at: number, data: unknown) {
    this.side(id).events.push({ seq: ++this.seq, type, createdAt: at, data });
  }

  private request(id: string, at: number, input: unknown[], initiator: string): string {
    const requestId = `creq_${++this.req}`;
    this.event(id, "client/turn/requested", at, { requestId, initiator, input, target: { kind: "new-turn" } });
    return requestId;
  }

  /** A turn in `id` from `at`, lasting 1 second, taking the requests given and replying; one request to the model at the turn's start. */
  turn(id: string, at: number, requestIds: string[], reply: string, usage = true) {
    this.event(id, "turn/started", at, {});
    for (const r of requestIds) this.event(id, "turn/input/accepted", at, { clientRequestId: r });
    this.event(id, "item/completed", at + 500, { item: { type: "agentMessage", id: "m", text: reply } });
    this.event(id, "turn/completed", at + S, { status: "completed" });
    const side = this.side(id);
    const context = side.facts.context ?? 100_000;
    const write = { cacheWrite5m: side.lifetime === "5m" ? 200 : 0, cacheWrite1h: side.lifetime === "1h" ? 200 : 0 };
    // `/compact` writes no usage line to the transcript.
    if (usage) side.requests.push({ at, model: "claude-opus-5-5", input: 3, output: 20, cacheRead: context, ...write });
    side.facts = { ...side.facts, lastRequestAt: at, requests: side.facts.requests + 1 };
    // bb draws attention to a top-level thread whose turn ends.
    if (this.get(id).parentThreadId === null) this.patch(id, { latestAttentionAt: at + S });
  }

  /** A message you type, and its turn. */
  typed(id: string, text: string) {
    const r = this.request(id, this.now, [{ type: "text", text, mentions: [] }], "user");
    this.patch(id, { lastReadAt: this.now });
    this.turn(id, this.now, [r], "Done.");
    this.side(id).facts = { ...this.side(id).facts, userMessages: this.side(id).facts.userMessages + 1 };
  }

  /**
   * Runs every message Cache Keeper sent that has not run, then bb's reports
   * up the tree: each thread's turn ends a second after it starts, and its
   * report reaches the parent 2 seconds later, batched per parent.
   */
  async deliver() {
    let ended = new Map<string, number>();
    const runSent = (at: number) => {
      for (const s of this.sent.filter((x) => !x.ran)) {
        s.ran = true;
        const requestId = [...this.side(s.threadId).events].reverse().find((e) => e.type === "client/turn/requested")!;
        this.turn(s.threadId, at, [(requestId.data as { requestId: string }).requestId], this.replies.get(s.threadId) ?? asked(s.text), s.text !== COMPACT_MESSAGE);
        ended.set(s.threadId, at + S);
      }
    };
    runSent(this.now);
    while (ended.size > 0) {
      const byParent = new Map<string, { children: string[]; at: number }>();
      for (const [id, at] of ended) {
        const parent = this.get(id).parentThreadId;
        if (parent === null) continue;
        const entry = byParent.get(parent) ?? { children: [], at: 0 };
        entry.children.push(id);
        entry.at = Math.max(entry.at, at + 2 * S);
        byParent.set(parent, entry);
      }
      ended = new Map();
      for (const [parent, { children, at }] of byParent) {
        const input = reportInput(children.map((c) => ({ id: c, reply: this.lastReply(c) })));
        const r = this.request(parent, at, input, "system");
        // bb tells plugins the parent turned active before its turn runs.
        this.now = at;
        await this.engine.onActive(parent);
        this.turn(parent, at, [r], "Noted.");
        ended.set(parent, at + S);
      }
      // A keep-warm the report's arrival set off runs beside the report's turn.
      runSent(this.now);
    }
    this.now = Math.max(this.now, ...[...this.sides.values()].map((s) => s.events.at(-1)?.createdAt ?? 0)) + S;
    await this.engine.pass();
  }

  lastReply(id: string): string {
    const e = [...this.side(id).events].reverse().find((x) => x.type === "item/completed");
    return (e?.data as { item: { text: string } } | undefined)?.item.text ?? "";
  }

  /** Report turns in `id` so far. */
  reportTurns(id: string) {
    return this.side(id).events.filter((e) => e.type === "client/turn/requested" && (e.data as { initiator: string }).initiator === "system").length;
  }

  /** Steps the clock in `step` increments up to `until`, running a pass at each and delivering whatever was sent. */
  async run(until: number, step = 5 * S) {
    while (this.now < until) {
      this.now += step;
      await this.engine.pass();
      if (this.sent.some((s) => !s.ran)) await this.deliver();
    }
  }
}

/** bb's report of child turns: one line with the reply, or a batch naming each. */
function reportInput(children: { id: string; reply: string }[]): unknown[] {
  if (children.length === 1) {
    const mention = `@thread:${children[0]!.id}`;
    return [{ type: "text", text: `[bb system]\n\n${mention} completed:\n\n${children[0]!.reply}`, mentions: [{ start: 13, end: 13 + mention.length, resource: { kind: "thread", threadId: children[0]!.id, label: children[0]!.id } }] }];
  }
  let text = "[bb system]\n\nChild thread updates:\n\n";
  const mentions: unknown[] = [];
  children.forEach((c, i) => {
    text += i === 0 ? "- " : "\n- ";
    const mention = `@thread:${c.id}`;
    mentions.push({ start: text.length, end: text.length + mention.length, resource: { kind: "thread", threadId: c.id, label: c.id } });
    text += `${mention} completed.`;
  });
  return [{ type: "text", text, mentions }];
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe("compact when idle", () => {
  it("compacts an idle thread over its line a minute before its cache expires, once per idle stretch", async () => {
    h.threads = [thread({ id: "t1" })];
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);

    h.now = T0 + 30 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("t1"))?.compactionDue).toBe(true);

    h.now = T0 + 59 * MIN;
    await h.engine.pass();
    expect(h.sent.map((s) => s.text)).toEqual([COMPACT_MESSAGE]);
    expect(h.sent[0]!.marker).toMatchObject({ kind: "compact" });

    // The compaction's own turn stays inside the stretch, and nothing more is sent in it.
    await h.deliver();
    h.side("t1").facts = { ...h.side("t1").facts, lastCompaction: { at: h.now, preTokens: 300_000, postTokens: 10_000 } };
    await h.engine.pass();
    const entry = h.store.history(0).find((r) => r.kind === "compaction")!;
    expect(entry.record.contextAfter).toBe(10_000);
    // `/compact` leaves no usage in the transcript, so the entry keeps its estimate rather than $0.
    expect(entry.record.usd).toBeCloseTo(300_000 * PRICE.read + 20_000 * PRICE.output, 10);
    h.now = T0 + 118 * MIN + 30 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
  });

  it("does nothing on a thread under its line, switched off, or waiting", async () => {
    h.threads = [thread({ id: "under" }), thread({ id: "off" }), thread({ id: "busy", activity: busy })];
    h.transcript("under", T0, 50_000);
    h.transcript("off", T0, 300_000);
    h.transcript("busy", T0, 300_000);
    h.checkIns = false;
    await h.engine.setCompact("under", true);
    await h.engine.setCompact("busy", true);
    h.now = T0 + 59 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
  });

  it("does not compact a parent between a child's turn ending and bb's report of it arriving", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p" })];
    h.transcript("p", T0, 300_000);
    h.transcript("c", T0, 50_000);
    await h.engine.setCompact("p", true);
    h.now = T0 + 59 * MIN;
    // The child's turn has just ended; its report is not in yet.
    h.turn("c", h.now - 2 * S, [], "Finished the page.");
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("p"))?.waiting).toBe(true);
  });

  it("does not hold a tree for a report bb queued behind a question", async () => {
    h.threads = [
      thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" }),
      thread({ id: "a", parentThreadId: "p" }),
      thread({ id: "b", parentThreadId: "p", activity: busy }),
    ];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("b", T0, 100_000, "5m");
    h.now = T0 + 150 * S;
    h.turn("a", h.now - 5 * S, [], "Finished the page.");
    h.side("p").queued = [{ id: "row", sendAt: null, createdAt: h.now - 3 * S, failed: false, system: true, content: reportInput([{ id: "a", reply: "Finished the page." }]) }];
    await h.engine.pass();
    expect(h.sent.map((x) => x.threadId)).toEqual(["b"]);
  });

  it("does not send a compaction whose deadline passed while the server was down", async () => {
    h.threads = [thread({ id: "t1" })];
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);
    h.engine = h.build();
    h.now = T0 + 61 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("t1"))?.compactOn).toBe(true);
  });

  it("acts at the transcript's deadline after a restart", async () => {
    h.threads = [thread({ id: "t1" })];
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);
    h.engine = h.build();
    h.now = T0 + 59 * MIN + 10 * S;
    await h.engine.pass();
    expect(h.sent.map((s) => s.text)).toEqual([COMPACT_MESSAGE]);
  });

  it("refuses threads that are not Claude Code", async () => {
    h.threads = [thread({ id: "pi", providerId: "pi" })];
    await expect(h.engine.setCompact("pi", true)).rejects.toBeInstanceOf(ClaudeOnlyError);
    expect(await h.engine.viewOf("pi")).toBeNull();
  });

  it("starts a thread at the setting last chosen, or 2", async () => {
    h.threads = [thread({ id: "a" }), thread({ id: "b" }), thread({ id: "c" })];
    for (const id of ["a", "b", "c"]) h.transcript(id, T0, 1);
    expect((await h.engine.setCompact("a", true))?.setting).toBe(2);
    await h.engine.setSetting("a", 5);
    expect((await h.engine.setCompact("b", true))?.setting).toBe(5);
    await h.engine.setCompact("c", true, 3);
    expect((await h.engine.viewOf("c"))?.setting).toBe(3);
  });

  it("compacts now under the line, but not while waiting", async () => {
    h.threads = [thread({ id: "t1" }), thread({ id: "t2", queuedWork: "waiting" })];
    h.side("t2").queued = [{ id: "q1", sendAt: null, createdAt: T0, failed: false, system: false, content: [] }];
    h.transcript("t1", T0, 20_000);
    h.transcript("t2", T0, 20_000);
    await h.engine.compactNow("t1");
    expect(h.sent.map((s) => s.threadId)).toEqual(["t1"]);
    await expect(h.engine.compactNow("t2")).rejects.toBeInstanceOf(NotReadyError);
  });
});

describe("keeping a thread tree warm", () => {
  it("keeps a thread waiting on background work warm at its deadline with an unconditional keep-warm", async () => {
    h.threads = [thread({ id: "t", activity: busy })];
    h.transcript("t", T0, 200_000);
    h.now = T0 + 59 * MIN - 61 * S;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    expect(h.engine.wakeAt()).toBe(T0 + 59 * MIN - 60 * S);
    h.now = T0 + 59 * MIN - 60 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toMatch(/^Still waiting on .*There's no need to check anything\. Reply with exactly "Not finished yet, still waiting on .*\. Nothing needed from you\."$/);
    expect(h.sent[0]!.marker).toMatchObject({ kind: "keep-warm" });
  });

  it("sends only the child of a 1-hour parent over a 5-minute child, and the parent takes one report turn per keep-warm", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.run(T0 + 20 * MIN);
    const toParent = h.sent.filter((s) => s.threadId === "p");
    const toChild = h.sent.filter((s) => s.threadId === "c");
    expect(toParent).toEqual([]);
    expect(toChild.length).toBeGreaterThan(3);
    expect(h.reportTurns("p")).toBe(toChild.length);
    // Those report turns are not your messages in the parent's calls per message.
    expect(h.store.get("p").keeperReports).toEqual({ turns: toChild.length, requests: toChild.length });
    // Each keep-warm went 90 seconds before the child's deadline: every 150 seconds once aligned.
    const times = h.sides.get("c")!.requests.map((r) => r.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(150 * S + 5 * S);
  });

  it("stops the child's keep-warms within its first hour under a 1-hour parent of similar size", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.run(T0 + 70 * MIN, 10 * S);
    const last = h.sent.filter((s) => s.threadId === "c").length;
    await h.run(T0 + 90 * MIN, 10 * S);
    expect(h.sent.filter((s) => s.threadId === "c").length).toBe(last);
    const lastAt = h.sides.get("c")!.requests.at(-1)!.at;
    expect(lastAt).toBeLessThan(T0 + 60 * MIN);
    // Each keep-warm cost a read of the child's context and of the parent's, charged to the child.
    const charged = h.store.get("c").stretch!.chargedUsd;
    expect(charged).toBeLessThanOrEqual(PRICE.write5m * 100_000);
    expect(charged).toBeGreaterThan(PRICE.write5m * 100_000 * 0.7);
    expect((await h.engine.viewOf("c"))?.warmPlanned).toBe(false);
  });

  it("sends a shallower leaf when the report from a deeper one reaches its level, so the parent takes one report turn", async () => {
    h.threads = [
      thread({ id: "p" }),
      thread({ id: "c1", parentThreadId: "p" }),
      thread({ id: "g", parentThreadId: "c1", activity: busy }),
      thread({ id: "c2", parentThreadId: "p", activity: busy }),
    ];
    h.transcript("p", T0, 20_000, "1h");
    h.transcript("c1", T0, 20_000, "1h");
    h.transcript("g", T0, 20_000, "5m");
    h.transcript("c2", T0, 20_000, "5m");
    h.now = T0 + 4 * MIN - 120 * S;
    await h.engine.pass();
    expect(h.sent.map((x) => x.threadId)).toEqual(["g"]);
    await h.deliver();
    expect(h.sent.map((x) => x.threadId)).toEqual(["g", "c2"]);
    expect(h.reportTurns("p")).toBe(1);
    const entry = h.store.history(0).find((r) => r.kind === "keep-warm")!;
    expect(entry.record.threads).toEqual(["g", "c2"]);
    expect(entry.threadId).toBe("p");
  });

  it("sends a shallower leaf 30 seconds a level after the deeper one when no report comes", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c1", parentThreadId: "p" }), thread({ id: "g", parentThreadId: "c1", activity: busy }), thread({ id: "c2", parentThreadId: "p", activity: busy })];
    for (const id of ["p", "c1"]) h.transcript(id, T0, 20_000, "1h");
    for (const id of ["g", "c2"]) h.transcript(id, T0, 20_000, "5m");
    h.now = T0 + 4 * MIN - 120 * S;
    await h.engine.pass();
    expect(h.engine.wakeAt()).toBe(h.now + 30 * S);
    h.now += 30 * S;
    await h.engine.pass({ due: true });
    expect(h.sent.map((x) => x.threadId)).toEqual(["g", "c2"]);
  });

  it("aligns three children so the parent takes one batched report turn per cycle", async () => {
    h.threads = [
      thread({ id: "p" }),
      thread({ id: "a", parentThreadId: "p", activity: busy }),
      thread({ id: "b", parentThreadId: "p", activity: busy }),
      thread({ id: "c", parentThreadId: "p", activity: busy }),
    ];
    h.transcript("p", T0, 20_000, "1h");
    h.transcript("a", T0, 20_000, "5m");
    h.transcript("b", T0 + 50 * S, 20_000, "5m");
    h.transcript("c", T0 + 100 * S, 20_000, "5m");
    await h.run(T0 + 5 * MIN);
    const reportsBefore = h.reportTurns("p");
    const sentBefore = h.sent.length;
    await h.run(T0 + 20 * MIN);
    const sends = h.sent.slice(sentBefore);
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.length % 3).toBe(0);
    expect(h.reportTurns("p") - reportsBefore).toBe(sends.length / 3);
    // One page entry per send moment, naming the three threads.
    const entries = h.store.history(0).filter((r) => r.kind === "keep-warm" && r.at >= T0 + 5 * MIN);
    expect(entries.every((e) => e.record.threads?.length === 3)).toBe(true);
  });

  it("sends nothing below a thread you skipped, and nothing with the setting off or a pending interaction", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.engine.pass();
    await h.engine.skip("p", "warm", false);
    await h.run(T0 + 10 * MIN);
    expect(h.sent).toEqual([]);
    expect((await h.engine.viewOf("c"))?.warmPlanned).toBe(false);

    await h.engine.skip("p", "warm", true);
    h.checkIns = false;
    await h.run(T0 + 12 * MIN);
    h.checkIns = true;
    h.patch("c", { hasPendingInteraction: true });
    h.transcript("c", h.now, 100_000, "5m");
    await h.run(h.now + 5 * MIN);
    expect(h.sent).toEqual([]);
  });

  it("keeps the idle stretch through Cache Keeper's turns and their reports, and ends it on one you type", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.engine.pass();
    const stretch = h.store.get("p").stretch!.startedAt;
    await h.run(T0 + 10 * MIN);
    expect(h.store.get("p").stretch?.startedAt).toBe(stretch);
    expect(h.store.get("c").stretch?.chargedUsd).toBeGreaterThan(0);
    h.typed("c", "also update the docs");
    h.now += 2 * S;
    await h.engine.pass();
    expect(h.store.get("c").stretch?.chargedUsd ?? 0).toBe(0);
  });

  it("charges a batched report turn split equally between the children it reports", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "a", parentThreadId: "p", activity: busy }), thread({ id: "b", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 40_000, "1h");
    h.transcript("a", T0, 10_000, "5m");
    h.transcript("b", T0, 10_000, "5m");
    await h.run(T0 + 3 * MIN);
    const entry = h.store.history(0).find((r) => r.kind === "keep-warm")!;
    expect(entry.record.threads).toEqual(["a", "b"]);
    const read = (tokens: number) => 3 * PRICE.input + 20 * PRICE.output + tokens * PRICE.read;
    expect(entry.record.split!.p).toBeCloseTo(read(40_000) + 200 * PRICE.write1h, 10);
    expect(entry.record.split!.a).toBeCloseTo(read(10_000) + 200 * PRICE.write5m, 10);
    expect(entry.record.usd).toBeCloseTo(entry.record.split!.a! + entry.record.split!.b! + entry.record.split!.p!, 10);
    expect(h.store.get("a").stretch!.chargedUsd).toBeCloseTo(entry.record.split!.a! + entry.record.split!.p! / 2, 10);
  });

  it("attributes the same way after a restart between the keep-warm and its report", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    h.now = T0 + 150 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    h.engine = h.build();
    const stretch = h.store.get("p").stretch!.startedAt;
    await h.deliver();
    expect(h.store.get("p").stretch?.startedAt).toBe(stretch);
    expect(h.store.get("c").stretch!.chargedUsd).toBeGreaterThan(0);
  });
});

describe("read state", () => {
  it("puts a read thread back to read after a keep-warm that brought nothing new and the parent's report of it", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.run(T0 + 3 * MIN);
    expect(h.reportTurns("p")).toBe(1);
    const p = h.get("p");
    expect(p.lastReadAt! >= p.latestAttentionAt!).toBe(true);
  });

  it("marks a child unread again when it was unread before the keep-warm", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy, lastReadAt: null })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.run(T0 + 3 * MIN);
    expect(h.sent.map((s) => s.threadId)).toEqual(["c"]);
    expect(h.get("c").lastReadAt).toBeNull();
  });

  it("leaves an unread thread unread, though bb marked it read when the keep-warm arrived", async () => {
    h.threads = [thread({ id: "t", activity: busy, lastReadAt: T0 - MIN, latestAttentionAt: T0 })];
    h.transcript("t", T0, 100_000, "5m");
    await h.run(T0 + 3 * MIN);
    expect(h.sent).toHaveLength(1);
    const t = h.get("t");
    expect(t.lastReadAt === null || t.lastReadAt < t.latestAttentionAt!).toBe(true);
  });

  it("leaves unread a keep-warm whose reply is news, and the parent's report of it", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    h.replies.set("c", "The deploy failed; I restarted it.");
    await h.run(T0 + 3 * MIN);
    const p = h.get("p");
    expect(p.lastReadAt! < p.latestAttentionAt!).toBe(true);
  });

  it("keeps a thread read when you read it during the turn, though the turn's end drew attention to it", async () => {
    h.threads = [thread({ id: "t", activity: busy, lastReadAt: T0 - MIN, latestAttentionAt: T0 })];
    h.transcript("t", T0, 100_000, "5m");
    h.now = T0 + 180 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    h.now += 500;
    h.patch("t", { lastReadAt: h.now });
    await h.deliver();
    const t = h.get("t");
    expect(t.lastReadAt! >= t.latestAttentionAt!).toBe(true);
  });

  it("leaves the read state as you set it during the turn", async () => {
    h.threads = [thread({ id: "t", activity: busy })];
    h.transcript("t", T0, 100_000, "5m");
    h.now = T0 + 180 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    h.patch("t", { lastReadAt: null });
    await h.deliver();
    expect(h.get("t").lastReadAt).toBeNull();
  });
});

describe("queued reports", () => {
  it("deletes report rows that bring nothing new from a thread waiting on your answer, and does not wait on them", async () => {
    h.threads = [thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    h.now = T0 + 150 * S;
    await h.engine.pass();
    await h.deliver();
    // bb queued the report behind the question instead of delivering it.
    const report = h.side("p").events.filter((e) => e.type === "client/turn/requested").at(-1)!;
    const row: QueuedRow = { id: "row1", sendAt: null, createdAt: h.now, failed: false, system: true, content: (report.data as { input: unknown[] }).input };
    const news: QueuedRow = { ...row, id: "row2", content: reportInput([{ id: "x", reply: "done" }]) };
    h.side("p").events = h.side("p").events.slice(0, h.side("p").events.indexOf(report));
    h.side("p").queued = [row, news];
    h.now += S;
    await h.engine.pass();
    expect(h.deleted).toEqual(["row1"]);
  });

  it("deletes a nothing-new row queued behind a real one, and keeps the real one", async () => {
    h.threads = [thread({ id: "p", hasPendingInteraction: true, queuedWork: "waiting" }), thread({ id: "c", parentThreadId: "p", activity: busy })];
    h.transcript("p", T0, 100_000, "1h");
    h.transcript("c", T0, 100_000, "5m");
    await h.engine.pass();
    // The child's own turn, with news, queued as a report behind the question.
    h.now = T0 + 20 * S;
    h.typed("c", "deploy it");
    const real: QueuedRow = { id: "real", sendAt: null, createdAt: h.now + 3 * S, failed: false, system: true, content: reportInput([{ id: "c", reply: "Done." }]) };
    h.side("p").queued = [real];
    h.now = T0 + 150 * S;
    h.transcript("c", T0 + 21 * S, 100_000, "5m");
    await h.run(T0 + 5 * MIN);
    const keepWarm = h.side("c").events.filter((e) => e.type === "turn/completed").at(-1)!;
    const quiet: QueuedRow = { ...real, id: "quiet", createdAt: keepWarm.createdAt + 2 * S, content: reportInput([{ id: "c", reply: h.lastReply("c") }]) };
    h.side("p").events = h.side("p").events.filter((e) => e.createdAt < T0 + 20 * S);
    h.side("p").queued = [real, quiet];
    h.now += S;
    await h.engine.pass();
    expect(h.deleted).toEqual(["quiet"]);
  });
});

describe("check-ins", () => {
  const withTask = (over: Partial<ListedThread> = {}) => {
    h.threads = [thread({ id: "t1", activity: busy, ...over })];
    h.transcript("t1", T0, 100_000);
    h.taskEvents.set("t1", [
      { seq: 5, type: "item/started", createdAt: T0, item: { type: "backgroundTask", familyId: "b1", taskType: "local_bash", description: "npm test", taskStatus: "running" } },
    ]);
  };

  it("checks in on a background command as soon as it stalls, even after Skip, asking for the Checked reply", async () => {
    withTask();
    h.outputs.set("b1", T0 + MIN);
    h.now = T0 + 10 * MIN;
    await h.engine.pass();
    await h.engine.skip("t1", "warm", false);
    expect(h.sent).toEqual([]);
    expect(h.engine.wakeAt()).toBe(T0 + 16 * MIN);
    h.now = T0 + 16 * MIN;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('Background command b1 ("npm test") hasn\'t printed anything in 15 minutes.');
    expect(h.sent[0]!.text).toContain('reply with exactly "Checked b1, still running normally, nothing new. Nothing needed from you."');
    expect(h.store.history(0).find((r) => r.kind === "check-in")?.record.tasks?.map((t) => t.id)).toEqual(["b1"]);
  });

  it("shows a check-in past the cost stop at the cold-write price", async () => {
    withTask();
    h.outputs.set("b1", T0 + MIN);
    h.store.update("t1", T0, (r) => ({ ...r, stretch: { startedAt: T0, compactedAt: null, compactSkipped: false, warmSkipped: false, chargedUsd: 1 } }));
    h.now = T0 + 16 * MIN;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    await h.deliver();
    const entry = h.store.history(0).find((r) => r.kind === "check-in")!;
    expect(entry.record.usd).toBeCloseTo(PRICE.write1h * 100_000, 10);
    expect(entry.record.split!.t1).toBeGreaterThan(0);
  });

  it("sends no routine check-in, and folds a task running 30 minutes into the next keep-warm", async () => {
    withTask();
    // Printing all along: never stalled.
    h.transcript("t1", T0 + 35 * MIN, 100_000, "5m");
    h.outputs.set("b1", T0 + 38 * MIN);
    h.now = T0 + 38 * MIN + 30 * S;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toMatch(/^Still waiting on background command b1/);
    expect(h.sent[0]!.text).toContain("has been running 38 minutes and is still printing");
    expect(h.sent[0]!.text).toContain('"Checked b1, still running normally, nothing new. Nothing needed from you."');
    expect(h.store.history(0).find((r) => r.kind === "keep-warm")?.record.folded).toEqual(["b1"]);
  });

  it("holds a check-in back when the machine's files cannot be read", async () => {
    withTask();
    h.failTasks = true;
    h.now = T0 + 16 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
  });

  it("drops a thread's view when a pass fails on it, and still lists it as switched on", async () => {
    withTask();
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);
    await h.engine.pass();
    expect(h.engine.allViews().map((v) => v.threadId)).toEqual(["t1"]);
    h.failEvents = true;
    await h.engine.pass();
    expect(h.engine.allViews()).toEqual([]);
    h.failEvents = false;
    expect((await h.engine.switchedOn()).map((v) => v.threadId)).toEqual(["t1"]);
    expect((await h.engine.viewOf("t1"))?.counts.commands).toBe(1);
  });
});

describe("waiting", () => {
  it("waits on a child whose queue holds a failed message beside a pending one", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", queuedWork: "failed" })];
    h.side("c").queued = [
      { id: "q1", sendAt: null, createdAt: T0, failed: true, system: false, content: [] },
      { id: "q2", sendAt: null, createdAt: T0, failed: false, system: false, content: [] },
    ];
    h.transcript("p", T0, 200_000);
    expect((await h.engine.viewOf("p"))?.waiting).toBe(true);
    expect((await h.engine.viewOf("c"))?.counts.queued).toBe(1);
  });
});
