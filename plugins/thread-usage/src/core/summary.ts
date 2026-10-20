/**
 * Turns the stored ledger and harness-log entries of one thread into what the
 * surfaces show (log merge, cost and billing), and adds threads up into
 * trees. Every dollar is a models.dev estimate of tokens, or the tokens are
 * unpriced.
 */
import type { BillingMode } from "./billing";
import type { TurnRecord } from "./ledger";
import {
  costOf,
  priceRequests,
  type PriceBook,
  type PricedRequest,
  type RequestsCost,
} from "./pricing";
import {
  addTokens,
  promptTokens,
  totalTokens,
  ZERO_TOKENS,
  type RequestTokens,
  type Tokens,
} from "./tokens";

export type CostSource = "estimate" | "unpriced";

/** The id of the row for requests that belong to no turn. */
export const OUTSIDE_TURNS = "outside";

/** A harness-log entry as the server stores it (see host contract). */
export interface StoredLogEntry {
  key: string;
  sessionId: string;
  agentId: string | null;
  ts: number;
  model: string | null;
  tokens: Tokens;
}

export interface LogMergeContext {
  /** When the plugin first read this thread's events. */
  firstSeenAt: number | null;
  /** A harness-log backfill replaced the opening balance. */
  historyBackfilled: boolean;
  /** Partial gaps (a harness restart inside pruned events) that logs may fill. */
  partialGaps: { fromMs: number; toMs: number }[];
  /** For a fork: its creation time; entries before it are copied history. */
  forkCreatedAt: number | null;
}

export interface MergedLogs {
  /** Main-session entries from before first sight (replace the opening balance). */
  history: StoredLogEntry[];
  /** Main-session entries inside partial gaps. */
  gapFill: StoredLogEntry[];
  /** Subagent entries: always used. */
  subagent: StoredLogEntry[];
  /**
   * Main-session entries with cache writes, used only for the share of the
   * ledger's cache writes that were 1-hour ones, which bb's usage events do
   * not report.
   */
  cacheWrites: StoredLogEntry[];
}

/** Merges harness-log entries into turns; see docs/explanation/thread-usage-counting.md for the rule. */
export function mergeLogEntries(
  entries: readonly StoredLogEntry[],
  ctx: LogMergeContext,
): MergedLogs {
  const out: MergedLogs = { history: [], gapFill: [], subagent: [], cacheWrites: [] };
  for (const entry of entries) {
    if (ctx.forkCreatedAt !== null && entry.ts < ctx.forkCreatedAt) continue;
    if (entry.agentId !== null) {
      out.subagent.push(entry);
      continue;
    }
    if (ctx.historyBackfilled && ctx.firstSeenAt !== null && entry.ts < ctx.firstSeenAt) {
      out.history.push(entry);
    } else if (ctx.partialGaps.some((g) => entry.ts >= g.fromMs && entry.ts <= g.toMs)) {
      out.gapFill.push(entry);
    } else if (entry.tokens.cacheWrite > 0) {
      out.cacheWrites.push(entry);
    }
  }
  return out;
}

/**
 * Dollars by source. `gateway` and `harness` are always zero: another plugin
 * in this repository adds the three together for a fleet, so they stay.
 */
export interface CostBuckets {
  gateway: number;
  harness: number;
  estimate: number;
}

export const ZERO_COST: CostBuckets = { gateway: 0, harness: 0, estimate: 0 };

function addCost(a: CostBuckets, b: CostBuckets): CostBuckets {
  return {
    gateway: a.gateway + b.gateway,
    harness: a.harness + b.harness,
    estimate: a.estimate + b.estimate,
  };
}

function estimated(usd: number): CostBuckets {
  return { ...ZERO_COST, estimate: usd };
}

export { allTokensUnpriced, costTotal, figureTokenCount } from "./figure-math";
import { costTotal } from "./figure-math";

export interface ModelLine {
  model: string;
  tokens: Tokens;
  cost: CostBuckets;
  unpricedTokens: number;
}

export interface SubagentRow {
  agentId: string;
  model: string | null;
  tokens: Tokens;
  requests: number;
  costUsd: number;
}

/** One request of a turn that was charged at a tier. */
export type TieredRequest = PricedRequest & {
  /** The size its tier starts above. */
  tierAbove: number;
};

/**
 * What a turn's requests cost, for a turn with at least one request charged
 * at a tier: shown only on the turn the user opens.
 */
