/**
 * Turns the stored ledger, gateway rows and harness-log entries of one
 * thread into what the surfaces show (log merge, cost, reconciliation and
 * billing), and adds threads up into families.
 */
import type { BillingMode } from "./attribution";
import {
  assignRowsToTurns,
  isUnpricedRow,
  OUTSIDE_TURNS,
  type GatewayRow,
} from "./gateway";
import type { TurnRecord } from "./ledger";
import { costOf, type PriceBook } from "./pricing";
import {
  addTokens,
  promptTokens,
  totalTokens,
  ZERO_TOKENS,
  type Tokens,
} from "./tokens";

export type CostSource = "gateway" | "harness" | "estimate" | "unpriced";

/** A harness-log entry as the server stores it (see host contract). */
export interface StoredLogEntry {
  key: string;
  sessionId: string;
  agentId: string | null;
  ts: number;
  model: string | null;
  tokens: Tokens;
  costUsd: number | null;
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
  /** The harness records its own cost per message (pi). */
  harnessCost: boolean;
}

export interface MergedLogs {
  /** Main-session entries from before first sight (replace the opening balance). */
  history: StoredLogEntry[];
  /** Main-session entries inside partial gaps. */
  gapFill: StoredLogEntry[];
  /** Subagent entries: always used. */
  subagent: StoredLogEntry[];
  /** Main-session entries used for the harness's own cost only (tokens stay the ledger's). */
  costOnly: StoredLogEntry[];
}

/** Merges harness-log entries into turns; see docs/explanation/thread-usage-counting.md for the rule. */
export function mergeLogEntries(
  entries: readonly StoredLogEntry[],
  ctx: LogMergeContext,
): MergedLogs {
  const out: MergedLogs = { history: [], gapFill: [], subagent: [], costOnly: [] };
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
    } else if (ctx.harnessCost) {
      out.costOnly.push(entry);
    }
  }
  return out;
}

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

export { costTotal, figureTokenCount } from "./figure-math";
import { costTotal, figureTokenCount } from "./figure-math";

export interface ModelLine {
  model: string;
  tokens: Tokens;
  /** Gateway rows carry only prompt and completion counts. */
  gatewayTokens: number;
  cost: CostBuckets;
  unpricedTokens: number;
}

export interface SubagentRow {
  agentId: string;
  model: string | null;
  tokens: Tokens;
  requests: number;
  costUsd: number | null;
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
  requests: number;
  apiMs: number | null;
  subagents: SubagentRow[];
  linesAdded: number;
  linesRemoved: number;
  partial: boolean;
  approximate: boolean;
}

/** Aggregated figures for one thread or a whole family. */
export interface Figure {
  tokens: Tokens;
  /** Gateway tokens bb and the logs did not see. */
  untrackedTokens: number;
  cost: CostBuckets;
  unpricedTokens: number;
  unpricedModels: string[];
  approximate: boolean;
  /** Null when no gateway rows exist. */
  apiMs: number | null;
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
    untrackedTokens: 0,
    cost: ZERO_COST,
    unpricedTokens: 0,
    unpricedModels: [],
    approximate: false,
    apiMs: null,
    wallMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    turns: 0,
    requests: 0,
    partial: false,
    byModel: [],
    byBilling: {
      gateway: { tokens: 0, usd: 0, cost: ZERO_COST },
      "api-key": { tokens: 0, usd: 0, cost: ZERO_COST },
      subscription: { tokens: 0, usd: 0, cost: ZERO_COST },
      unknown: { tokens: 0, usd: 0, cost: ZERO_COST },
    },
  };
}

export interface ThreadUsageInput {
  turns: readonly TurnRecord[];
  rows: readonly GatewayRow[];
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
  /** Tokens bb and the logs missed, by reason (reconciliation). */
  reconciliation: { untrackedTokens: number } | null;
}

function modelKey(model: string | null): string {
  return model === null || model === "" ? "unknown" : model.replace(/\[[^\]]*\]$/, "");
}

