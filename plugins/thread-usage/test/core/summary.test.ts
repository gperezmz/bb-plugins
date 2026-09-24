import { describe, expect, it } from "vitest";
import type { BillingMode } from "../../src/core/attribution";
import { headline, sourceMix } from "../../src/core/format";
import { EMPTY_CURSOR, ingestEvents, type TurnRecord } from "../../src/core/ledger";
import { PriceBook } from "../../src/core/pricing";
import {
  costTotal,
  mergeLogEntries,
  sumFigures,
  threadUsage,
  type LogMergeContext,
  type MergedLogs,
  type StoredLogEntry,
} from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import { PINNED_SNAPSHOT } from "../../src/server/snapshot";
import {
  accepted,
  claudeBreakdown as cb,
  completed,
  ev,
  gatewayRow,
  identity,
  logEntry,
  MIN,
  requested,
  SEC,
  started,
  T0,
  tokens,
  turnRecord,
  usage,
} from "./fixtures";

// Round numbers: $1 per M input, $10 per M output.
const TEST_SNAPSHOT = {
  "test-model": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1e-7,
    cache_creation_input_token_cost: 1.25e-6,
  },
};
const prices = new PriceBook({ snapshot: TEST_SNAPSHOT });
const NO_LOGS: MergedLogs = { history: [], gapFill: [], subagent: [], costOnly: [] };
const NOW = T0 + 60 * MIN;

const ctx = (p: Partial<LogMergeContext> = {}): LogMergeContext => ({
  firstSeenAt: T0,
  historyBackfilled: false,
  partialGaps: [],
  forkCreatedAt: null,
  harnessCost: false,
  ...p,
});

