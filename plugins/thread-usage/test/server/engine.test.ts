import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../src/host/contract";
import type { LedgerEvent } from "../../src/core/ledger";
import { costTotal } from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import { CATCH_UP_DELAY_MS, Engine, EVENTS_PAGE, REFRESH_CONCURRENCY, type EngineDeps, type ThreadDto } from "../../src/server/engine";
import { startFakeLiteLlm, type FakeLiteLlm } from "../fake-litellm.mjs";
import {
  claudeBreakdown as cb,
  accepted,
  completed,
  identity,
  requested,
  MIN,
  SEC,
  started,
  T0,
  tokens,
  turnRecord,
  usage,
} from "../core/fixtures";
import { harness, type Harness } from "./harness";

interface Rig extends Harness {
  engine: Engine;
  events: Map<string, LedgerEvent[]>;
  listCalls: { threadId: string; afterSeq: number }[];
  unreadable: Set<string>;
  logs: { fail: boolean; entries: LogEntry[]; gate: Promise<void> | null };
  published: unknown[];
  /** What `listThreads` returns (discovery). */
  listed: ThreadDto[];
  /** When set, the next `listEvents` for this thread waits for `release()`. */
  hold: { threadId: string | null; release: () => void; reached: Promise<void> };
}

function rig(raw: Record<string, unknown> = {}): Rig {
  const h = harness(raw, T0 + 60 * MIN);
  const events = new Map<string, LedgerEvent[]>();
  const listCalls: Rig["listCalls"] = [];
  const unreadable = new Set<string>();
  const logs: Rig["logs"] = { fail: false, entries: [], gate: null };
  const published: unknown[] = [];
  const listed: ThreadDto[] = [];
  const hold: Rig["hold"] = { threadId: null, release: () => {}, reached: Promise.resolve() };
  const deps: EngineDeps = {
    store: h.store,
    model: h.model,
    settings: () => h.settings.current,
    now: () => h.clock.now,
    async listEvents({ threadId, afterSeq, types, limit }) {
      listCalls.push({ threadId, afterSeq });
      if (hold.threadId === threadId) {
        hold.threadId = null;
        const snapshot = (events.get(threadId) ?? []).filter((e) => e.seq > afterSeq && types.includes(e.type)).slice(0, limit);
        await new Promise<void>((resolve) => {
          hold.release = resolve;
          (hold as { signal?: () => void }).signal?.();
        });
        return snapshot;
      }
      if (unreadable.has(threadId)) throw new Error("thread is deleted");
      return (events.get(threadId) ?? [])
        .filter((e) => e.seq > afterSeq && types.includes(e.type))
        .slice(0, limit);
    },
    getThread: async () => null,
    listThreads: async (offset, limit) => listed.slice(offset, offset + limit),
    hostIdForEnvironment: async () => "host-1",
    hostName: async () => "workstation",
    async readLogs(_host, input) {
      if (logs.gate !== null) await logs.gate;
      if (logs.fail) throw new Error("host offline");
      const entries = logs.entries.filter(
        (e) => (input.sinceMs === null || e.ts >= input.sinceMs) && (input.untilMs === null || e.ts < input.untilMs),
      );
      return { entries, nextOffset: null, sessionsFound: input.sessionIds };
    },
    fetch,
    publish: (channel, payload) => published.push({ channel, payload }),
    log: { info() {}, warn() {}, error() {} },
  };
  return { ...h, engine: new Engine(deps), events, listCalls, unreadable, logs, published, listed, hold };
}

/** Five events per turn (sequence numbers step by 5) with one usage event of `input` tokens; bb's total runs on. */
function turns(startSeq: number, count: number, at: number, input: number, runningTotal = { value: 0 }): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i * 5;
    const id = `turn-${seq}`;
    const t = at + i * MIN;
    runningTotal.value += input;
    out.push(
      requested(seq, t, `req-${id}`, "test-model"),
      accepted(seq + 1, t, id, `req-${id}`),
      started(seq + 2, t, id),
      usage(seq + 3, t + SEC, id, cb({ input, output: 0 }), cb({ input: runningTotal.value, output: 0 })),
      completed(seq + 4, t + 2 * SEC, id),
    );
  }
  return out;
}

const threadTokens = (r: Rig, threadId: string) =>
  r.store.getTurns(threadId).reduce((n, t) => n + totalTokens(t.tokens), 0);

