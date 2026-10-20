import { describe, expect, it } from "vitest";
import type { BillingMode } from "../../src/core/billing";
import { headline } from "../../src/core/format";
import { EMPTY_CURSOR, ingestEvents, type TurnRecord } from "../../src/core/ledger";
import { trimModelsDev } from "../../src/core/models-dev";
import { PriceBook, type ModelPrice } from "../../src/core/pricing";
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
import {
  accepted,
  claudeBreakdown as cb,
  completed,
  ev,
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
const TEST_MODEL: ModelPrice = { input: 1e-6, output: 1e-5, cacheRead: 1e-7, cacheWrite: 1.25e-6 };
const bookOf = (models: Record<string, ModelPrice>) => new PriceBook({ models, origin: "models.dev" });
const prices = bookOf({ "test-model": TEST_MODEL });
// Claude Haiku 5.5 as models.dev published it on 2026-10-19: one context tier, over 100,000 tokens.
const haikuPrices = bookOf(
  trimModelsDev({
    anthropic: {
      models: {
        "claude-haiku-5-5": {
          cost: {
            input: 0.1,
            output: 0.5,
            cache_read: 0.01,
            cache_write: 0.125,
            tiers: [{ input: 0.5, output: 2.5, cache_read: 0.05, cache_write: 0.625, tier: { type: "context", size: 100_000 } }],
          },
        },
      },
    },
  }),
);
const NO_LOGS: MergedLogs = { history: [], gapFill: [], subagent: [], cacheWrites: [] };
const NOW = T0 + 60 * MIN;

const ctx = (p: Partial<LogMergeContext> = {}): LogMergeContext => ({
  firstSeenAt: T0,
  historyBackfilled: false,
  partialGaps: [],
  forkCreatedAt: null,
  ...p,
});

const t1 = turnRecord({ turnId: "t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 1000, output: 100 }) });
const t2 = turnRecord({ turnId: "t2", startedAt: T0 + 10 * MIN, completedAt: T0 + 11 * MIN, model: "test-model", tokens: tokens({ input: 300_000 }) });

/** A turn bb recorded from per-request usage events: its tokens are the sum of its requests. */
function recorded(turnId: string, model: string, requests: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }[], extra: Partial<TurnRecord> = {}): TurnRecord {
  const each = requests.map((r) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...r }));
  return turnRecord({
    turnId,
    startedAt: T0 + MIN,
    completedAt: T0 + 2 * MIN,
    model,
    tokens: tokens({
      input: each.reduce((n, r) => n + r.input, 0),
      output: each.reduce((n, r) => n + r.output, 0),
      cacheRead: each.reduce((n, r) => n + r.cacheRead, 0),
      cacheWrite: each.reduce((n, r) => n + r.cacheWrite, 0),
    }),
    requests: each,
    usageEvents: each.length,
    ...extra,
  });
}

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
    expect([...merged.gapFill, ...merged.subagent]).toEqual([]);
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

  it("keeps main-session entries with cache writes for the cache lifetime of the ledger's writes", () => {
    const written = logEntry({ key: "written", ts: T0 + MIN, tokens: tokens({ cacheWrite: 500 }) });
    expect(mergeLogEntries([after, written], ctx()).cacheWrites.map((e) => e.key)).toEqual(["written"]);
  });
});