const t1 = turnRecord({ turnId: "t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 1000, output: 100 }) });
const t2 = turnRecord({ turnId: "t2", startedAt: T0 + 10 * MIN, completedAt: T0 + 11 * MIN, model: "test-model", tokens: tokens({ input: 300_000 }) });

describe("mergeLogEntries (merge rule)", () => {
  const before = logEntry({ key: "before", ts: T0 - MIN });
  const after = logEntry({ key: "after", ts: T0 + MIN });
  const inGap = logEntry({ key: "gap", ts: T0 + 5 * MIN });
  const sub = logEntry({ key: "sub", ts: T0 + MIN, agentId: "agent-1" });
  const subBefore = logEntry({ key: "sub-before", ts: T0 - MIN, agentId: "agent-1" });

  it("uses main-session history before first sight only once backfilled", () => {
    expect(mergeLogEntries([before, after], ctx()).history).toEqual([]);
    const merged = mergeLogEntries([before, after], ctx({ historyBackfilled: true }));
    expect(merged.history.map((e) => e.key)).toEqual(["before"]);
    // After first sight the ledger owns main-session usage.
    expect([...merged.gapFill, ...merged.costOnly, ...merged.subagent]).toEqual([]);
  });

  it("uses main-session entries inside partial gap windows", () => {
    const merged = mergeLogEntries([after, inGap], ctx({ partialGaps: [{ fromMs: T0 + 4 * MIN, toMs: T0 + 6 * MIN }] }));
    expect(merged.gapFill.map((e) => e.key)).toEqual(["gap"]);
  });

  it("always uses subagent entries", () => {
    const merged = mergeLogEntries([sub, subBefore], ctx());
    expect(merged.subagent.map((e) => e.key)).toEqual(["sub", "sub-before"]);
  });

  it("skips a fork's copied history (entries before its createdAt), subagents included", () => {
    const merged = mergeLogEntries([before, sub, subBefore, inGap], ctx({ forkCreatedAt: T0, historyBackfilled: true, partialGaps: [{ fromMs: T0 - 2 * MIN, toMs: T0 + 6 * MIN }] }));
    expect(merged.history).toEqual([]);
    expect(merged.subagent.map((e) => e.key)).toEqual(["sub"]);
    expect(merged.gapFill.map((e) => e.key)).toEqual(["gap"]);
  });

  it("keeps main-session entries for their cost only when the harness records cost (pi)", () => {
    expect(mergeLogEntries([after], ctx({ harnessCost: true })).costOnly.map((e) => e.key)).toEqual(["after"]);
  });
});

describe("scenario 3: gateway", () => {
  // t1 made one main request and one subagent request; t2 one request; a title request ran between turns.
  const rows = [
    gatewayRow({ requestId: "t1-main", startTime: T0 + MIN + SEC, promptTokens: 1000, completionTokens: 100, spend: 0.02, durationMs: 2000 }),
    gatewayRow({ requestId: "t1-sub", startTime: T0 + MIN + 10 * SEC, promptTokens: 500, completionTokens: 50, spend: 0.01, durationMs: 1000 }),
    gatewayRow({ requestId: "t2-main", startTime: T0 + 10 * MIN + SEC, promptTokens: 300_000, completionTokens: 0, spend: 0.3, durationMs: 3000 }),
  ];

  it("headline equals the sum of spend, source gateway, API time present", () => {
    const u = threadUsage({ turns: [t1, t2], rows, logs: NO_LOGS, prices, billing: "gateway", now: NOW });
    expect(costTotal(u.figure.cost)).toBeCloseTo(0.33, 10);
    expect(u.figure.cost).toEqual({ gateway: expect.closeTo(0.33, 10), harness: 0, estimate: 0 });
    expect(u.figure.apiMs).toBe(6000);
    expect(u.turns.every((t) => t.source === "gateway")).toBe(true);
    const h = headline(u.figure);
    expect(h.primary).toBe("$0.33");
    expect(h.detail).toBe("billed by the gateway");
  });

  it("with logs off, gateway tokens beyond the ledger are the untracked remainder", () => {
    const u = threadUsage({ turns: [t1, t2], rows, logs: NO_LOGS, prices, billing: "gateway", now: NOW });
    expect(u.reconciliation).toEqual({ untrackedTokens: 550 });
    expect(u.figure.untrackedTokens).toBe(550);
  });

  it("with logs on, subagent rows sit under their turn and only the remainder is labelled", () => {
    const logs = mergeLogEntries(
      [logEntry({ key: "s1", agentId: "agent-a", ts: T0 + MIN + 10 * SEC, tokens: tokens({ input: 400, output: 50 }) })],
      ctx(),
    );
    const u = threadUsage({ turns: [t1, t2], rows, logs, prices, billing: "gateway", now: NOW });
    const view = u.turns.find((t) => t.turnId === "t1")!;
    expect(view.subagents).toEqual([expect.objectContaining({ agentId: "agent-a", requests: 1 })]);
    expect(u.reconciliation).toEqual({ untrackedTokens: 100 });
    // Gateway cost is exact; subagent rows add no estimate on top.
    expect(costTotal(u.figure.cost)).toBeCloseTo(0.33, 10);
  });
});

describe("scenario 5: mixed sources", () => {
  it("prices a turn without rows as an estimate and shows the mix; a request between turns is Outside turns", () => {
    const rows = [
      gatewayRow({ requestId: "t1", startTime: T0 + MIN + SEC, spend: 4.12 }),
      gatewayRow({ requestId: "between", startTime: T0 + 5 * MIN, spend: 0.05, promptTokens: 10, completionTokens: 5 }),
    ];
    const u = threadUsage({ turns: [t1, t2], rows, logs: NO_LOGS, prices, billing: "gateway", now: NOW });
    const byId = Object.fromEntries(u.turns.map((t) => [t.turnId, t]));
    expect(byId.t1!.source).toBe("gateway");
    expect(byId.t2!.source).toBe("estimate");
    expect(byId.t2!.cost.estimate).toBeCloseTo(0.3, 10);
    expect(byId.outside).toMatchObject({ kind: "outside", source: "gateway", requests: 1 });
    expect(byId.outside!.cost.gateway).toBeCloseTo(0.05, 10);
    expect(sourceMix(u.figure.cost)).toBe("$4.17 (gateway) + $0.30 (estimate)");
    expect(headline(u.figure).primary).toBe("$4.47");
  });
});

describe("scenario 6: unpriced", () => {
  it("a model with no price keeps its tokens, reads unpriced, and the headline adds unpriced tokens", () => {
    const turn = turnRecord({ turnId: "t", startedAt: T0, completedAt: T0 + SEC, model: "my-internal-model", tokens: tokens({ input: 2000, output: 500 }) });
    const u = threadUsage({ turns: [turn], rows: [], logs: NO_LOGS, prices, billing: "api-key", now: NOW });
    expect(u.turns[0]).toMatchObject({ source: "unpriced", unpricedTokens: 2500 });
    expect(costTotal(u.figure.cost)).toBe(0);
    expect(totalTokens(u.figure.tokens)).toBe(2500);
    expect(u.figure.unpricedModels).toEqual(["my-internal-model"]);
    expect(headline(u.figure).unpricedNote).toBe("+ 2.5k unpriced tokens");
  });

  it("a gateway row with spend 0 and output tokens is unpriced", () => {
    const rows = [gatewayRow({ requestId: "free", startTime: t1.startedAt! + SEC, spend: 0, promptTokens: 100, completionTokens: 20, model: "gw-custom" })];
    const u = threadUsage({ turns: [t1], rows, logs: NO_LOGS, prices, billing: "gateway", now: NOW });
    expect(u.turns[0]).toMatchObject({ source: "unpriced", unpricedTokens: 120 });
    expect(u.figure.unpricedModels).toEqual(["gw-custom"]);
  });

  it("a pi harness cost of 0 with output tokens is unpriced; a positive one is source harness (scenario 9)", () => {
    const pi = (cost: number) =>
      mergeLogEntries(
        [logEntry({ key: "m", ts: t1.startedAt! + SEC, costUsd: cost, model: "pi-custom", tokens: tokens({ input: 10, output: 5 }) })],
        ctx({ harnessCost: true }),
      );
    const zero = threadUsage({ turns: [t1], rows: [], logs: pi(0), prices, billing: "api-key", now: NOW });
    expect(zero.turns[0]!.source).toBe("unpriced");
    const paid = threadUsage({ turns: [t1], rows: [], logs: pi(0.07), prices, billing: "api-key", now: NOW });
    expect(paid.turns[0]).toMatchObject({ source: "harness", cost: { harness: 0.07, gateway: 0, estimate: 0 } });
  });
});

describe("scenario 7: estimates", () => {
  const snapshot = PINNED_SNAPSHOT.models;
  const opus55 = snapshot["claude-opus-5-5"]!;
  const sonnet = snapshot["claude-sonnet-4-5"]!;
  const t = tokens({ input: 10_000, output: 1000 });

  it("an aliased model costs its tokens × the target's snapshot rates; an override replaces that", () => {
    const aliased = new PriceBook({ snapshot, overrides: { aliases: { "claude-opus-5": "claude-opus-5-5" } } });
    const turn = turnRecord({ turnId: "t", startedAt: T0, completedAt: T0 + SEC, model: "claude-opus-5", tokens: t });
    const u = threadUsage({ turns: [turn], rows: [], logs: NO_LOGS, prices: aliased, billing: "unknown", now: NOW });
    expect(u.figure.cost.estimate).toBeCloseTo(10_000 * opus55.input_cost_per_token! + 1000 * opus55.output_cost_per_token!, 10);
    const overridden = new PriceBook({
      snapshot,
      overrides: { aliases: { "claude-opus-5": "claude-opus-5-5" }, prices: { "claude-opus-5-5": { input: 1, output: 1 } } },
    });
    const o = threadUsage({ turns: [turn], rows: [], logs: NO_LOGS, prices: overridden, billing: "unknown", now: NOW });
    expect(o.figure.cost.estimate).toBeCloseTo(11_000 / 1e6, 10);
  });

  it("a turn whose model fell back is priced as the fallback model", () => {
    const events = [
      requested(1, T0, "r1", "claude-opus-5-5"),
      accepted(2, T0, "t1", "r1"),
      started(3, T0, "t1"),
      ev(4, T0, "provider/modelFallback", "t1", { fallbackModel: "claude-sonnet-4-5" }),
      usage(5, T0, "t1", cb({ input: 10_000, output: 1000 }), cb({ input: 10_000, output: 1000 })),
      completed(6, T0 + SEC, "t1"),
    ];
    const r = ingestEvents({ cursor: EMPTY_CURSOR, turns: new Map(), events, latestSeq: 6, now: NOW });
    const u = threadUsage({ turns: [...r.turns.values()], rows: [], logs: NO_LOGS, prices: new PriceBook({ snapshot }), billing: "unknown", now: NOW });
    expect(u.figure.cost.estimate).toBeCloseTo(10_000 * sonnet.input_cost_per_token! + 1000 * sonnet.output_cost_per_token!, 10);
    // Sonnet 4.5 has a 200k tier and bb gives no request size: flagged approximate.
    expect(u.figure.approximate).toBe(true);
  });
});

describe("scenario 8: history on install, then backfill", () => {
  // First read: t1 lost its usage to pruning, t2's snapshot survived with total {500, 200}.
  const events = [
    identity(1, T0 - 30 * MIN, "sess-a"),
    started(2, T0 - 30 * MIN, "t1"),
    completed(3, T0 - 29 * MIN, "t1"),
    started(300, T0 - 10 * MIN, "t2"),
    usage(301, T0 - 10 * MIN, "t2", cb({ input: 10, output: 5 }), cb({ input: 500, output: 200 })),
    completed(302, T0 - 9 * MIN, "t2"),
  ];
  const first = ingestEvents({ cursor: EMPTY_CURSOR, turns: new Map(), events, latestSeq: 302, now: T0 });
  const after = turnRecord({ turnId: "t3", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 1000, output: 100 }) });
  const turns: TurnRecord[] = [...first.turns.values(), after];

  it("carries the partial note before the backfill", () => {
    const u = threadUsage({ turns, rows: [], logs: NO_LOGS, prices, billing: "unknown", now: NOW });
    expect(u.turns.some((t) => t.kind === "opening")).toBe(true);
    expect(u.figure.partial).toBe(true);
    expect(u.figure.tokens).toEqual(tokens({ input: 1500, output: 300 }));
  });

  it("after the backfill: history entries before first sight + ledger turns after it, no opening balance, note cleared", () => {
    const history = [
      logEntry({ key: "h1", ts: T0 - 30 * MIN, tokens: tokens({ input: 700, output: 90 }) }),
      logEntry({ key: "h2", ts: T0 - 10 * MIN, tokens: tokens({ input: 10, output: 5 }) }),
      // A log line after first sight belongs to the ledger, not to history.
      logEntry({ key: "live", ts: T0 + MIN + SEC, tokens: tokens({ input: 1000, output: 100 }) }),
    ];
    const logs = mergeLogEntries(history, ctx({ firstSeenAt: T0, historyBackfilled: true }));
    const u = threadUsage({ turns, rows: [], logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
    expect(u.turns.some((t) => t.kind === "opening")).toBe(false);
    // Entries inside a turn that completed before first sight are that turn's tokens; the rest form the history row.
    expect(u.turns.some((t) => t.kind === "history" || (t.kind === "turn" && t.completedAt! < T0))).toBe(true);
    expect(u.figure.tokens).toEqual(tokens({ input: 1710, output: 195 }));
    expect(u.figure.partial).toBe(false);
  });
});

describe("scenario 8: a turn running at first sight", () => {
  // The turn completed after first sight, so it stays in the ledger and the
  // history entries inside its window are left out.
  it("keeps the usage the turn made after first sight once history replaces the opening balance", () => {
    const first = ingestEvents({
      cursor: EMPTY_CURSOR,
      turns: new Map(),
      events: [
        started(2, T0 - 30 * MIN, "t1"),
        completed(3, T0 - 29 * MIN, "t1"),
        started(300, T0 - MIN, "t2"),
        usage(301, T0 - 30 * SEC, "t2", cb({ input: 10, output: 5 }), cb({ input: 710, output: 85 })),
      ],
      latestSeq: 301,
      now: T0,
    });
    const second = ingestEvents({
      cursor: first.cursor,
      turns: first.turns,
      events: [
        usage(302, T0 + MIN, "t2", cb({ input: 100, output: 50 }), cb({ input: 810, output: 135 })),
        completed(303, T0 + 2 * MIN, "t2"),
      ],
      latestSeq: 303,
      now: T0 + 3 * MIN,
    });
    const turns = [...new Map([...first.turns, ...second.turns]).values()];
    const logs = mergeLogEntries(
      [
        logEntry({ key: "h1", ts: T0 - 30 * MIN, tokens: tokens({ input: 700, output: 80 }) }),
        logEntry({ key: "h2", ts: T0 - 30 * SEC, tokens: tokens({ input: 10, output: 5 }) }),
      ],
      ctx({ firstSeenAt: T0, historyBackfilled: true }),
    );
    const u = threadUsage({ turns, rows: [], logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
    expect(u.figure.tokens).toEqual(tokens({ input: 810, output: 135 }));
  });
});

describe("headline wording", () => {
  const fig = (billing: BillingMode, turns = [t1]) =>
    threadUsage({ turns, rows: [], logs: NO_LOGS, prices, billing, now: NOW }).figure;

  it("subscription leads with tokens and a list-price equivalent (scenario 14)", () => {
    const h = headline(fig("subscription"));
    expect(h).toMatchObject({ primaryKind: "tokens", primary: "1.1k tokens", billing: "subscription", chip: "1.1k" });
    expect(h.detail).toMatch(/list-price equivalent/);
  });

  it("api-key and unknown show dollars labelled estimate", () => {
    expect(headline(fig("api-key"))).toMatchObject({ primaryKind: "usd", primary: "$0.0020" });
    expect(headline(fig("api-key")).detail).toBe("estimate · API key");
    expect(headline(fig("unknown")).detail).toBe("estimate · billing unknown");
  });

  it("gateway shows dollars billed by the gateway", () => {
    const f = threadUsage({ turns: [t1], rows: [gatewayRow({ requestId: "r", startTime: t1.startedAt!, spend: 1.5 })], logs: NO_LOGS, prices, billing: "gateway", now: NOW }).figure;
    expect(headline(f)).toMatchObject({ primary: "$1.50", billing: "gateway" });
    expect(headline(f).detail).toContain("billed by the gateway");
  });

  it("a mixed family shows billed dollars first and a subscription line", () => {
    const big = turnRecord({ turnId: "b", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 12_400_000 }) });
    const family = sumFigures([fig("api-key"), fig("subscription", [big])]);
    const h = headline(family);
    expect(h.billing).toBe("mixed");
    expect(h.primary).toBe("$0.0020");
    expect(h.secondary).toBe("+ 12.4M tokens on subscription (≈ $12.40 list price)");
  });
});

describe("sumFigures", () => {
  it("adds tokens, cost, turns and lines", () => {
    const a = threadUsage({ turns: [t1], rows: [], logs: NO_LOGS, prices, billing: "unknown", now: NOW }).figure;
    const b = threadUsage({ turns: [t2], rows: [], logs: NO_LOGS, prices, billing: "unknown", now: NOW }).figure;
    const s = sumFigures([a, b]);
    expect(s.turns).toBe(2);
    expect(s.tokens).toEqual(tokens({ input: 301_000, output: 100 }));
    expect(costTotal(s.cost)).toBeCloseTo(costTotal(a.cost) + costTotal(b.cost), 12);
  });
});

// Scenario 9's dedup across repeated log lines is the host entry's job (test/host).
export type { StoredLogEntry };

describe("outside turns", () => {
  it("shows the gateway rows' tokens and model, and does not count them again as untracked", () => {
    const turn = turnRecord({ turnId: "t", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 10 }) });
    const row = gatewayRow({ requestId: "o", startTime: T0 + 10 * MIN, promptTokens: 500, completionTokens: 20, spend: 0.01, model: "gw-model" });
    const u = threadUsage({ turns: [turn], rows: [row], logs: NO_LOGS, prices, billing: "gateway", now: NOW });
    const outside = u.turns.find((t) => t.kind === "outside")!;
    expect(outside.tokens).toEqual(tokens({ input: 500, output: 20 }));
    expect(outside.model).toBe("gw-model");
    expect(u.figure.untrackedTokens).toBe(0);
  });
});