describe("catch-up", () => {
  it("reads every page (bb caps pages at 100) and folds them into the ledger", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_a", providerId: "claude-code" }, T0);
    const evs = [identity(1, T0, "sess-a"), ...turns(2, 150, T0, 10)];
    r.events.set("thr_a", evs);
    await r.engine.catchUp("thr_a");
    const pages = Math.ceil((evs.length + 1) / EVENTS_PAGE);
    expect(r.listCalls.map((c) => c.afterSeq)).toEqual(
      Array.from({ length: pages }, (_, i) => (i === 0 ? 0 : evs[i * EVENTS_PAGE - 1]!.seq)),
    );
    expect(r.store.countTurns("thr_a")).toBe(150);
    expect(threadTokens(r, "thr_a")).toBe(1500);
    expect(r.store.getThread("thr_a")!.cursor.lastSeq).toBe(evs.at(-1)!.seq);
    expect(r.published).toContainEqual({ channel: "usage-changed", payload: { threadIds: ["thr_a"] } });
    // Nothing new: no second fold.
    await r.engine.catchUp("thr_a");
    expect(threadTokens(r, "thr_a")).toBe(1500);
  });

  it("queues a harness-log job for a partial gap", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_a", providerId: "claude-code", createdAt: T0 }, T0);
    const total = { value: 0 };
    r.events.set("thr_a", [identity(1, T0, "sess-a"), ...turns(2, 1, T0, 100, total)]);
    r.clock.now = T0 + 5 * MIN;
    await r.engine.catchUp("thr_a");
    // While the plugin was down: turn-10's usage was pruned, and the harness restarted.
    r.events.get("thr_a")!.push(
      started(10, T0 + 10 * MIN, "turn-10"),
      completed(100, T0 + 11 * MIN, "turn-10"),
      identity(150, T0 + 12 * MIN, "sess-b"),
      ...turns(300, 1, T0 + 13 * MIN, 5, { value: 0 }),
    );
    r.clock.now = T0 + 30 * MIN;
    await r.engine.catchUp("thr_a", 400);
    const state = r.store.getThread("thr_a")!;
    expect(state.gaps).toEqual([{ fromMs: T0 + 10 * MIN, toMs: T0 + 11 * MIN, resolution: "partial" }]);
    expect(r.store.nextJobs(5)).toEqual([expect.objectContaining({ threadId: "thr_a", kind: "logs", fromMs: T0 + 10 * MIN, toMs: T0 + 11 * MIN })]);
  });
});

describe("children of a deleted thread (scenario 12)", () => {
  it("keeps them under the deleted thread when bb detaches them", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_p", parentThreadId: null }, T0);
    r.store.upsertEdge({ threadId: "thr_d", parentThreadId: "thr_p", deletedAt: T0 + MIN }, T0);
    r.store.upsertEdge({ threadId: "thr_c", parentThreadId: "thr_d" }, T0);
    r.engine.recordThread({ id: "thr_c", parentThreadId: null });
    expect(r.store.getEdge("thr_c")!.parentThreadId).toBe("thr_d");
    // A move to a live parent is still a move (scenario 13).
    r.engine.recordThread({ id: "thr_c", parentThreadId: "thr_p" });
    expect(r.store.getEdge("thr_c")!.parentThreadId).toBe("thr_p");
  });
});

describe("forks (scenario 11)", () => {
  it("skips the source's events copied into a fork, which keep their original times", async () => {
    const r = rig();
    const forkAt = T0 + 10 * MIN;
    r.store.upsertEdge({ threadId: "thr_f", providerId: "claude-code", sourceThreadId: "thr_src", createdAt: forkAt }, T0);
    // Copied history: two turns whose usage events were not copied.
    const copied = turns(1, 2, T0, 50).filter((e) => e.type !== "thread/tokenUsage/updated");
    r.events.set("thr_f", [...copied, identity(20, forkAt + SEC, "sess-f"), ...turns(21, 1, forkAt + 2 * SEC, 7)]);
    r.clock.now = forkAt + MIN;
    await r.engine.catchUp("thr_f");
    const records = r.store.getTurns("thr_f");
    expect(records.map((t) => t.turnId)).toEqual(["turn-21"]);
    expect(threadTokens(r, "thr_f")).toBe(7);
  });
});

