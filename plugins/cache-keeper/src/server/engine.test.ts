import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { COMPACT_MESSAGE } from "../core/messages";
import { PriceBook } from "../core/pricing";
import { EMPTY_FACTS, type TranscriptFacts } from "../core/transcript";
import { ClaudeOnlyError, Engine, NotReadyError, type EngineDeps, type ListedThread, type TaskEvent } from "./engine";
import { MIGRATIONS, Store } from "./store";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 27, 10, 0);

// Opus 5.5 per token: the 1-hour line at setting 2 is ~139k.
const prices = new PriceBook({
  bundled: {
    "claude-opus-5-5": {
      input_cost_per_token: 5e-6,
      output_cost_per_token: 25e-6,
      cache_read_input_token_cost: 0.5e-6,
      cache_creation_input_token_cost: 6.25e-6,
      cache_creation_input_token_cost_above_1hr: 10e-6,
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
  ...over,
});

class Harness {
  now = T0;
  threads: ListedThread[] = [];
  facts = new Map<string, TranscriptFacts>();
  events = new Map<string, TaskEvent[]>();
  outputs = new Map<string, number>();
  sent: { threadId: string; text: string }[] = [];
  checkIns = true;
  failTasks = false;
  failEvents = false;
  queued = new Map<string, { sendAt: number | null; createdAt: number; failed: boolean }[]>();
  db = new Database(":memory:");
  store: Store;
  engine: Engine;

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
      listThreads: async () => this.threads,
      queuedMessages: async (id) => this.queued.get(id) ?? [],
      contextWindow: async () => 1_000_000,
      sessionId: async (id) => `session-${id}`,
      taskEvents: async (id, after) => {
        if (this.failEvents) throw new Error("HTTP 400: Thread event limit cannot exceed 100");
        return (this.events.get(id) ?? []).filter((e) => e.seq > after);
      },
      transcript: async (_host, session) => ({
        found: true,
        cwdSlug: "-work",
        facts: this.facts.get(session.replace("session-", "")) ?? EMPTY_FACTS,
        requests: [],
      }),
      tasks: async (_host, input) => {
        if (this.failTasks) throw new Error("machine offline");
        return {
        commands: input.commands.map((id) => ({ id, outputFile: `/tmp/claude-1000/-work/${input.sessionId}/tasks/${id}.output`, changedAt: this.outputs.get(id) ?? null })),
        subagents: input.subagents.map((id) => ({ id, lastTool: "Grep", changedAt: null })),
        };
      },
      send: async (threadId, text) => {
        this.sent.push({ threadId, text });
      },
      publish: () => {},
      log: { info: () => {}, warn: () => {} },
    };
    return new Engine(deps);
  }

  /** A transcript whose last request ran at `at` on a 1-hour cache with `context` tokens. */
  transcript(id: string, at: number, context: number, over: Partial<TranscriptFacts> = {}) {
    this.facts.set(id, { ...EMPTY_FACTS, lastRequestAt: at, lifetime: "1h", context, model: "claude-opus-5-5", requests: 30, userMessages: 10, ...over });
  }
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
    expect(h.sent).toEqual([{ threadId: "t1", text: COMPACT_MESSAGE }]);

    // The compaction's own turn stays inside the stretch, and nothing more is sent in it.
    h.engine.onActive("t1");
    await h.engine.onIdle("t1");
    h.transcript("t1", T0 + 59 * MIN, 300_000, { lastCompaction: { at: T0 + 59 * MIN, preTokens: 300_000, postTokens: 10_000 } });
    h.now = T0 + 118 * MIN + 30_000;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
  });

  it("does nothing on a thread under its line, switched off, or waiting", async () => {
    h.threads = [thread({ id: "under" }), thread({ id: "off" }), thread({ id: "busy", activity: { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 } })];
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

  it("does not send a compaction whose deadline passed while the server was down", async () => {
    h.threads = [thread({ id: "t1" })];
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);
    // A restart: a new engine over the same store, after the deadline.
    h.engine = h.build();
    h.now = T0 + 61 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    // Switched on survives the restart.
    expect((await h.engine.viewOf("t1"))?.compactOn).toBe(true);
  });

  it("acts at the transcript's deadline after a restart", async () => {
    h.threads = [thread({ id: "t1" })];
    h.transcript("t1", T0, 300_000);
    await h.engine.setCompact("t1", true);
    h.engine = h.build();
    h.now = T0 + 59 * MIN + 10_000;
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
    h.transcript("a", T0, 1);
    h.transcript("b", T0, 1);
    h.transcript("c", T0, 1);
    expect((await h.engine.setCompact("a", true))?.setting).toBe(2);
    await h.engine.setSetting("a", 5);
    expect((await h.engine.setCompact("b", true))?.setting).toBe(5);
    await h.engine.setCompact("c", true, 3);
    expect((await h.engine.viewOf("c"))?.setting).toBe(3);
  });

  it("compacts now under the line, but not while waiting", async () => {
    h.threads = [thread({ id: "t1" }), thread({ id: "t2", queuedWork: "waiting" })];
    h.transcript("t1", T0, 20_000);
    h.transcript("t2", T0, 20_000);
    await h.engine.compactNow("t1");
    expect(h.sent.map((s) => s.threadId)).toEqual(["t1"]);
    await expect(h.engine.compactNow("t2")).rejects.toBeInstanceOf(NotReadyError);
  });
});

