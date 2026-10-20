import { describe, expect, it } from "vitest";
import { crossingKey } from "../../src/core/budget";
import { EMPTY_CURSOR } from "../../src/core/ledger";
import { PriceBook } from "../../src/core/pricing";
import { costTotal, threadUsage } from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import { MIGRATIONS, Store, type Db } from "../../src/server/store";
import Database from "better-sqlite3";
import { logEntry, MIN, T0, tokens, turnRecord } from "../core/fixtures";
import { memoryStore, TEST_PRICES } from "./harness";

describe("the migration that drops the gateway's rows", () => {
  const dropAt = MIGRATIONS.findIndex((sql) => sql.startsWith("DROP TABLE gateway_requests"));

  it("deletes the stored gateway rows and what the sweep and the old price lists kept, and nothing else", () => {
    expect(dropAt).toBeGreaterThan(0);
    const db = new Database(":memory:");
    // An install as it was before: gateway rows, sweep state, both old lists, an unrelated meta key.
    for (const sql of MIGRATIONS.slice(0, dropAt)) db.exec(sql);
    db.prepare(`INSERT INTO gateway_requests (request_id, thread_id, start_time, spend, row) VALUES ('r1', 'thr_a', 1, 0.5, '{}')`).run();
    for (const key of ["lastSweepAt", "gatewayBanner", "gatewayPrices", "onlinePrices", "modelsDevPrices", "pricesRefreshError", "ledgerVersion", "refreshPricesDefaultOn"]) {
      db.prepare(`INSERT INTO meta (key, value) VALUES (?, '1')`).run(key);
    }
    const before = new Store(db as unknown as Db);
    before.putTurns("thr_a", [turnRecord({ turnId: "t1", startedAt: T0, completedAt: T0 + MIN, tokens: tokens({ input: 700, output: 5 }) })]);
    for (const sql of MIGRATIONS.slice(dropAt)) db.exec(sql);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'gateway_requests'`).all()).toEqual([]);
    expect((db.prepare(`SELECT key FROM meta ORDER BY key`).all() as { key: string }[]).map((r) => r.key)).toEqual(["ledgerVersion", "refreshPricesDefaultOn"]);
    // The tokens bb's events supplied stay.
    expect(totalTokens(new Store(db as unknown as Db).getTurns("thr_a")[0]!.tokens)).toBe(705);
  });
});

describe("log entries", () => {
  it("dedups by key across sessions (a resumed session repeating a request counts once)", () => {
    const store = memoryStore();
    store.upsertLogEntries("thr_a", [
      logEntry({ key: "msg-1:req-1", ts: T0, sessionId: "sess-1" }),
      logEntry({ key: "msg-1:req-1", ts: T0, sessionId: "sess-2" }),
      logEntry({ key: "msg-2:req-2", ts: T0 + 1, sessionId: "sess-2" }),
    ]);
    store.upsertLogEntries("thr_a", [logEntry({ key: "msg-1:req-1", ts: T0, sessionId: "sess-1" })]);
    expect(store.getLogEntries("thr_a").map((e) => e.key)).toEqual(["msg-1:req-1", "msg-2:req-2"]);
  });

  it("keeps the same key in the main session and a subagent apart", () => {
    const store = memoryStore();
    store.upsertLogEntries("thr_a", [
      logEntry({ key: "k", ts: T0 }),
      logEntry({ key: "k", ts: T0, agentId: "agent-1" }),
    ]);
    expect(store.getLogEntries("thr_a")).toHaveLength(2);
  });
});

describe("backfill queue", () => {
  it("serves newest threads first and requeues jobs a stopped plugin left running", () => {
    const store = memoryStore();
    store.enqueue({ threadId: "old", kind: "events", fromMs: null, toMs: null, priority: 1 }, T0);
    store.enqueue({ threadId: "newest", kind: "events", fromMs: null, toMs: null, priority: 3 }, T0);
    store.enqueue({ threadId: "mid", kind: "logs", fromMs: null, toMs: T0, priority: 2 }, T0);
    expect(store.nextJobs(10).map((j) => j.threadId)).toEqual(["newest", "mid", "old"]);
    store.setJobState("newest", "events", "running", null, T0 + 1);
    expect(store.nextJobs(10).map((j) => j.threadId)).toEqual(["mid", "old"]);
    expect(store.queueCounts()).toMatchObject({ queued: 2, running: 1 });
    store.requeueRunning(T0 + 2);
    expect(store.nextJobs(1)[0]).toMatchObject({ threadId: "newest", attempts: 1, state: "queued" });
  });

  it("widens a queued job's window and replaces a done job's window", () => {
    const store = memoryStore();
    store.enqueue({ threadId: "a", kind: "logs", fromMs: 100, toMs: 200, priority: 1 }, T0);
    store.enqueue({ threadId: "a", kind: "logs", fromMs: 50, toMs: 150, priority: 1 }, T0);
    expect(store.nextJobs(1)[0]).toMatchObject({ fromMs: 50, toMs: 200 });
    store.setJobState("a", "logs", "done", null, T0);
    store.enqueue({ threadId: "a", kind: "logs", fromMs: 300, toMs: 400, priority: 1 }, T0);
    expect(store.nextJobs(1)[0]).toMatchObject({ fromMs: 300, toMs: 400, state: "queued" });
  });
});

describe("budget crossings (scenario 17)", () => {
  it("records a crossing once per tree and amount, and the toast is claimed once", () => {
    const store = memoryStore();
    const c = { rootThreadId: "root", amount: 5, crossedAt: T0, totalAtCrossing: 5.2 };
    store.addCrossing(crossingKey("root", 5), c);
    store.addCrossing(crossingKey("root", 5), { ...c, crossedAt: T0 + 1, totalAtCrossing: 9 });
    expect(store.crossingKeys()).toEqual(new Set(["root@5"]));
    expect(store.crossingFor("root", 5)).toEqual({ crossedAt: T0, total: 5.2, toastedAt: null });
    expect(store.pendingToasts(5)).toEqual([{ rootThreadId: "root", total: 5.2 }]);
    expect(store.claimToast("root", 5, T0 + 10)).toBe(true);
    // A reload, or a second window, does not show it again.
    expect(store.claimToast("root", 5, T0 + 20)).toBe(false);
    expect(store.pendingToasts(5)).toEqual([]);
  });
});

describe("thread state", () => {
  it("round-trips cursor, gaps and log status", () => {
    const store = memoryStore();
    const state = {
      threadId: "thr_a",
      cursor: { ...EMPTY_CURSOR, lastSeq: 42, sessionIds: ["s1"], rateLimitKind: "credits" as const },
      firstSeenAt: T0,
      gaps: [{ fromMs: 1, toMs: 2, resolution: "partial" as const }],
      historyBackfilled: true,
      logsReadThrough: null,
      logsMissingHost: "workstation",
      logsMissingSince: T0,
      lastActivityAt: T0,
    };
    store.putThread(state, T0);
    expect(store.getThread("thr_a")).toEqual(state);
    expect(store.threadsWithMissingLogs().map((t) => t.threadId)).toEqual(["thr_a"]);
  });
});

describe("retention", () => {
  it("collapseBefore folds old turns into one per thread and keeps the totals", () => {
    const store = memoryStore();
    const prices = new PriceBook({ models: TEST_PRICES, origin: "snapshot" });
    const day = 86_400_000;
    const old1 = turnRecord({ turnId: "o1", startedAt: T0, completedAt: T0 + MIN, model: "test-model", tokens: tokens({ input: 1000, output: 10 }), linesAdded: 3 });
    const old2 = turnRecord({ turnId: "o2", startedAt: T0 + day, completedAt: T0 + day + MIN, model: "test-model", tokens: tokens({ input: 2000, output: 20 }), linesRemoved: 1 });
    const fresh = turnRecord({ turnId: "n1", startedAt: T0 + 400 * day, completedAt: T0 + 400 * day + MIN, model: "test-model", tokens: tokens({ input: 5, output: 5 }) });
    store.putTurns("thr_a", [old1, old2, fresh]);
    const figure = () =>
      threadUsage({
        turns: store.getTurns("thr_a"),
        logs: { history: [], gapFill: [], subagent: [], cacheWrites: [] },
        prices,
        billing: "api-key",
        now: T0 + 500 * day,
      }).figure;
    const before = figure();
    const cutoff = T0 + 365 * day;
    expect(store.collapseBefore(cutoff)).toBe(1);
    expect(store.getTurns("thr_a").map((t) => t.turnId).sort()).toEqual(["n1", "retained"]);
    const after = figure();
    expect(costTotal(after.cost)).toBeCloseTo(costTotal(before.cost), 10);
    expect(totalTokens(after.tokens)).toBe(totalTokens(before.tokens));
    expect(after.linesAdded).toBe(before.linesAdded);
    expect(after.linesRemoved).toBe(before.linesRemoved);
    expect(after.wallMs).toBe(before.wallMs);

    // A later collapse merges into the retained record without losing anything.
    const old3 = turnRecord({ turnId: "o3", startedAt: T0 + 2 * day, completedAt: T0 + 2 * day + MIN, model: "test-model", tokens: tokens({ input: 7 }) });
    store.putTurns("thr_a", [old3]);
    store.collapseBefore(cutoff);
    expect(store.getTurns("thr_a").map((t) => t.turnId).sort()).toEqual(["n1", "retained"]);
    expect(totalTokens(figure().tokens)).toBe(totalTokens(before.tokens) + 7);
    expect(costTotal(figure().cost)).toBeCloseTo(costTotal(before.cost) + 7 * 1e-6, 10);
  });

  it("collapses requests into a sum: the retained turn keeps no per-request counts", () => {
    const store = memoryStore();
    const day = 86_400_000;
    const requests = [{ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }];
    store.putTurns("thr_a", [turnRecord({ turnId: "o1", startedAt: T0, completedAt: T0 + MIN, tokens: tokens({ input: 10, output: 1 }), requests })]);
    store.collapseBefore(T0 + 365 * day);
    const retained = store.getTurns("thr_a")[0]!;
    expect(retained.turnId).toBe("retained");
    expect(retained.requests).toBeUndefined();
    expect(retained.tokens).toEqual(tokens({ input: 10, output: 1 }));
  });
});

describe("ledger rebuild", () => {
  it("keeps the ledger of a deleted thread, whose events can no longer be read", () => {
    const store = memoryStore();
    store.upsertEdge({ threadId: "thr_live" }, 1);
    store.upsertEdge({ threadId: "thr_gone", deletedAt: 5 }, 1);
    // Deleted while the plugin was stopped: bb no longer lists it, and the edge does not know yet.
    store.upsertEdge({ threadId: "thr_unlisted" }, 1);
    for (const id of ["thr_live", "thr_gone", "thr_unlisted"]) {
      store.putTurns(id, [turnRecord({ turnId: `${id}-t`, startedAt: 1, completedAt: 2, tokens: tokens({ input: 10 }) })]);
    }
    store.resetLedger(new Set(["thr_live", "thr_gone"]));
    expect(store.getTurns("thr_live")).toEqual([]);
    expect(store.getTurns("thr_gone")).toHaveLength(1);
    expect(store.getTurns("thr_unlisted")).toHaveLength(1);
  });
});