export interface TierDetail {
  /** Every request of the turn. */
  requests: number;
  /** The requests charged at a tier, in the order they were made. */
  tiered: TieredRequest[];
  /** The requests charged at the base rates, together. */
  untiered: { count: number; usd: number };
}

export interface TurnView {
  turnId: string;
  kind: "turn" | "opening" | "history" | "outside";
  startedAt: number | null;
  completedAt: number | null;
  status: string;
  model: string | null;
  prompt: string | null;
  tokens: Tokens;
  cost: CostBuckets;
  source: CostSource;
  unpricedTokens: number;
  /** Requests priced one by one; 0 where the turn's requests are not known one by one. */
  requests: number;
  subagents: SubagentRow[];
  linesAdded: number;
  linesRemoved: number;
  partial: boolean;
  /** A rate was assumed, or a tier could not be applied: see `tierUnsized`. */
  approximate: boolean;
  /** The model has a tier and the turn's per-request prompt sizes are unknown, so base rates were used. */
  tierUnsized: boolean;
  tierDetail: TierDetail | null;
  /** The 1-hour cache writes no request of the turn carries, as a line of their own; null when there are none. */
  oneHour: { tokens: number; usd: number } | null;
}

/** Aggregated figures for one thread or a whole tree. */
export interface Figure {
  tokens: Tokens;
  cost: CostBuckets;
  unpricedTokens: number;
  unpricedModels: string[];
  approximate: boolean;
  /** Some price assumed a cache or 1-hour write rate, apart from missing tier sizes. */
  assumedRates: boolean;
  /** Turns on a model with a tier that have no per-request prompt sizes. */
  unsizedTurns: number;
  wallMs: number;
  linesAdded: number;
  linesRemoved: number;
  turns: number;
  requests: number;
  partial: boolean;
  byModel: ModelLine[];
  /** Tokens and dollars per billing mode, for the mixed-mode headline. */
  byBilling: Record<BillingMode, { tokens: number; usd: number; cost: CostBuckets }>;
}

export function emptyFigure(): Figure {
  return {
    tokens: ZERO_TOKENS,
    cost: ZERO_COST,
    unpricedTokens: 0,
    unpricedModels: [],
    approximate: false,
    assumedRates: false,
    unsizedTurns: 0,
    wallMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    turns: 0,
    requests: 0,
    partial: false,
    byModel: [],
    byBilling: {
      "api-key": { tokens: 0, usd: 0, cost: ZERO_COST },
      subscription: { tokens: 0, usd: 0, cost: ZERO_COST },
      unknown: { tokens: 0, usd: 0, cost: ZERO_COST },
    },
  };
}

export interface ThreadUsageInput {
  turns: readonly TurnRecord[];
  logs: MergedLogs;
  prices: PriceBook;
  billing: BillingMode;
  now: number;
  /**
   * First sight of the thread. When log history replaced the opening
   * balance, turns that completed before it are counted by that history, so
   * their own surviving tokens are left out. A turn still running at first
   * sight reported its usage after it, so it stays in the ledger.
   */
  historyBefore?: number | null;
}

export interface ThreadUsage {
  figure: Figure;
  turns: TurnView[];
}

function modelKey(model: string | null): string {
  return model === null || model === "" ? "unknown" : model.replace(/\[[^\]]*\]$/, "");
}

class ModelTable {
  private readonly lines = new Map<string, ModelLine>();
  add(model: string | null, part: { tokens: Tokens; cost: CostBuckets; unpriced: number }) {
    const key = modelKey(model);
    const line = this.lines.get(key) ?? { model: key, tokens: ZERO_TOKENS, cost: ZERO_COST, unpricedTokens: 0 };
    this.lines.set(key, {
      model: key,
      tokens: addTokens(line.tokens, part.tokens),
      cost: addCost(line.cost, part.cost),
      unpricedTokens: line.unpricedTokens + part.unpriced,
    });
  }
  list(): ModelLine[] {
    return [...this.lines.values()]
      .filter((l) => totalTokens(l.tokens) > 0 || costTotal(l.cost) > 0)
      .sort((a, b) => costTotal(b.cost) - costTotal(a.cost) || totalTokens(b.tokens) - totalTokens(a.tokens));
  }
}

interface Estimate {
  usd: number;
  unpriced: number;
  approximate: boolean;
  /** The model has a tier and no prompt size was known. */
  unsized: boolean;
  /** A rate was assumed for a reason other than a missing prompt size. */
  assumed: boolean;
  unpricedModel: string | null;
  /** Requests priced one by one. */
  requests: number;
  tierDetail: TierDetail | null;
  oneHour: { tokens: number; usd: number } | null;
}