class ModelTable {
  private readonly lines = new Map<string, ModelLine>();
  add(
    model: string | null,
    part: { tokens?: Tokens; gatewayTokens?: number; cost?: CostBuckets; unpriced?: number },
  ) {
    const key = modelKey(model);
    const line = this.lines.get(key) ?? {
      model: key,
      tokens: ZERO_TOKENS,
      gatewayTokens: 0,
      cost: ZERO_COST,
      unpricedTokens: 0,
    };
    this.lines.set(key, {
      model: key,
      tokens: part.tokens ? addTokens(line.tokens, part.tokens) : line.tokens,
      gatewayTokens: line.gatewayTokens + (part.gatewayTokens ?? 0),
      cost: part.cost ? addCost(line.cost, part.cost) : line.cost,
      unpricedTokens: line.unpricedTokens + (part.unpriced ?? 0),
    });
  }
  list(): ModelLine[] {
    return [...this.lines.values()]
      .filter((l) => totalTokens(l.tokens) + l.gatewayTokens > 0 || costTotal(l.cost) > 0)
      .sort(
      (a, b) =>
        costTotal(b.cost) - costTotal(a.cost) ||
        totalTokens(b.tokens) + b.gatewayTokens - (totalTokens(a.tokens) + a.gatewayTokens),
    );
  }
}

interface Estimate {
  usd: number;
  unpriced: number;
  approximate: boolean;
  unpricedModel: string | null;
}

function estimate(
  prices: PriceBook,
  model: string | null,
  tokens: Tokens,
  requestPrompt: number | null,
): Estimate {
  if (totalTokens(tokens) === 0) {
    return { usd: 0, unpriced: 0, approximate: false, unpricedModel: null };
  }
  const resolved = prices.lookup(model);
  if (resolved === null) {
    return {
      usd: 0,
      unpriced: totalTokens(tokens),
      approximate: false,
      unpricedModel: modelKey(model),
    };
  }
  const cost = costOf(tokens, resolved.price, requestPrompt);
  return { usd: cost.usd, unpriced: 0, approximate: cost.approximate, unpricedModel: null };
}

function inWindow(ts: number, turn: TurnRecord, now: number): boolean {
  if (turn.startedAt === null) return false;
  return ts >= turn.startedAt && ts <= (turn.completedAt ?? now) + 30_000;
}

/**
 * Usage of one thread. Each turn takes its cost from the most trusted
 * source: gateway rows in its window, else the harness's own cost, else an
 * estimate, else unpriced.
 */