describe("history backfill and offline machines (scenarios 8, 9)", () => {
  const setup = () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_h", providerId: "claude-code", environmentId: "env_1", createdAt: T0 - 60 * MIN }, T0);
    // First sight with pruned history: turn-a lost its usage; turn-b's snapshot survived.
    r.events.set("thr_h", [
      identity(1, T0 - 50 * MIN, "sess-a"),
      started(2, T0 - 50 * MIN, "turn-a"),
      completed(3, T0 - 49 * MIN, "turn-a"),
      started(300, T0 - 20 * MIN, "turn-b"),
      usage(301, T0 - 20 * MIN, "turn-b", cb({ input: 10, output: 1 }), cb({ input: 900, output: 90 })),
      completed(302, T0 - 19 * MIN, "turn-b"),
    ]);
    r.clock.now = T0;
    r.logs.entries = [
      { key: "a", sessionId: "sess-a", agentId: null, ts: T0 - 50 * MIN, model: "test-model", tokens: tokens({ input: 700, output: 80 }), costUsd: null },
      { key: "b", sessionId: "sess-a", agentId: null, ts: T0 - 20 * MIN, model: "test-model", tokens: tokens({ input: 10, output: 1 }), costUsd: null },
    ];
    return r;
  };

  it("queues a history job on first sight, and the backfill replaces the opening balance", async () => {
    const r = setup();
    await r.engine.catchUp("thr_h");
    expect(r.store.nextJobs(5)).toEqual([expect.objectContaining({ kind: "logs", fromMs: null, toMs: T0 })]);
    let report = r.model.report("thr_h");
    expect(report.quality.map((q) => q.id)).toContain("partial-history");
    expect(report.thread.figure.partial).toBe(true);

    r.clock.now = T0 + MIN;
    expect(await r.engine.runBackfill()).toBe(1);
    report = r.model.report("thr_h");
    expect(report.turns.some((t) => t.kind === "opening")).toBe(false);
    expect(report.quality.map((q) => q.id)).not.toContain("partial-history");
    expect(report.quality.map((q) => q.id)).not.toContain("partial-gap");
    expect(report.thread.figure.partial).toBe(false);
    expect(totalTokens(report.thread.figure.tokens)).toBe(791);
  });

  it("marks logs missing with the machine name, and fills in once the machine is back", async () => {
    const r = setup();
    await r.engine.catchUp("thr_h");
    r.logs.fail = true;
    r.clock.now = T0 + MIN;
    await r.engine.runBackfill();
    expect(r.store.queueCounts().failed).toBe(1);
    const note = r.model.report("thr_h").quality.find((q) => q.id === "logs-missing")!;
    expect(note.text).toMatch(/Logs on workstation unavailable since/);

    r.logs.fail = false;
    r.store.enqueue({ threadId: "thr_h", kind: "logs", fromMs: null, toMs: T0, priority: 0 }, T0 + 2 * MIN);
    await r.engine.runBackfill();
    const report = r.model.report("thr_h");
    expect(report.quality.find((q) => q.id === "logs-missing")).toBeUndefined();
    expect(report.turns.some((t) => t.kind === "opening")).toBe(false);
    expect(report.firstSeenAt).not.toBeNull();
  });
});

describe("deletion (scenario 12)", () => {
  it("keeps a deleted thread's ledger and leaves the parent's family total unchanged", async () => {
    const r = rig();
    r.clock.now = T0 + 60 * MIN;
    for (const [id, parent] of [["parent", null], ["child", "parent"], ["grandchild", "child"]] as const) {
      r.store.upsertEdge({ threadId: id, parentThreadId: parent, providerId: "claude-code" }, T0);
      r.events.set(id, [...turns(1, 1, T0, 1_000_000)]);
      await r.engine.catchUp(id);
    }
    const before = r.model.report("parent").family.figure;
    expect(costTotal(before.cost)).toBeCloseTo(3, 10);
    r.unreadable.add("child");
    await r.engine.onDeleted({ id: "child", parentThreadId: "parent", deletedAt: T0 + 61 * MIN });
    expect(r.store.getEdge("child")!.deletedAt).toBe(T0 + 61 * MIN);
    expect(r.store.countTurns("child")).toBe(1);
    const after = r.model.report("parent");
    expect(costTotal(after.family.figure.cost)).toBeCloseTo(3, 10);
    expect(after.tree.find((row) => row.threadId === "grandchild")!.parentThreadId).toBe("child");
  });
});