const NO_ESTIMATE: Estimate = {
  usd: 0,
  unpriced: 0,
  approximate: false,
  unsized: false,
  assumed: false,
  unpricedModel: null,
  requests: 0,
  tierDetail: null,
  oneHour: null,
};

function addEstimates(a: Estimate, b: Estimate): Estimate {
  return {
    usd: a.usd + b.usd,
    unpriced: a.unpriced + b.unpriced,
    approximate: a.approximate || b.approximate,
    unsized: a.unsized || b.unsized,
    assumed: a.assumed || b.assumed,
    unpricedModel: a.unpricedModel ?? b.unpricedModel,
    requests: a.requests + b.requests,
    tierDetail: null,
    oneHour: null,
  };
}

function unpricedEstimate(model: string | null, tokens: Tokens, requests: number): Estimate {
  return { ...NO_ESTIMATE, unpriced: totalTokens(tokens), unpricedModel: modelKey(model), requests };
}

/**
 * One request's tokens, or tokens summed over requests of unknown size when
 * `prompt` is null. A request carries its own 1-hour cache writes.
 */
function estimate(prices: PriceBook, model: string | null, tokens: Tokens, prompt: number | null): Estimate {
  if (totalTokens(tokens) === 0) return NO_ESTIMATE;
  const resolved = prices.lookup(model);
  if (resolved === null) return unpricedEstimate(model, tokens, prompt === null ? 0 : 1);
  const cost = costOf(tokens, resolved.price, prompt);
  return {
    ...NO_ESTIMATE,
    usd: cost.usd,
    approximate: cost.approximate,
    unsized: cost.unsized,
    assumed: cost.assumed,
    requests: prompt === null ? 0 : 1,
  };
}

/**
 * The requests of one turn, each priced on its own prompt size.
 * `unmatchedOneHour` is the turn-level share of 1-hour cache writes.
 */
function estimateRequests(
  prices: PriceBook,
  model: string | null,
  requests: readonly Tokens[],
  unmatchedOneHour: number,
): Estimate {
  const total = requests.reduce((acc, r) => addTokens(acc, r), ZERO_TOKENS);
  if (totalTokens(total) === 0) return NO_ESTIMATE;
  const resolved = prices.lookup(model);
  if (resolved === null) return unpricedEstimate(model, total, requests.length);
  const cost = priceRequests(requests, resolved.price, unmatchedOneHour);
  return {
    ...NO_ESTIMATE,
    usd: cost.usd,
    approximate: cost.approximate,
    assumed: cost.assumed,
    requests: requests.length,
    tierDetail: tierDetail(cost),
    oneHour: cost.oneHour,
  };
}

function tierDetail(cost: RequestsCost): TierDetail | null {
  const tiered = cost.requests.filter((r) => r.tierAbove !== null);
  if (tiered.length === 0) return null;
  const plain = cost.requests.filter((r) => r.tierAbove === null);
  return {
    requests: cost.requests.length,
    tiered: tiered.map((r) => ({ number: r.number, prompt: r.prompt, usd: r.usd, tierAbove: r.tierAbove as number })),
    untiered: { count: plain.length, usd: plain.reduce((n, r) => n + r.usd, 0) },
  };
}

/** A turn's stored requests as the tokens each carried; bb does not report their 1-hour writes. */
function requestTokens(requests: readonly RequestTokens[]): Tokens[] {
  return requests.map((r) => ({ ...ZERO_TOKENS, ...r }));
}

/** Entries are requests the log itself records, each with its own 1-hour writes. */
function estimateEntries(prices: PriceBook, fallback: string | null, entries: readonly StoredLogEntry[]): Estimate {
  const models = new Set(entries.map((e) => e.model ?? fallback));
  if (models.size === 1) {
    return estimateRequests(prices, [...models][0] ?? null, entries.map((e) => e.tokens), 0);
  }
  return entries.reduce<Estimate>(
    (acc, e) => addEstimates(acc, estimate(prices, e.model ?? fallback, e.tokens, promptTokens(e.tokens))),
    NO_ESTIMATE,
  );
}

function inWindow(ts: number, turn: TurnRecord, now: number): boolean {
  if (turn.startedAt === null) return false;
  return ts >= turn.startedAt && ts <= (turn.completedAt ?? now) + 30_000;
}