export function threadUsage(input: ThreadUsageInput): ThreadUsage {
  const { prices, now } = input;
  const models = new ModelTable();
  const unpricedModels = new Set<string>();
  let approximateAny = false;

  const realTurns = input.turns
    .filter((t) => t.kind === "turn")
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const opening = input.turns.find((t) => t.kind === "opening") ?? null;
  const windows = realTurns
    .filter((t) => t.startedAt !== null)
    .map((t) => ({
      turnId: t.turnId,
      startedAt: t.startedAt as number,
      completedAt: t.completedAt,
    }));
  const rowsByTurn = assignRowsToTurns(input.rows, windows, now);

  // Subagent and log entries by turn window; unmatched subagent rows join "outside".
  const subagentByTurn = new Map<string, StoredLogEntry[]>();
  const gapByTurn = new Map<string, StoredLogEntry[]>();
  const costByTurn = new Map<string, StoredLogEntry[]>();
  const place = (map: Map<string, StoredLogEntry[]>, entry: StoredLogEntry) => {
    const turn = [...realTurns].reverse().find((t) => inWindow(entry.ts, t, now));
    const key = turn?.turnId ?? OUTSIDE_TURNS;
    map.set(key, [...(map.get(key) ?? []), entry]);
  };
  input.logs.subagent.forEach((e) => place(subagentByTurn, e));
  input.logs.gapFill.forEach((e) => place(gapByTurn, e));
  input.logs.costOnly.forEach((e) => place(costByTurn, e));

  const views: TurnView[] = [];
  let knownTokensInGatewayTurns = 0;

  const subagentRows = (entries: StoredLogEntry[], priced: boolean) => {
    const byAgent = new Map<string, SubagentRow>();
    let cost = 0;
    let unpriced = 0;
    for (const e of entries) {
      const row = byAgent.get(e.agentId ?? "") ?? {
        agentId: e.agentId ?? "",
        model: e.model,
        tokens: ZERO_TOKENS,
        requests: 0,
        costUsd: priced ? 0 : null,
      };
      row.tokens = addTokens(row.tokens, e.tokens);
      row.requests += 1;
      if (priced) {
        const est = estimate(prices, e.model, e.tokens, promptTokens(e.tokens));
        cost += est.usd;
        unpriced += est.unpriced;
        if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
        approximateAny ||= est.approximate;
        row.costUsd = (row.costUsd ?? 0) + est.usd;
        models.add(e.model, { tokens: e.tokens, cost: { ...ZERO_COST, estimate: est.usd }, unpriced: est.unpriced });
      } else {
        models.add(e.model, { tokens: e.tokens });
      }
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
    const rows = rowsByTurn.get(turn.turnId) ?? [];
    const subagents = subagentByTurn.get(turn.turnId) ?? [];
    const coveredByHistory = isCovered(turn);
    // Entries that replace the turn's own tokens: log history, or a partial gap's entries.
    const gapEntries = coveredByHistory
      ? (historyByTurn.get(turn.turnId) ?? [])
      : turn.partial
        ? (gapByTurn.get(turn.turnId) ?? [])
        : [];
    const fromLogs = coveredByHistory || gapEntries.length > 0;
    let tokens = coveredByHistory ? ZERO_TOKENS : turn.tokens;
    let partial = turn.partial;
    if (gapEntries.length > 0) {
      tokens = gapEntries.reduce((acc, e) => addTokens(acc, e.tokens), ZERO_TOKENS);
      partial = false;
    }
    let cost = ZERO_COST;
    let source: CostSource;
    let unpriced = 0;
    let approximate = false;
    let apiMs: number | null = null;
    const subagentTokens = subagents.reduce((acc, e) => addTokens(acc, e.tokens), ZERO_TOKENS);

    if (rows.length > 0) {
      source = "gateway";
      let spend = 0;
      for (const row of rows) {
        const rowTokens = row.promptTokens + row.completionTokens;
        if (isUnpricedRow(row)) {
          unpriced += rowTokens;
          unpricedModels.add(modelKey(row.model));
          models.add(row.model, { gatewayTokens: rowTokens, unpriced: rowTokens });
        } else {
          spend += row.spend;
          models.add(row.model, { gatewayTokens: rowTokens, cost: { ...ZERO_COST, gateway: row.spend } });
        }
        if (row.durationMs !== null) apiMs = (apiMs ?? 0) + row.durationMs;
      }
      cost = { ...ZERO_COST, gateway: spend };
      if (spend === 0 && unpriced > 0) source = "unpriced";
      knownTokensInGatewayTurns +=
        promptTokens(tokens) + tokens.output + promptTokens(subagentTokens) + subagentTokens.output;
      const sub = subagentRows(subagents, false);
      // The gateway's billed model wins over the requested one.
      const billed = [...new Set(rows.map((r) => r.model).filter((m): m is string => m !== null))];
      views.push(view(turn, { tokens: addTokens(tokens, subagentTokens), cost, source, unpriced, requests: rows.length, apiMs, subagents: sub.rows, partial, approximate, model: billed.length === 1 ? billed[0] : undefined }));
      continue;
    }

    const harnessEntries = (fromLogs ? gapEntries : (costByTurn.get(turn.turnId) ?? [])).filter(
      (e) => e.costUsd !== null,
    );
    if (harnessEntries.length > 0) {
      let usd = 0;
      for (const e of harnessEntries) {
        if ((e.costUsd ?? 0) <= 0 && e.tokens.output > 0) {
          unpriced += totalTokens(e.tokens);
          unpricedModels.add(modelKey(e.model));
        } else {
          usd += e.costUsd ?? 0;
        }
      }
      cost = { ...ZERO_COST, harness: usd };
      source = usd === 0 && unpriced > 0 ? "unpriced" : "harness";
      models.add(turn.model, { tokens, cost, unpriced });
    } else {
      // Gap-filled turns price per request, so tiers apply there.
      const useGap = gapEntries.length > 0;
      const est = useGap
        ? gapEntries.reduce<Estimate>(
            (acc, e) => {
              const one = estimate(prices, e.model ?? turn.model, e.tokens, promptTokens(e.tokens));
              return {
                usd: acc.usd + one.usd,
                unpriced: acc.unpriced + one.unpriced,
                approximate: acc.approximate || one.approximate,
                unpricedModel: acc.unpricedModel ?? one.unpricedModel,
              };
            },
            { usd: 0, unpriced: 0, approximate: false, unpricedModel: null },
          )
        : estimate(prices, turn.model, tokens, null);
      cost = { ...ZERO_COST, estimate: est.usd };
      unpriced = est.unpriced;
      approximate = est.approximate;
      if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
      source = unpriced > 0 && est.usd === 0 ? "unpriced" : "estimate";
      models.add(turn.model, { tokens, cost, unpriced });
    }
    const sub = subagentRows(subagents, true);
    cost = { ...cost, estimate: cost.estimate + sub.cost };
    unpriced += sub.unpriced;
    approximateAny ||= approximate;
    views.push(
      view(turn, {
        tokens: addTokens(tokens, subagentTokens),
        cost,
        source,
        unpriced,
        requests: 0,
        apiMs: null,
        subagents: sub.rows,
        partial,
        approximate,
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
    let est: Estimate = { usd: 0, unpriced: 0, approximate: false, unpricedModel: null };
    let harness = 0;
    for (const e of history) {
      tokens = addTokens(tokens, e.tokens);
      if (e.costUsd !== null && e.costUsd > 0) {
        harness += e.costUsd;
        models.add(e.model, { tokens: e.tokens, cost: { ...ZERO_COST, harness: e.costUsd } });
        continue;
      }
      const one = estimate(prices, e.model, e.tokens, promptTokens(e.tokens));
      est = {
        usd: est.usd + one.usd,
        unpriced: est.unpriced + one.unpriced,
        approximate: est.approximate || one.approximate,
        unpricedModel: est.unpricedModel ?? one.unpricedModel,
      };
      if (one.unpricedModel !== null) unpricedModels.add(one.unpricedModel);
      models.add(e.model, { tokens: e.tokens, cost: { ...ZERO_COST, estimate: one.usd }, unpriced: one.unpriced });
    }
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
      cost: { ...ZERO_COST, harness, estimate: est.usd },
      source: harness > 0 ? "harness" : est.usd > 0 ? "estimate" : "unpriced",
      unpricedTokens: est.unpriced,
      requests: history.length,
      apiMs: null,
      subagents: [],
      linesAdded: 0,
      linesRemoved: 0,
      partial: false,
      approximate: est.approximate,
    });
  } else if (opening !== null && input.logs.history.length === 0) {
    const est = estimate(prices, opening.model, opening.tokens, null);
    if (est.unpricedModel !== null) unpricedModels.add(est.unpricedModel);
    models.add(opening.model, { tokens: opening.tokens, cost: { ...ZERO_COST, estimate: est.usd }, unpriced: est.unpriced });
    approximateAny ||= est.approximate;
    views.unshift(
      view(opening, {
        tokens: opening.tokens,
        cost: { ...ZERO_COST, estimate: est.usd },
        source: est.unpriced > 0 && est.usd === 0 ? "unpriced" : "estimate",
        unpriced: est.unpriced,
        requests: 0,
        apiMs: null,
        subagents: [],
        partial: true,
        approximate: est.approximate,
      }),
    );
  }

  // Requests outside every turn: gateway rows and subagent entries.
  const outsideRows = rowsByTurn.get(OUTSIDE_TURNS) ?? [];
  const outsideSubagents = subagentByTurn.get(OUTSIDE_TURNS) ?? [];
  if (outsideRows.length > 0 || outsideSubagents.length > 0) {
    let spend = 0;
    let unpriced = 0;
    let apiMs: number | null = null;
    for (const row of outsideRows) {
      const rowTokens = row.promptTokens + row.completionTokens;
      if (isUnpricedRow(row)) {
        unpriced += rowTokens;
        unpricedModels.add(modelKey(row.model));
        models.add(row.model, { gatewayTokens: rowTokens, unpriced: rowTokens });
      } else {
        spend += row.spend;
        models.add(row.model, { gatewayTokens: rowTokens, cost: { ...ZERO_COST, gateway: row.spend } });
      }
      if (row.durationMs !== null) apiMs = (apiMs ?? 0) + row.durationMs;
    }
    const sub = subagentRows(outsideSubagents, outsideRows.length === 0);
    // Gateway rows carry only prompt and completion counts; the prompt side
    // is shown as input.
    const rowTokens = outsideRows.reduce(
      (acc, r) => addTokens(acc, { ...ZERO_TOKENS, input: r.promptTokens, output: r.completionTokens }),
      ZERO_TOKENS,
    );
    const subTokens = outsideSubagents.reduce((acc, e) => addTokens(acc, e.tokens), rowTokens);
    const outsideModels = [...new Set([...outsideRows.map((r) => r.model), ...outsideSubagents.map((e) => e.model)])];
    views.push({
      turnId: OUTSIDE_TURNS,
      kind: "outside",
      startedAt: null,
      completedAt: null,
      status: "completed",
      model: outsideModels.length === 1 ? (outsideModels[0] ?? null) : null,
      prompt: null,
      tokens: subTokens,
      cost: { ...ZERO_COST, gateway: spend, estimate: sub.cost },
      source: outsideRows.length > 0 ? "gateway" : "estimate",
      unpricedTokens: unpriced + sub.unpriced,
      requests: outsideRows.length,
      apiMs,
      subagents: sub.rows,
      linesAdded: 0,
      linesRemoved: 0,
      partial: false,
      approximate: false,
    });
  }

  // Reconciliation: gateway tokens beyond what bb and the logs saw.
  const gatewayTokens = input.rows.reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
  const outsideGatewayTokens = outsideRows.reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);
  // Outside-turn rows already count in the Outside turns view.
  const untracked =
    input.rows.length === 0 ? 0 : Math.max(0, gatewayTokens - outsideGatewayTokens - knownTokensInGatewayTurns);

  const figure = emptyFigure();
  for (const v of views) {
    figure.tokens = addTokens(figure.tokens, v.tokens);
    figure.cost = addCost(figure.cost, v.cost);
    figure.unpricedTokens += v.unpricedTokens;
    if (v.apiMs !== null) figure.apiMs = (figure.apiMs ?? 0) + v.apiMs;
    figure.linesAdded += v.linesAdded;
    figure.linesRemoved += v.linesRemoved;
    figure.requests += v.requests;
    figure.partial ||= v.partial;
    figure.approximate ||= v.approximate;
    if (v.kind === "turn") {
      figure.turns += 1;
      const record = realTurns.find((t) => t.turnId === v.turnId);
      if (record?.wallMs !== undefined) figure.wallMs += record.wallMs;
      else if (v.startedAt !== null) figure.wallMs += (v.completedAt ?? now) - v.startedAt;
    }
  }
  figure.approximate ||= approximateAny;
  figure.untrackedTokens = untracked;
  figure.unpricedModels = [...unpricedModels].sort();
  figure.byModel = models.list();
  const usd = costTotal(figure.cost);
  figure.byBilling[input.billing] = {
    tokens: totalTokens(figure.tokens) + untracked,
    usd,
    cost: figure.cost,
  };
  return {
    figure,
    turns: views,
    reconciliation: untracked > 0 ? { untrackedTokens: untracked } : null,
  };
}

function view(
  turn: TurnRecord,
  v: {
    tokens: Tokens;
    cost: CostBuckets;
    source: CostSource;
    unpriced: number;
    requests: number;
    apiMs: number | null;
    subagents: SubagentRow[];
    partial: boolean;
    approximate: boolean;
    /** Overrides the turn's requested model (the gateway's billed model). */
    model?: string;
  },
): TurnView {
  return {
    turnId: turn.turnId,
    kind: turn.kind,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    status: turn.status,
    model: v.model ?? turn.model,
    prompt: turn.prompt,
    tokens: v.tokens,
    cost: v.cost,
    source: v.source,
    unpricedTokens: v.unpriced,
    requests: v.requests,
    apiMs: v.apiMs,
    subagents: v.subagents,
    linesAdded: turn.linesAdded,
    linesRemoved: turn.linesRemoved,
    partial: v.partial,
    approximate: v.approximate,
  };
}

/** Adds figures (thread totals into a family total). */
export function sumFigures(figures: readonly Figure[]): Figure {
  const out = emptyFigure();
  const models = new ModelTable();
  const unpriced = new Set<string>();
  for (const f of figures) {
    out.tokens = addTokens(out.tokens, f.tokens);
    out.untrackedTokens += f.untrackedTokens;
    out.cost = addCost(out.cost, f.cost);
    out.unpricedTokens += f.unpricedTokens;
    f.unpricedModels.forEach((m) => unpriced.add(m));
    out.approximate ||= f.approximate;
    if (f.apiMs !== null) out.apiMs = (out.apiMs ?? 0) + f.apiMs;
    out.wallMs += f.wallMs;
    out.linesAdded += f.linesAdded;
    out.linesRemoved += f.linesRemoved;
    out.turns += f.turns;
    out.requests += f.requests;
    out.partial ||= f.partial;
    for (const line of f.byModel) {
      models.add(line.model, {
        tokens: line.tokens,
        gatewayTokens: line.gatewayTokens,
        cost: line.cost,
        unpriced: line.unpricedTokens,
      });
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
  return f.turns > 0 || figureTokenCount(f) > 0 || costTotal(f.cost) > 0;
}

function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}