describe("gateway sweep", () => {
  let fake: FakeLiteLlm | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  const gatewayRig = async (key = "sk-read", warnAbove = 0) => {
    fake = await startFakeLiteLlm({ key: "sk-read" });
    const r = rig({ adapter: "litellm", gatewayUrl: fake.url, readKey: key, warnAbove });
    r.store.upsertEdge({ threadId: "thr_gw", providerId: "claude-code", status: "idle" }, T0);
    r.events.set("thr_gw", turns(1, 1, T0, 1000));
    await r.engine.catchUp("thr_gw");
    fake.setRows([
      { request_id: "g1", session_id: "bb-thr_gw", startTime: new Date(T0 + SEC).toISOString(), spend: 0.1, request_duration_ms: 900 },
      // A row for a thread this server does not know is not stored.
      { request_id: "g-other", session_id: "bb-thr_unknown", startTime: new Date(T0 + SEC).toISOString(), spend: 5 },
    ]);
    return r;
  };

  it("stores rows for known threads only; the thread becomes tagged with gateway cost", async () => {
    const r = await gatewayRig();
    await r.engine.sweep();
    expect(r.store.getGatewayRows("thr_gw").map((x) => x.requestId)).toEqual(["g1"]);
    expect(r.store.getGatewayRows("thr_unknown")).toEqual([]);
    const report = r.model.report("thr_gw");
    expect(report.state).toBe("tagged");
    expect(report.thread.figure.cost.gateway).toBeCloseTo(0.1, 10);
    expect(r.store.getMeta("gatewayBanner")).toBeNull();
  });

  it("scenario 20: a failed sweep sets the banner and keeps stored gateway figures; new turns are estimated", async () => {
    const r = await gatewayRig();
    await r.engine.sweep();
    fake!.setMode("down");
    r.clock.now += MIN;
    await r.engine.sweep();
    expect(r.store.getMeta("gatewayBanner")).toMatchObject({ check: "reachable" });
    r.events.get("thr_gw")!.push(...turns(10, 1, T0 + 30 * MIN, 1_000_000));
    await r.engine.catchUp("thr_gw");
    const report = r.model.report("thr_gw");
    expect(report.state).toBe("tagged");
    expect(report.gatewayBanner).toMatchObject({ check: "reachable" });
    expect(report.thread.figure.cost.gateway).toBeCloseTo(0.1, 10);
    expect(report.thread.figure.cost.estimate).toBeCloseTo(1, 10);
    // The banner clears on the next good sweep.
    fake!.setMode("ok");
    await r.engine.sweep();
    expect(r.store.getMeta("gatewayBanner")).toBeNull();
  });

  it("scenario 20: a rotated read key takes effect on the next sweep without a reload", async () => {
    const r = await gatewayRig("sk-old");
    await r.engine.sweep();
    expect(r.store.getMeta("gatewayBanner")).toMatchObject({ check: "key-valid" });
    expect(r.store.getGatewayRows("thr_gw")).toEqual([]);
    r.settings.current = { ...r.settings.current, readKey: "sk-read" };
    await r.engine.sweep();
    expect(r.store.getMeta("gatewayBanner")).toBeNull();
    expect(r.store.getGatewayRows("thr_gw")).toHaveLength(1);
  });

  it("records a budget crossing once", async () => {
    const r = await gatewayRig("sk-read", 0.05);
    await r.engine.sweep();
    expect([...r.store.crossingKeys()]).toEqual(["thr_gw@0.05"]);
    // A crossing names no thread, so every chip (the crossed family's included) refetches.
    expect(r.published.at(-1)).toEqual({ channel: "usage-changed", payload: { threadIds: [] } });
    fake!.addRow({ request_id: "g2", session_id: "bb-thr_gw", startTime: new Date(T0 + 2 * SEC).toISOString(), spend: 0.2 });
    await r.engine.sweep();
    expect([...r.store.crossingKeys()]).toEqual(["thr_gw@0.05"]);
    expect(r.store.crossingFor("thr_gw", 0.05)!.total).toBeCloseTo(0.1, 10);
    expect(r.model.chip("thr_gw").toast).not.toBeNull();
  });

  it("counts a family already over Warn above when the amount is set", async () => {
    const r = await gatewayRig("sk-read", 0);
    await r.engine.sweep();
    expect([...r.store.crossingKeys()]).toEqual([]);
    r.settings.current = { ...r.settings.current, warnAbove: 0.05 };
    r.engine.checkAllBudgets();
    expect([...r.store.crossingKeys()]).toEqual(["thr_gw@0.05"]);
    // Found by sweeping history: the chip tints, but no toast fires.
    const chip = r.model.chip("thr_gw");
    expect(chip.attention).toBe(true);
    expect(chip.toast).toBeNull();
  });
});