/**
 * Usage of one thread. Each turn's tokens are priced from models.dev, each
 * request on its own prompt size where the requests are known one by one, or
 * are unpriced.
 */
export function threadUsage(input: ThreadUsageInput): ThreadUsage {
  const { prices, now } = input;
  const models = new ModelTable();
  const unpricedModels = new Set<string>();
  let assumedAny = false;

  const realTurns = input.turns
    .filter((t) => t.kind === "turn")
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const opening = input.turns.find((t) => t.kind === "opening") ?? null;

  // Subagent and log entries by turn window; unmatched subagent entries join "outside".
  const subagentByTurn = new Map<string, StoredLogEntry[]>();
  const gapByTurn = new Map<string, StoredLogEntry[]>();
  const cacheWritesByTurn = new Map<string, StoredLogEntry[]>();
  const place = (map: Map<string, StoredLogEntry[]>, entry: StoredLogEntry) => {
    const turn = [...realTurns].reverse().find((t) => inWindow(entry.ts, t, now));
    const key = turn?.turnId ?? OUTSIDE_TURNS;
    map.set(key, [...(map.get(key) ?? []), entry]);
  };
  input.logs.subagent.forEach((e) => place(subagentByTurn, e));
  input.logs.gapFill.forEach((e) => place(gapByTurn, e));
  input.logs.cacheWrites.forEach((e) => place(cacheWritesByTurn, e));

  const views: TurnView[] = [];

  const subagentRows = (entries: StoredLogEntry[]) => {
    const byAgent = new Map<string, SubagentRow>();
    let cost = 0;
    let unpriced = 0;
    for (const e of entries) {
      const row = byAgent.get(e.agentId ?? "") ?? {
        agentId: e.agentId ?? "",
        model: e.model,
        tokens: ZERO_TOKENS,
        requests: 0,
        costUsd: 0,
      };
      row.tokens = addTokens(row.tokens, e.tokens);
      row.requests += 1;
      const est = estimate(prices, e.model, e.tokens, promptTokens(e.tokens));
      cost += est.usd;
      unpriced += est.unpriced;
      if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
      assumedAny ||= est.assumed;
      row.costUsd += est.usd;
      models.add(e.model, { tokens: e.tokens, cost: estimated(est.usd), unpriced: est.unpriced });
      byAgent.set(e.agentId ?? "", row);
    }
    return { rows: [...byAgent.values()], cost, unpriced };
  };

  // With log history, turns that completed before first sight take their
  // tokens from the history entries inside their windows.
  const isCovered = (t: TurnRecord) =>
    input.logs.history.length > 0 &&
    input.historyBefore != null &&
    t.completedAt !== null &&
    t.completedAt < input.historyBefore;
  const historyByTurn = new Map<string, StoredLogEntry[]>();
  const placedHistory = new Set<StoredLogEntry>();
  for (const e of input.logs.history) {
    const turn = [...realTurns].reverse().find((t) => isCovered(t) && inWindow(e.ts, t, now));
    if (turn === undefined) continue;
    historyByTurn.set(turn.turnId, [...(historyByTurn.get(turn.turnId) ?? []), e]);
    placedHistory.add(e);
  }

  for (const turn of realTurns) {
    const subagents = subagentByTurn.get(turn.turnId) ?? [];
    const coveredByHistory = isCovered(turn);
    // Entries that replace the turn's own tokens: log history, or a partial gap's entries.
    const gapEntries = coveredByHistory
      ? (historyByTurn.get(turn.turnId) ?? [])
      : turn.partial
        ? (gapByTurn.get(turn.turnId) ?? [])
        : [];
    let tokens = coveredByHistory ? ZERO_TOKENS : turn.tokens;
    if (!coveredByHistory && tokens.cacheWrite1h === 0) {
      // A share rather than a sum: a turn's first request can be logged just
      // before bb starts the turn, and so land in the previous turn's window.
      const written = (cacheWritesByTurn.get(turn.turnId) ?? []).reduce(
        (acc, e) => ({ all: acc.all + e.tokens.cacheWrite, oneHour: acc.oneHour + Math.min(e.tokens.cacheWrite1h, e.tokens.cacheWrite) }),
        { all: 0, oneHour: 0 },
      );
      if (written.oneHour > 0) {
        tokens = { ...tokens, cacheWrite1h: Math.round((tokens.cacheWrite * written.oneHour) / written.all) };
      }
    }
    let partial = turn.partial;
    if (gapEntries.length > 0) {
      tokens = gapEntries.reduce((acc, e) => addTokens(acc, e.tokens), ZERO_TOKENS);
      partial = false;
    }
    const subagentTokens = subagents.reduce((acc, e) => addTokens(acc, e.tokens), ZERO_TOKENS);

    let est: Estimate;
    if (gapEntries.length > 0) est = estimateEntries(prices, turn.model, gapEntries);
    else if (!coveredByHistory && turn.requests !== undefined && turn.requests.length > 0) {
      est = estimateRequests(prices, turn.model, requestTokens(turn.requests), tokens.cacheWrite1h);
    } else est = estimate(prices, turn.model, tokens, null);
    if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
    assumedAny ||= est.assumed;
    models.add(turn.model, { tokens, cost: estimated(est.usd), unpriced: est.unpriced });
    const sub = subagentRows(subagents);
    views.push(
      view(turn, {
        tokens: addTokens(tokens, subagentTokens),
        cost: estimated(est.usd + sub.cost),
        source: est.unpriced > 0 && est.usd === 0 ? "unpriced" : "estimate",
        unpriced: est.unpriced + sub.unpriced,
        requests: est.requests,
        subagents: sub.rows,
        partial,
        approximate: est.approximate,
        tierUnsized: est.unsized,
        tierDetail: est.tierDetail,
        oneHour: est.oneHour,
      }),
    );
  }

  // History from logs replaces the opening balance.
  // A turn that completed after first sight stays in the ledger, so history
  // entries inside its window would count twice.
  const history = input.logs.history.filter(
    (e) =>
      !placedHistory.has(e) &&
      !realTurns.some(
        (t) =>
          !(t.completedAt !== null && input.historyBefore != null && t.completedAt < input.historyBefore) &&
          inWindow(e.ts, t, now),
      ),
  );
  if (history.length > 0) {
    let tokens = ZERO_TOKENS;
    let est = NO_ESTIMATE;
    for (const e of history) {
      tokens = addTokens(tokens, e.tokens);
      const one = estimate(prices, e.model, e.tokens, promptTokens(e.tokens));
      est = addEstimates(est, one);
      if (one.unpricedModel !== null) unpricedModels.add(one.unpricedModel);
      models.add(e.model, { tokens: e.tokens, cost: estimated(one.usd), unpriced: one.unpriced });
    }
    assumedAny ||= est.assumed;
    const first = Math.min(...history.map((e) => e.ts));
    const last = Math.max(...history.map((e) => e.ts));
    views.unshift({
      turnId: "history",
      kind: "history",
      startedAt: first,
      completedAt: last,
      status: "completed",
      model: mostCommon(history.map((e) => e.model)),
      prompt: null,
      tokens,
      cost: estimated(est.usd),
      source: est.usd > 0 ? "estimate" : "unpriced",
      unpricedTokens: est.unpriced,
      requests: history.length,
      subagents: [],
      linesAdded: 0,
      linesRemoved: 0,
      partial: false,
      approximate: est.approximate,
      tierUnsized: false,
      tierDetail: null,
      oneHour: null,
    });
  } else if (opening !== null && input.logs.history.length === 0) {
    const est = estimate(prices, opening.model, opening.tokens, null);
    if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
    models.add(opening.model, { tokens: opening.tokens, cost: estimated(est.usd), unpriced: est.unpriced });
    assumedAny ||= est.assumed;
    views.unshift(
      view(opening, {
        tokens: opening.tokens,
        cost: estimated(est.usd),
        source: est.unpriced > 0 && est.usd === 0 ? "unpriced" : "estimate",
        unpriced: est.unpriced,
        requests: 0,
        subagents: [],
        partial: true,
        approximate: est.approximate,
        tierUnsized: est.unsized,
        tierDetail: null,
        oneHour: null,
      }),
    );
  }

  // Subagent requests that fall inside no turn.
  const outsideSubagents = subagentByTurn.get(OUTSIDE_TURNS) ?? [];
  if (outsideSubagents.length > 0) {
    const sub = subagentRows(outsideSubagents);
    const outsideModels = [...new Set(outsideSubagents.map((e) => e.model))];
    views.push({
      turnId: OUTSIDE_TURNS,
      kind: "outside",
      startedAt: null,
      completedAt: null,
      status: "completed",
      model: outsideModels.length === 1 ? (outsideModels[0] ?? null) : null,
      prompt: null,
      tokens: outsideSubagents.reduce((acc, e) => addTokens(acc, e.tokens), ZERO_TOKENS),
      cost: estimated(sub.cost),
      source: sub.unpriced > 0 && sub.cost === 0 ? "unpriced" : "estimate",
      unpricedTokens: sub.unpriced,
      requests: 0,
      subagents: sub.rows,
      linesAdded: 0,
      linesRemoved: 0,
      partial: false,
      approximate: false,
      tierUnsized: false,
      tierDetail: null,
      oneHour: null,
    });
  }

  const figure = emptyFigure();
  for (const v of views) {
    figure.tokens = addTokens(figure.tokens, v.tokens);
    figure.cost = addCost(figure.cost, v.cost);
    figure.unpricedTokens += v.unpricedTokens;
    figure.linesAdded += v.linesAdded;
    figure.linesRemoved += v.linesRemoved;
    figure.requests += v.requests;
    figure.partial ||= v.partial;
    figure.approximate ||= v.approximate;
    if (v.tierUnsized) figure.unsizedTurns += 1;
    if (v.kind === "turn") {
      figure.turns += 1;
      const record = realTurns.find((t) => t.turnId === v.turnId);
      if (record?.wallMs !== undefined) figure.wallMs += record.wallMs;
      else if (v.startedAt !== null) figure.wallMs += (v.completedAt ?? now) - v.startedAt;
    }
  }
  figure.assumedRates = assumedAny;
  figure.approximate ||= assumedAny;
  figure.unpricedModels = [...unpricedModels].sort();
  figure.byModel = models.list();
  figure.byBilling[input.billing] = {
    tokens: totalTokens(figure.tokens),
    usd: costTotal(figure.cost),
    cost: figure.cost,
  };
  return { figure, turns: views };
}