describe("1-hour cache writes the ledger cannot see", () => {
  // bb's usage events carry no cache lifetime, so the ledger's turns hold
  // every cache write as a 5-minute one.
  const oneHourPrices = bookOf({ "test-model": { ...TEST_MODEL, claude: true } });
  const turn = (turnId: string, startedAt: number) =>
    turnRecord({ turnId, startedAt, completedAt: startedAt + MIN, model: "test-model", tokens: tokens({ cacheWrite: 1_000_000 }) });
  const entry = (key: string, ts: number, cacheWrite: number, cacheWrite1h: number) =>
    logEntry({ key, ts, model: "test-model", tokens: tokens({ cacheWrite, cacheWrite1h }) });

  it("prices a turn's cache writes at the 1-hour rate where its session log records 1-hour writes", () => {
    const logs = mergeLogEntries([entry("a", T0 + MIN + SEC, 600_000, 600_000), entry("b", T0 + MIN + 2 * SEC, 400_000, 400_000)], ctx());
    const u = threadUsage({ turns: [turn("t1", T0 + MIN)], logs, prices: oneHourPrices, billing: "subscription", now: NOW });
    expect(u.figure.tokens).toEqual(tokens({ cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 }));
    expect(costTotal(u.figure.cost)).toBeCloseTo(2, 10);
  });

  it("takes the 1-hour share of the turn's logged cache writes", () => {
    const logs = mergeLogEntries([entry("1h", T0 + MIN + SEC, 300, 300), entry("5m", T0 + MIN + 2 * SEC, 100, 0)], ctx());
    const u = threadUsage({ turns: [turn("t1", T0 + MIN)], logs, prices: oneHourPrices, billing: "subscription", now: NOW });
    expect(u.figure.tokens.cacheWrite1h).toBe(750_000);
  });

  it("prices both turns at the 1-hour rate when a turn's first request is logged just before bb starts it", () => {
    const t2Start = T0 + 3 * MIN;
    // Inside t1's 30-second grace window, so it is placed under t1.
    const early = entry("early", t2Start - 7, 400_000, 400_000);
    const logs = mergeLogEntries([entry("t1", T0 + MIN + SEC, 1_000_000, 1_000_000), early, entry("t2", t2Start + SEC, 600_000, 600_000)], ctx());
    const u = threadUsage({ turns: [turn("t1", T0 + MIN), turn("t2", t2Start)], logs, prices: oneHourPrices, billing: "subscription", now: NOW });
    expect(u.figure.tokens.cacheWrite1h).toBe(2_000_000);
  });

  it("prices a recorded turn's 1-hour share as a line of its own, at twice the input rate of the tier its requests used", () => {
    const logs = mergeLogEntries([logEntry({ key: "w", ts: T0 + MIN + SEC, model: "claude-haiku-5-5", tokens: tokens({ cacheWrite: 1_000, cacheWrite1h: 1_000 }) })], ctx());
    const record = recorded("t1", "claude-haiku-5-5", [{ input: 100_000, cacheWrite: 1_000 }]);
    const u = threadUsage({ turns: [record], logs, prices: haikuPrices, billing: "api-key", now: NOW });
    // 101,000 prompt tokens: over the tier, so the 1,000 one-hour tokens cost 2 × $0.50 per M.
    expect(u.figure.cost.estimate).toBeCloseTo(100_000 * 0.5e-6 + 1_000 * 1.0e-6, 12);
    expect(u.turns[0]!.approximate).toBe(false);
  });
});

