import { describe, expect, it } from "vitest";
import { crossingKey } from "../../src/core/budget";
import { EMPTY_CURSOR } from "../../src/core/ledger";
import { PriceBook } from "../../src/core/pricing";
import { costTotal, threadUsage } from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import { gatewayRow, logEntry, MIN, T0, tokens, turnRecord } from "../core/fixtures";
import { memoryStore, TEST_SNAPSHOT } from "./harness";

describe("gateway rows", () => {
  it("upserts by request id and never lowers spend", () => {
    const store = memoryStore();
    const row = gatewayRow({ requestId: "r1", startTime: T0, spend: 0.5, threadId: "thr_a" });
    expect([...store.upsertGatewayRows([row])]).toEqual(["thr_a"]);
    expect(store.upsertGatewayRows([{ ...row, spend: 0.3 }]).size).toBe(0);
    expect(store.getGatewayRows("thr_a")[0]!.spend).toBe(0.5);
    store.upsertGatewayRows([{ ...row, spend: 0.7, completionTokens: 999 }]);
    expect(store.getGatewayRows("thr_a")).toEqual([{ ...row, spend: 0.7, completionTokens: 999 }]);
    expect(store.threadHasGatewayRows("thr_a")).toBe(true);
    expect(store.threadHasGatewayRows("thr_b")).toBe(false);
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
  it("records a crossing once per family and amount, and the toast is claimed once", () => {
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
  it("collapseBefore folds old turns and rows into one per thread and keeps the totals", () => {
    const store = memoryStore();
    const prices = new PriceBook({ snapshot: TEST_SNAPSHOT });
    const day = 86_400_000;
    const old1 = turnRecord({ turnId: "o1", startedAt: T0, completedAt: T0 + MIN, model: "test-model", tokens: tokens({ input: 1000, output: 10 }), linesAdded: 3 });
    const old2 = turnRecord({ turnId: "o2", startedAt: T0 + day, completedAt: T0 + day + MIN, model: "test-model", tokens: tokens({ input: 2000, output: 20 }), linesRemoved: 1 });
    const fresh = turnRecord({ turnId: "n1", startedAt: T0 + 400 * day, completedAt: T0 + 400 * day + MIN, model: "test-model", tokens: tokens({ input: 5, output: 5 }) });
    store.putTurns("thr_a", [old1, old2, fresh]);
    store.upsertGatewayRows([
      gatewayRow({ threadId: "thr_a", requestId: "g1", startTime: T0 + 1000, spend: 0.25, durationMs: 100 }),
      gatewayRow({ threadId: "thr_a", requestId: "g2", startTime: T0 + day + 1000, spend: 0.5, durationMs: 200 }),
      gatewayRow({ threadId: "thr_a", requestId: "g3", startTime: T0 + 400 * day + 1000, spend: 1 }),
    ]);
    const figure = () =>
      threadUsage({
        turns: store.getTurns("thr_a"),
        rows: store.getGatewayRows("thr_a"),
        logs: { history: [], gapFill: [], subagent: [], costOnly: [] },
        prices,
        billing: "gateway",
        now: T0 + 500 * day,
      }).figure;
    const before = figure();
    const cutoff = T0 + 365 * day;
    expect(store.collapseBefore(cutoff)).toBe(1);
    expect(store.getTurns("thr_a").map((t) => t.turnId).sort()).toEqual(["n1", "retained"]);
    expect(store.getGatewayRows("thr_a").map((r) => r.requestId).sort()).toEqual(["g3", "retained:thr_a"]);
    const after = figure();
    expect(costTotal(after.cost)).toBeCloseTo(costTotal(before.cost), 10);
    expect(totalTokens(after.tokens)).toBe(totalTokens(before.tokens));
    expect(after.linesAdded).toBe(before.linesAdded);
    expect(after.linesRemoved).toBe(before.linesRemoved);
    expect(after.wallMs).toBe(before.wallMs);
    expect(after.apiMs).toBe(before.apiMs);

    // A later collapse merges into the retained record without losing anything.
    const old3 = turnRecord({ turnId: "o3", startedAt: T0 + 2 * day, completedAt: T0 + 2 * day + MIN, model: "test-model", tokens: tokens({ input: 7 }) });
    store.putTurns("thr_a", [old3]);
    store.collapseBefore(cutoff);
    expect(store.getTurns("thr_a").map((t) => t.turnId).sort()).toEqual(["n1", "retained"]);
    expect(totalTokens(figure().tokens)).toBe(totalTokens(before.tokens) + 7);
    expect(costTotal(figure().cost)).toBeCloseTo(costTotal(before.cost), 10);
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