describe("history placed into its turns", () => {
  it("gives a turn that completed before first sight the log entries in its window; the rest stay in the history row", () => {
    const early = turnRecord({ turnId: "early", startedAt: T0 - 20 * MIN, completedAt: T0 - 19 * MIN, model: "test-model", tokens: tokens({ input: 5 }) });
    const logs = mergeLogEntries(
      [
        logEntry({ key: "in-turn", ts: T0 - 20 * MIN + SEC, tokens: tokens({ input: 300 }) }),
        logEntry({ key: "loose", ts: T0 - 40 * MIN, tokens: tokens({ input: 40 }) }),
      ],
      ctx({ firstSeenAt: T0, historyBackfilled: true }),
    );
    const u = threadUsage({ turns: [early], rows: [], logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
    expect(u.turns.find((t) => t.turnId === "early")!.tokens.input).toBe(300);
    expect(u.turns.find((t) => t.kind === "history")!.tokens.input).toBe(40);
    expect(u.figure.tokens.input).toBe(340);
  });
});

describe("mixed billing split", () => {
  it("takes the subscription part out of the source split by source, not by share", () => {
    const gw = threadUsage({
      turns: [turnRecord({ turnId: "g", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 10 }) })],
      rows: [gatewayRow({ requestId: "r", startTime: T0 + 1, spend: 0.003 })],
      logs: NO_LOGS, prices, billing: "gateway", now: NOW,
    }).figure;
    const api = threadUsage({ turns: [turnRecord({ turnId: "a", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 2700 }) })], rows: [], logs: NO_LOGS, prices, billing: "api-key", now: NOW }).figure;
    const sub = threadUsage({ turns: [turnRecord({ turnId: "s", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 8500 }) })], rows: [], logs: NO_LOGS, prices, billing: "subscription", now: NOW }).figure;
    const h = headline(sumFigures([gw, api, sub]));
    expect(h.billing).toBe("mixed");
    expect(h.primary).toBe("$0.0057");
    expect(h.detail).toBe("$0.0030 (gateway) + $0.0027 (estimate) · mixed billing");
  });
});