function view(
  turn: TurnRecord,
  v: {
    tokens: Tokens;
    cost: CostBuckets;
    source: CostSource;
    unpriced: number;
    requests: number;
    subagents: SubagentRow[];
    partial: boolean;
    approximate: boolean;
    tierUnsized: boolean;
    tierDetail: TierDetail | null;
    oneHour: { tokens: number; usd: number } | null;
  },
): TurnView {
  return {
    turnId: turn.turnId,
    kind: turn.kind,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    status: turn.status,
    model: turn.model,
    prompt: turn.prompt,
    tokens: v.tokens,
    cost: v.cost,
    source: v.source,
    unpricedTokens: v.unpriced,
    requests: v.requests,
    subagents: v.subagents,
    linesAdded: turn.linesAdded,
    linesRemoved: turn.linesRemoved,
    partial: v.partial,
    approximate: v.approximate,
    tierUnsized: v.tierUnsized,
    tierDetail: v.tierDetail,
    oneHour: v.oneHour,
  };
}

/** Adds figures (thread totals into a tree total). */
export function sumFigures(figures: readonly Figure[]): Figure {
  const out = emptyFigure();
  const models = new ModelTable();
  const unpriced = new Set<string>();
  for (const f of figures) {
    out.tokens = addTokens(out.tokens, f.tokens);
    out.cost = addCost(out.cost, f.cost);
    out.unpricedTokens += f.unpricedTokens;
    f.unpricedModels.forEach((m) => unpriced.add(m));
    out.approximate ||= f.approximate;
    out.assumedRates ||= f.assumedRates;
    out.unsizedTurns += f.unsizedTurns;
    out.wallMs += f.wallMs;
    out.linesAdded += f.linesAdded;
    out.linesRemoved += f.linesRemoved;
    out.turns += f.turns;
    out.requests += f.requests;
    out.partial ||= f.partial;
    for (const line of f.byModel) {
      models.add(line.model, { tokens: line.tokens, cost: line.cost, unpriced: line.unpricedTokens });
    }
    for (const mode of Object.keys(out.byBilling) as BillingMode[]) {
      out.byBilling[mode] = {
        tokens: out.byBilling[mode].tokens + f.byBilling[mode].tokens,
        usd: out.byBilling[mode].usd + f.byBilling[mode].usd,
        cost: addCost(out.byBilling[mode].cost, f.byBilling[mode].cost),
      };
    }
  }
  out.unpricedModels = [...unpriced].sort();
  out.byModel = models.list();
  return out;
}

export function hasAnyUsage(f: Figure): boolean {
  return f.turns > 0 || totalTokens(f.tokens) > 0 || costTotal(f.cost) > 0;
}

function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}