function turnRecordFor(threadId: string) {
  return turnRecord({ turnId: `${threadId}-t`, startedAt: T0, completedAt: T0 + SEC, model: "test-model" });
}

/** Holds the next events read of `threadId`; resolves once the read is waiting. */
function holdNextRead(r: Rig, threadId: string): Promise<void> {
  r.hold.threadId = threadId;
  return new Promise<void>((resolve) => {
    (r.hold as { signal?: () => void }).signal = resolve;
  });
}

describe("ledger rebuild against live catch-ups", () => {
  it("a catch-up that read the old cursor cannot write it back over a rebuild (400, not 100)", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_r", providerId: "claude-code", createdAt: T0 }, T0);
    r.listed.push({ id: "thr_r", providerId: "claude-code", createdAt: T0 });
    const total = { value: 0 };
    r.events.set("thr_r", [identity(1, T0, "sess"), ...turns(2, 3, T0, 100, total)]);
    await r.engine.catchUp("thr_r");
    expect(threadTokens(r, "thr_r")).toBe(300);

    // A fourth turn arrives; its live catch-up has read the old cursor and waits in listEvents.
    r.events.get("thr_r")!.push(...turns(20, 1, T0 + 10 * MIN, 100, total));
    const waiting = holdNextRead(r, "thr_r");
    const live = r.engine.catchUp("thr_r");
    await waiting;

    // Meanwhile a version bump rebuilds the ledgers.
    const listed = await r.engine.discover();
    const rebuild = r.engine.rebuildLedgers(listed);
    r.hold.release();
    await live;
    await rebuild;
    while ((await r.engine.runBackfill(4)) > 0) {
      // drain the queue
    }
    expect(threadTokens(r, "thr_r")).toBe(400);
  });
});

describe("children of a parent deleted while the plugin was stopped", () => {
  it("stay under it: discovery stamps the unlisted parent deleted before recording the detached child", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_root" }, T0);
    r.store.upsertEdge({ threadId: "thr_gone", parentThreadId: "thr_root" }, T0);
    r.store.upsertEdge({ threadId: "thr_kid", parentThreadId: "thr_gone" }, T0);
    r.listed.push({ id: "thr_root", parentThreadId: null }, { id: "thr_kid", parentThreadId: null });
    for (const id of ["thr_root", "thr_gone", "thr_kid"]) {
      r.store.putTurns(id, [{ ...turnRecordFor(id), tokens: tokens({ input: 100 }) }]);
    }
    await r.engine.discover();
    expect(r.store.getEdge("thr_gone")!.deletedAt).not.toBeNull();
    expect(r.store.getEdge("thr_kid")!.parentThreadId).toBe("thr_gone");
    // The family total still counts all three threads.
    expect(r.model.report("thr_root").family.figure.tokens.input).toBe(300);
  });

  it("does not mark threads deleted when the listing comes back empty", async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) r.store.upsertEdge({ threadId: `thr_${i}` }, T0);
    await r.engine.discover();
    expect(r.store.allEdges().every((e) => e.deletedAt === null)).toBe(true);
  });

  it("clears a mistaken deleted mark when bb serves the thread again", () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_x", deletedAt: T0 }, T0);
    r.engine.recordThread({ id: "thr_x", deletedAt: null });
    expect(r.store.getEdge("thr_x")!.deletedAt).toBeNull();
  });
});