describe("keep-warms and check-ins", () => {
  const waitingOnChild = () => [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", status: "active", title: "Build the page" })];

  it("keeps a thread waiting on a child warm at its deadline, and skips after Skip", async () => {
    h.threads = waitingOnChild();
    h.transcript("p", T0, 200_000);
    h.now = T0 + 59 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([{ threadId: "p", text: 'Still waiting on child thread c ("Build the page"). There\'s no need to check anything. Reply with exactly "Not finished yet, still waiting on child thread c ("Build the page"). Nothing needed from you."' }]);

    // The keep-warm's turn keeps the stretch; Skip then stops further ones.
    h.engine.onActive("p");
    h.transcript("p", T0 + 59 * MIN, 200_000);
    await h.engine.onIdle("p");
    await h.engine.skip("p", "warm", false);
    h.now = T0 + 118 * MIN;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
  });

  it("sends nothing with the setting off or a pending interaction", async () => {
    h.threads = waitingOnChild();
    h.transcript("p", T0, 200_000);
    h.now = T0 + 59 * MIN;
    h.checkIns = false;
    await h.engine.pass();
    h.checkIns = true;
    h.threads = [{ ...h.threads[0]!, hasPendingInteraction: true }, h.threads[1]!];
    await h.engine.pass();
    expect(h.sent).toEqual([]);
  });

  it("checks in on a background command that stopped printing", async () => {
    h.threads = [thread({ id: "t1", activity: { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 } })];
    h.transcript("t1", T0, 100_000);
    h.events.set("t1", [
      { seq: 5, type: "item/started", createdAt: T0, item: { type: "backgroundTask", familyId: "b1", taskType: "local_bash", description: "npm test", taskStatus: "running" } },
    ]);
    h.outputs.set("b1", T0 + MIN);
    h.now = T0 + 10 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
    h.now = T0 + 16 * MIN;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('Background command b1 ("npm test") hasn\'t printed anything in 15 minutes.');
    expect(h.sent[0]!.text).toContain("/tmp/claude-1000/-work/session-t1/tasks/b1.output");
  });

  it("ends the idle stretch when you send a message after Cache Keeper's own turn started", async () => {
    h.threads = waitingOnChild();
    h.transcript("p", T0, 200_000);
    h.now = T0 + 59 * MIN;
    await h.engine.pass();
    await h.engine.skip("p", "warm", false);
    h.engine.onActive("p");
    expect(h.store.get("p").stretch?.warmSkipped).toBe(true);
    h.engine.onActive("p");
    expect(h.store.get("p").stretch).toBeNull();
  });

  it("holds a check-in back when the machine's files cannot be read", async () => {
    h.threads = [thread({ id: "t1", activity: { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 } })];
    h.transcript("t1", T0, 100_000);
    h.events.set("t1", [
      { seq: 1, type: "item/started", createdAt: T0, item: { type: "backgroundTask", familyId: "b1", taskType: "local_bash", description: "npm test", taskStatus: "running" } },
    ]);
    h.failTasks = true;
    h.now = T0 + 16 * MIN;
    await h.engine.pass();
    expect(h.sent).toEqual([]);
  });

  it("waits on a child whose queue holds a failed message beside a pending one", async () => {
    h.threads = [thread({ id: "p" }), thread({ id: "c", parentThreadId: "p", queuedWork: "failed" })];
    h.queued.set("c", [
      { sendAt: null, createdAt: T0, failed: true },
      { sendAt: null, createdAt: T0, failed: false },
    ]);
    h.transcript("p", T0, 200_000);
    h.now = T0 + 59 * MIN;
    await h.engine.pass();
    expect(h.sent.map((m) => m.threadId)).toEqual(["p"]);
  });

  it("drops a thread's view when a pass fails on it, and still lists it as switched on", async () => {
    h.threads = [thread({ id: "t1", activity: { activeBackgroundCommandCount: 1, activeBackgroundAgentCount: 0 } })];
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

  it("ends the idle stretch on a turn it did not cause, and a new one starts fresh", async () => {
    h.threads = waitingOnChild();
    h.transcript("p", T0, 200_000);
    await h.engine.pass();
    await h.engine.skip("p", "warm", false);
    h.engine.onActive("p");
    await h.engine.onIdle("p");
    h.transcript("p", T0 + 5 * MIN, 200_000);
    h.now = T0 + 64 * MIN;
    await h.engine.pass();
    expect(h.sent).toHaveLength(1);
  });
});