describe("a turn bb recorded is priced request by request", () => {
  const turnOf = (requests: Parameters<typeof recorded>[2]) => recorded("t1", "claude-haiku-5-5", requests);
  const run = (turn: TurnRecord, book = haikuPrices) => threadUsage({ turns: [turn], logs: NO_LOGS, prices: book, billing: "api-key", now: NOW });

  it("prices three 40,000-token requests at the base rates, each, and the turn at their sum", () => {
    const u = run(turnOf([{ input: 40_000, output: 100 }, { input: 40_000, output: 100 }, { input: 40_000, output: 100 }]));
    expect(u.figure.cost.estimate).toBeCloseTo(3 * (40_000 * 0.1e-6 + 100 * 0.5e-6), 12);
    expect(u.turns[0]).toMatchObject({ approximate: false, tierUnsized: false, tierDetail: null, requests: 3 });
  });

  it("prices a request over the tier at the tier's rates, another at the base, and lists only the tiered one", () => {
    const u = run(turnOf([{ input: 40_000, output: 100 }, { input: 20_000, output: 1_000, cacheRead: 70_000, cacheWrite: 10_001 }]));
    const tiered = 20_000 * 0.5e-6 + 1_000 * 2.5e-6 + 70_000 * 0.05e-6 + 10_001 * 0.625e-6;
    const plain = 40_000 * 0.1e-6 + 100 * 0.5e-6;
    expect(u.figure.cost.estimate).toBeCloseTo(plain + tiered, 12);
    expect(u.turns[0]!.tierDetail).toEqual({
      requests: 2,
      tiered: [{ number: 2, prompt: 100_001, usd: expect.closeTo(tiered, 12), tierAbove: 100_000 }],
      untiered: { count: 1, usd: expect.closeTo(plain, 12) },
      oneHour: null,
    });
    expect(u.figure.unsizedTurns).toBe(0);
  });

  it("keeps the request numbers in the order the requests were made", () => {
    const u = run(turnOf([{ input: 150_000 }, { input: 10_000 }, { input: 200_000 }]));
    expect(u.turns[0]!.tierDetail!.tiered.map((r) => r.number)).toEqual([1, 3]);
  });

  it("charges a model with no tier its base rates and carries no tier detail", () => {
    const u = run(recorded("t1", "test-model", [{ input: 500_000, output: 10 }]), prices);
    expect(u.figure.cost.estimate).toBeCloseTo(500_000 * 1e-6 + 10 * 1e-5, 12);
    expect(u.turns[0]).toMatchObject({ tierDetail: null, approximate: false });
  });

  it("leaves a turn with no request counts on the base rates, marked approximate, and counts it for the note", () => {
    const asSum = turnRecord({ turnId: "t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "claude-haiku-5-5", tokens: tokens({ input: 250_000, output: 1_000 }) });
    const u = run(asSum);
    expect(u.figure.cost.estimate).toBeCloseTo(250_000 * 0.1e-6 + 1_000 * 0.5e-6, 12);
    expect(u.turns[0]).toMatchObject({ approximate: true, tierUnsized: true, tierDetail: null, requests: 0 });
    expect(u.figure.unsizedTurns).toBe(1);
    expect(u.figure.assumedRates).toBe(false);
  });

  it("does not mark an opening balance approximate for a model with no tier, and does for one with", () => {
    const opening = (model: string) => turnRecord({ turnId: "opening", kind: "opening", status: "completed", model, tokens: tokens({ input: 300_000 }), partial: true });
    expect(run(opening("test-model"), prices).turns[0]).toMatchObject({ kind: "opening", approximate: false, tierUnsized: false });
    expect(run(opening("claude-haiku-5-5")).turns[0]).toMatchObject({ kind: "opening", approximate: true, tierUnsized: true });
  });

  it("prices a recorded turn's 1-hour cache writes as a line of its own on the opened turn", () => {
    // Half of the logged cache writes were 1-hour ones, so half of the turn's 1,000 are.
    const logs = mergeLogEntries([logEntry({ key: "w", ts: T0 + MIN + SEC, model: "claude-haiku-5-5", tokens: tokens({ cacheWrite: 1_000, cacheWrite1h: 500 }) })], ctx());
    const u = threadUsage({ turns: [turnOf([{ input: 120_000, cacheWrite: 1_000 }])], logs, prices: haikuPrices, billing: "api-key", now: NOW });
    expect(u.turns[0]!.tierDetail!.oneHour).toEqual({ tokens: 500, usd: expect.closeTo(500 * 1.0e-6, 12) });
  });

  it("marks a turn approximate when its requests were charged at more than one rate and it has 1-hour writes", () => {
    const logs = mergeLogEntries([logEntry({ key: "w", ts: T0 + MIN + SEC, model: "claude-haiku-5-5", tokens: tokens({ cacheWrite: 100, cacheWrite1h: 100 }) })], ctx());
    const u = threadUsage({ turns: [turnOf([{ input: 10_000, cacheWrite: 50 }, { input: 150_000, cacheWrite: 50 }])], logs, prices: haikuPrices, billing: "api-key", now: NOW });
    expect(u.turns[0]!.approximate).toBe(true);
    expect(u.figure.assumedRates).toBe(true);
    expect(u.figure.unsizedTurns).toBe(0);
  });

  it("prices a turn whose model has no price as unpriced, with its tokens counted", () => {
    const u = run(recorded("t1", "my-internal-model", [{ input: 100, output: 10 }]), prices);
    expect(u.turns[0]).toMatchObject({ source: "unpriced", unpricedTokens: 110, requests: 2 - 1 });
    expect(u.figure.unpricedModels).toEqual(["my-internal-model"]);
  });
});

describe("requests a log records are priced on their own", () => {
  it("prices a subagent request over the tier at the tier's rates, its 1-hour writes at twice the tier's input rate", () => {
    const sub = logEntry({
      key: "s",
      agentId: "agent-a",
      ts: t1.startedAt! + SEC,
      model: "claude-haiku-5-5",
      tokens: tokens({ input: 20_000, output: 10_000, cacheRead: 70_000, cacheWrite: 10_001, cacheWrite1h: 1_000 }),
    });
    const logs = mergeLogEntries([sub], ctx());
    const u = threadUsage({ turns: [t1], logs, prices: haikuPrices, billing: "subscription", now: NOW });
    const expected = 20_000 * 0.5e-6 + 10_000 * 2.5e-6 + 70_000 * 0.05e-6 + 9_001 * 0.625e-6 + 1_000 * 1.0e-6;
    expect(u.turns[0]!.subagents[0]!.costUsd).toBeCloseTo(expected, 12);
  });

  it("prices a partial gap's log requests one by one and lists the tiered ones", () => {
    const record = recorded("t1", "claude-haiku-5-5", [{ input: 1 }], { partial: true });
    const entries = [
      logEntry({ key: "a", ts: T0 + MIN + SEC, model: "claude-haiku-5-5", tokens: tokens({ input: 120_000, output: 10 }) }),
      logEntry({ key: "b", ts: T0 + MIN + 2 * SEC, model: "claude-haiku-5-5", tokens: tokens({ input: 40_000, output: 10 }) }),
    ];
    const logs = mergeLogEntries(entries, ctx({ partialGaps: [{ fromMs: T0, toMs: T0 + 3 * MIN }] }));
    const u = threadUsage({ turns: [record], logs, prices: haikuPrices, billing: "api-key", now: NOW });
    expect(u.figure.cost.estimate).toBeCloseTo(120_000 * 0.5e-6 + 10 * 2.5e-6 + 40_000 * 0.1e-6 + 10 * 0.5e-6, 12);
    expect(u.turns[0]!.tierDetail!.tiered.map((r) => r.number)).toEqual([1]);
    expect(u.turns[0]!.approximate).toBe(false);
  });
});

describe("unpriced", () => {
  it("a model with no price keeps its tokens, reads unpriced, and the headline adds unpriced tokens", () => {
    const turn = turnRecord({ turnId: "t", startedAt: T0, completedAt: T0 + SEC, model: "my-internal-model", tokens: tokens({ input: 2000, output: 500 }) });
    const u = threadUsage({ turns: [turn], logs: NO_LOGS, prices, billing: "api-key", now: NOW });
    expect(u.turns[0]).toMatchObject({ source: "unpriced", unpricedTokens: 2500 });
    expect(costTotal(u.figure.cost)).toBe(0);
    expect(totalTokens(u.figure.tokens)).toBe(2500);
    expect(u.figure.unpricedModels).toEqual(["my-internal-model"]);
    // Every token is unpriced: the headline leads with the count and says they are not priced.
    expect(headline(u.figure)).toMatchObject({ primary: "2.5k tokens", primaryKind: "tokens", chip: "2.5k", detail: "The tokens are not priced" });
  });

  it("some priced and some unpriced tokens lead with the dollars and name the unpriced tokens beside them", () => {
    const odd = turnRecord({ turnId: "odd", startedAt: T0 + 5 * MIN, completedAt: T0 + 6 * MIN, model: "my-internal-model", tokens: tokens({ input: 2000, output: 500 }) });
    const u = threadUsage({ turns: [t1, odd], logs: NO_LOGS, prices, billing: "api-key", now: NOW });
    expect(headline(u.figure)).toMatchObject({ primaryKind: "usd", primary: "$0.0020", unpricedNote: "+ 2.5k unpriced tokens" });
  });

  it("a subscription thread with some unpriced tokens leads with the token count and names them beside it", () => {
    const odd = turnRecord({ turnId: "odd", startedAt: T0 + 5 * MIN, completedAt: T0 + 6 * MIN, model: "my-internal-model", tokens: tokens({ input: 2000, output: 500 }) });
    const u = threadUsage({ turns: [t1, odd], logs: NO_LOGS, prices, billing: "subscription", now: NOW });
    expect(headline(u.figure)).toMatchObject({ primaryKind: "tokens", primary: "3.6k tokens", unpricedNote: "+ 2.5k unpriced tokens" });
  });

  it("a thread with no tokens keeps the dash and says no usage was recorded", () => {
    const empty = turnRecord({ turnId: "e", startedAt: T0, completedAt: T0 + SEC, model: "my-internal-model" });
    const u = threadUsage({ turns: [empty], logs: NO_LOGS, prices, billing: "api-key", now: NOW });
    expect(headline(u.figure)).toMatchObject({ primary: "—", chip: "—", detail: "No usage recorded" });
  });
});

describe("estimates", () => {
  it("a turn whose model fell back is priced as the fallback model", () => {
    const book = bookOf({ "claude-opus-5-5": { input: 5e-6, output: 25e-6 }, "claude-sonnet-4-5": { input: 3e-6, output: 15e-6, tiers: [{ above: 200_000, input: 6e-6 }] } });
    const events = [
      requested(1, T0, "r1", "claude-opus-5-5"),
      accepted(2, T0, "t1", "r1"),
      started(3, T0, "t1"),
      ev(4, T0, "provider/modelFallback", "t1", { fallbackModel: "claude-sonnet-4-5" }),
      usage(5, T0, "t1", cb({ input: 10_000, output: 1000 }), cb({ input: 10_000, output: 1000 })),
      completed(6, T0 + SEC, "t1"),
    ];
    const r = ingestEvents({ cursor: EMPTY_CURSOR, turns: new Map(), events, latestSeq: 6, now: NOW });
    const u = threadUsage({ turns: [...r.turns.values()], logs: NO_LOGS, prices: book, billing: "unknown", now: NOW });
    expect(u.figure.cost.estimate).toBeCloseTo(10_000 * 3e-6 + 1000 * 15e-6, 10);
    // The turn was read from a per-request usage event, so no tier is guessed.
    expect(u.figure.approximate).toBe(false);
  });

  it("prices a turn read from events request by request, end to end through the ledger", () => {
    const events = [
      requested(1, T0, "r1", "claude-haiku-5-5"),
      accepted(2, T0, "t1", "r1"),
      started(3, T0, "t1"),
      usage(4, T0 + 1, "t1", cb({ input: 40_000, output: 100 }), cb({ input: 40_000, output: 100 })),
      usage(5, T0 + 2, "t1", cb({ input: 30_000, output: 100, cacheRead: 80_000 }), cb({ input: 70_000, output: 200, cacheRead: 80_000 })),
      completed(6, T0 + SEC, "t1"),
    ];
    const r = ingestEvents({ cursor: EMPTY_CURSOR, turns: new Map(), events, latestSeq: 6, now: NOW });
    const u = threadUsage({ turns: [...r.turns.values()], logs: NO_LOGS, prices: haikuPrices, billing: "api-key", now: NOW });
    expect(u.figure.cost.estimate).toBeCloseTo(40_000 * 0.1e-6 + 100 * 0.5e-6 + 30_000 * 0.5e-6 + 100 * 2.5e-6 + 80_000 * 0.05e-6, 12);
    expect(u.turns[0]!.tierDetail!.tiered).toEqual([expect.objectContaining({ number: 2, prompt: 110_000, tierAbove: 100_000 })]);
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
    const u = threadUsage({ turns, logs: NO_LOGS, prices, billing: "unknown", now: NOW });
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
    const u = threadUsage({ turns, logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
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
    const u = threadUsage({ turns, logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
    expect(u.figure.tokens).toEqual(tokens({ input: 810, output: 135 }));
  });
});

describe("headline wording", () => {
  const fig = (billing: BillingMode, turns = [t1]) => threadUsage({ turns, logs: NO_LOGS, prices, billing, now: NOW }).figure;

  it("subscription leads with tokens and a list-price equivalent", () => {
    const h = headline(fig("subscription"));
    expect(h).toMatchObject({ primaryKind: "tokens", primary: "1.1k tokens", billing: "subscription", chip: "1.1k" });
    expect(h.detail).toMatch(/list-price equivalent/);
  });

  it("api-key and unknown show dollars labelled estimate", () => {
    expect(headline(fig("api-key"))).toMatchObject({ primaryKind: "usd", primary: "$0.0020" });
    expect(headline(fig("api-key")).detail).toBe("estimate · API key");
    expect(headline(fig("unknown")).detail).toBe("estimate · billing unknown");
  });

  it("a mixed tree shows billed dollars first and a subscription line", () => {
    const big = turnRecord({ turnId: "b", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 12_400_000 }) });
    const tree = sumFigures([fig("api-key"), fig("subscription", [big])]);
    const h = headline(tree);
    expect(h.billing).toBe("mixed");
    expect(h.primary).toBe("$0.0020");
    expect(h.secondary).toBe("+ 12.4M tokens on subscription (≈ $12.40 list price)");
  });
});

describe("a cost a harness wrote", () => {
  it("is ignored: an entry stored by an earlier version with a cost is priced from its tokens", () => {
    const stored = { ...logEntry({ key: "legacy", agentId: "agent-a", ts: t1.startedAt! + SEC, model: "test-model", tokens: tokens({ input: 1_000_000 }) }), costUsd: 42 };
    const logs = mergeLogEntries([stored], ctx());
    const u = threadUsage({ turns: [t1], logs, prices, billing: "api-key", now: NOW });
    expect(u.turns[0]!.subagents[0]!.costUsd).toBeCloseTo(1, 10);
    expect(costTotal(u.figure.cost)).toBeLessThan(2);
  });
});

describe("the report's cost amounts", () => {
  it("keeps gateway and harness at zero and puts every dollar in estimate", () => {
    const u = threadUsage({ turns: [t1, t2], logs: NO_LOGS, prices, billing: "api-key", now: NOW });
    expect(u.figure.cost).toEqual({ gateway: 0, harness: 0, estimate: expect.closeTo(0.0020 + 0.3, 10) });
    for (const t of u.turns) expect(t.cost.gateway + t.cost.harness).toBe(0);
    expect(u.turns.map((t) => t.source)).toEqual(["estimate", "estimate"]);
  });
});

describe("sumFigures", () => {
  it("adds tokens, cost, turns, lines and the counts the notes read", () => {
    const a = threadUsage({ turns: [t1], logs: NO_LOGS, prices, billing: "unknown", now: NOW }).figure;
    const b = threadUsage({ turns: [t2], logs: NO_LOGS, prices, billing: "unknown", now: NOW }).figure;
    const s = sumFigures([a, b]);
    expect(s.turns).toBe(2);
    expect(s.tokens).toEqual(tokens({ input: 301_000, output: 100 }));
    expect(costTotal(s.cost)).toBeCloseTo(costTotal(a.cost) + costTotal(b.cost), 12);
    const unsized = turnRecord({ turnId: "u", startedAt: T0, completedAt: T0 + SEC, model: "claude-haiku-5-5", tokens: tokens({ input: 10 }) });
    const c = threadUsage({ turns: [unsized], logs: NO_LOGS, prices: haikuPrices, billing: "unknown", now: NOW }).figure;
    expect(sumFigures([c, c]).unsizedTurns).toBe(2);
  });
});

// The dedup across repeated log lines is the host entry's job (test/host).
export type { StoredLogEntry };

describe("outside turns", () => {
  it("holds only subagent requests that fall inside no turn", () => {
    const turn = turnRecord({ turnId: "t", startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input: 10 }) });
    const logs = mergeLogEntries([logEntry({ key: "o", agentId: "agent-z", ts: T0 + 10 * MIN, model: "test-model", tokens: tokens({ input: 500, output: 20 }) })], ctx());
    const u = threadUsage({ turns: [turn], logs, prices, billing: "api-key", now: NOW });
    const outside = u.turns.find((t) => t.kind === "outside")!;
    expect(outside.tokens).toEqual(tokens({ input: 500, output: 20 }));
    expect(outside.model).toBe("test-model");
    expect(outside.subagents).toHaveLength(1);
    expect(u.turns.filter((t) => t.kind === "outside")).toHaveLength(1);
  });

  it("is absent without subagent entries", () => {
    expect(threadUsage({ turns: [t1], logs: NO_LOGS, prices, billing: "api-key", now: NOW }).turns.some((t) => t.kind === "outside")).toBe(false);
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
    const u = threadUsage({ turns: [early], logs, prices, billing: "unknown", now: NOW, historyBefore: T0 });
    expect(u.turns.find((t) => t.turnId === "early")!.tokens.input).toBe(300);
    expect(u.turns.find((t) => t.kind === "history")!.tokens.input).toBe(40);
    expect(u.figure.tokens.input).toBe(340);
  });
});

describe("mixed billing split", () => {
  it("takes the subscription part out of the billed dollars", () => {
    const turnOf = (id: string, input: number) => turnRecord({ turnId: id, startedAt: T0, completedAt: T0 + SEC, model: "test-model", tokens: tokens({ input }) });
    const api = threadUsage({ turns: [turnOf("a", 2700)], logs: NO_LOGS, prices, billing: "api-key", now: NOW }).figure;
    const sub = threadUsage({ turns: [turnOf("s", 8500)], logs: NO_LOGS, prices, billing: "subscription", now: NOW }).figure;
    const h = headline(sumFigures([api, sub]));
    expect(h.billing).toBe("mixed");
    expect(h.primary).toBe("$0.0027");
    expect(h.detail).toBe("estimate · mixed billing");
  });
});