describe("ledger rebuild against a harness-log read", () => {
  it("a log read that started before the rebuild does not write the old cursor back (300, not 0)", async () => {
    const r = rig({ readLogs: true });
    r.store.upsertEdge({ threadId: "thr_l", providerId: "claude-code", createdAt: T0, hostId: "host-1" }, T0);
    r.listed.push({ id: "thr_l", providerId: "claude-code", createdAt: T0 });
    r.events.set("thr_l", [identity(1, T0, "sess-l"), ...turns(2, 3, T0, 100)]);
    await r.engine.catchUp("thr_l");
    expect(threadTokens(r, "thr_l")).toBe(300);

    let open!: () => void;
    r.logs.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const read = r.engine.readThreadLogs("thr_l", { timeoutMs: 1000 });
    await Promise.resolve();
    await r.engine.rebuildLedgers(await r.engine.discover());
    open();
    await read;
    while ((await r.engine.runBackfill(4)) > 0) {
      // drain the queue
    }
    expect(threadTokens(r, "thr_l")).toBe(300);
  });
});

describe("catch-up cadence for busy threads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gathers a busy thread's notifications into one events read per interval", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_b", providerId: "claude-code" }, T0);
    const total = { value: 0 };
    r.events.set("thr_b", [identity(1, T0, "sess-b"), ...turns(2, 2, T0, 100, total)]);
    for (let seq = 2; seq <= 11; seq++) r.engine.catchUpSoon("thr_b", seq);
    expect(r.listCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(CATCH_UP_DELAY_MS);
    expect(r.listCalls).toHaveLength(1);
    expect(threadTokens(r, "thr_b")).toBe(200);
    // The same notifications again: already read, so nothing is scheduled.
    for (let seq = 2; seq <= 11; seq++) r.engine.catchUpSoon("thr_b", seq);
    await vi.advanceTimersByTimeAsync(CATCH_UP_DELAY_MS * 2);
    expect(r.listCalls).toHaveLength(1);
    // A new event is read on the next interval.
    r.events.get("thr_b")!.push(...turns(12, 1, T0 + 5 * MIN, 100, total));
    r.engine.catchUpSoon("thr_b", 16);
    await vi.advanceTimersByTimeAsync(CATCH_UP_DELAY_MS);
    expect(r.listCalls).toHaveLength(2);
    expect(threadTokens(r, "thr_b")).toBe(300);
  });

  it("an idle catch-up runs at once and takes over the gathering one", async () => {
    vi.useFakeTimers();
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_i", providerId: "claude-code" }, T0);
    r.events.set("thr_i", [identity(1, T0, "sess-i"), ...turns(2, 1, T0, 100)]);
    r.engine.catchUpSoon("thr_i", 6);
    await r.engine.catchUp("thr_i");
    expect(r.listCalls).toHaveLength(1);
    expect(threadTokens(r, "thr_i")).toBe(100);
    await vi.advanceTimersByTimeAsync(CATCH_UP_DELAY_MS * 2);
    expect(r.listCalls).toHaveLength(1);
  });

  it("calls made while a catch-up waits its turn join it: one read, every event folded", async () => {
    const r = rig();
    r.store.upsertEdge({ threadId: "thr_q", providerId: "claude-code" }, T0);
    const total = { value: 0 };
    r.events.set("thr_q", [identity(1, T0, "sess-q"), ...turns(2, 1, T0, 100, total)]);
    const waiting = holdNextRead(r, "thr_q");
    const first = r.engine.catchUp("thr_q");
    await waiting;
    // Two more turns arrive while the first read is out; five notifications follow.
    r.events.get("thr_q")!.push(...turns(7, 2, T0 + 5 * MIN, 100, total));
    const joined = [7, 8, 9, 10, 16].map((seq) => r.engine.catchUp("thr_q", seq));
    r.hold.release();
    await Promise.all([first, ...joined]);
    expect(r.listCalls).toHaveLength(2);
    expect(threadTokens(r, "thr_q")).toBe(300);
    expect(r.store.getThread("thr_q")!.cursor.lastSeq).toBe(16);
  });

  it("an unchanged thread DTO writes nothing and keeps the cached figures", () => {
    const r = rig();
    const dto: ThreadDto = { id: "thr_u", providerId: "claude-code", title: "Busy", status: "active", createdAt: T0 };
    r.engine.recordThread(dto);
    const upsert = vi.spyOn(r.store, "upsertEdge");
    const invalidate = vi.spyOn(r.model, "invalidate");
    for (let i = 0; i < 5; i++) r.engine.recordThread({ ...dto });
    expect(upsert).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    r.engine.recordThread({ ...dto, title: "Renamed" });
    expect(r.store.getEdge("thr_u")!.title).toBe("Renamed");
    expect(invalidate).toHaveBeenCalledWith(["thr_u"]);
  });
});

describe("refresh on opening the Usage tab", () => {
  it("reads logs only where they are missing or older than the thread's activity, a few threads at a time", async () => {
    const r = rig({ readLogs: true });
    const ids = Array.from({ length: 12 }, (_, i) => `thr_f${i}`);
    for (const [i, id] of ids.entries()) {
      r.store.upsertEdge({ threadId: id, providerId: "claude-code", hostId: "host-1", parentThreadId: i === 0 ? null : ids[0]! }, T0);
      r.events.set(id, [identity(1, T0, `sess-${id}`), ...turns(2, 1, T0, 100)]);
      await r.engine.catchUp(id);
    }
    // Every thread's logs were read after its last activity...
    for (const id of ids) await r.engine.readThreadLogs(id, { timeoutMs: 1000 });
    // ...except these: one has new activity since, one lost its machine.
    const active = r.store.getThread(ids[3]!)!;
    r.store.putThread({ ...active, lastActivityAt: active.logsReadThrough! + 1 }, T0);
    const offline = r.store.getThread(ids[7]!)!;
    r.store.putThread({ ...offline, logsMissingSince: T0, logsMissingHost: "workstation" }, T0);

    let inFlight = 0;
    let most = 0;
    const read: string[] = [];
    const spy = vi.spyOn(r.engine, "readThreadLogs").mockImplementation(async (id) => {
      read.push(id);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return "ok";
    });
    await r.engine.refresh(ids);
    expect(read.sort()).toEqual([ids[3]!, ids[7]!].sort());
    spy.mockRestore();

    // A family of stale threads is read at most REFRESH_CONCURRENCY at a time.
    for (const id of ids) {
      const s = r.store.getThread(id)!;
      r.store.putThread({ ...s, logsReadThrough: null }, T0);
    }
    most = 0;
    read.length = 0;
    vi.spyOn(r.engine, "readThreadLogs").mockImplementation(async (id) => {
      read.push(id);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return "ok";
    });
    await r.engine.refresh(ids);
    expect(read).toHaveLength(12);
    expect(most).toBe(REFRESH_CONCURRENCY);
  });
});

describe("after a reload", () => {
  it("catches up a thread stored as running, and reads its logs when it went idle unseen", async () => {
    const r = rig({ readLogs: true });
    r.store.upsertEdge({ threadId: "thr_z", providerId: "claude-code", hostId: "host-1", status: "active" }, T0);
    const total = { value: 0 };
    r.events.set("thr_z", [identity(1, T0, "sess-z"), ...turns(2, 1, T0, 100, total)]);
    await r.engine.catchUp("thr_z");
    // The last turn's events arrived while the plugin was down, and so did its idle.
    r.events.get("thr_z")!.push(...turns(7, 1, T0 + 5 * MIN, 100, total));
    r.engine.recordThread({ id: "thr_z", status: "idle" });
    const reads = vi.spyOn(r.engine, "readThreadLogs");
    await r.engine.resumeInterrupted(["thr_z"]);
    expect(threadTokens(r, "thr_z")).toBe(200);
    expect(reads).toHaveBeenCalledWith("thr_z", expect.anything());
  });
});

describe("change signals from thread DTOs", () => {
  it("a hidden or renamed thread signals itself and its ancestors; a status change alone does not", () => {
    const r = rig();
    r.engine.recordThread({ id: "thr_p", title: "Parent", status: "idle" });
    r.engine.recordThread({ id: "thr_c", parentThreadId: "thr_p", title: "Child", status: "idle", visibility: "visible" });
    r.published.length = 0;
    r.engine.recordThread({ id: "thr_c", parentThreadId: "thr_p", title: "Child", status: "active", visibility: "visible" });
    expect(r.published).toEqual([]);
    r.engine.recordThread({ id: "thr_c", parentThreadId: "thr_p", title: "Child", status: "active", visibility: "hidden" });
    expect(r.published).toEqual([{ channel: "usage-changed", payload: { threadIds: ["thr_c", "thr_p"] } }]);
    r.engine.recordThread({ id: "thr_c", parentThreadId: "thr_p", title: "Renamed", status: "active", visibility: "hidden" });
    expect(r.published).toHaveLength(2);
  });
});
