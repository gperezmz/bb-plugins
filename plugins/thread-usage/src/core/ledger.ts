/**
 * The plugin's own ledger of turn records, built from bb thread events
 *. Pure: the server loads state, calls {@link ingestEvents}, and
 * writes back what it returns.
 */
import {
  addTokens,
  fromBbBreakdown,
  scaleTokens,
  subtractTokens,
  ZERO_TOKENS,
  type BbTokenBreakdown,
  type Tokens,
} from "./tokens";

/** Event types the ledger reads. */
export const LEDGER_EVENT_TYPES = [
  "thread/tokenUsage/updated",
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
  "item/completed",
  "thread/identity",
  "provider/modelFallback",
  "provider/rateLimits/updated",
  "provider.env-resolved",
] as const;

/** bb prunes usage snapshots once they are this many sequence numbers old… */
export const PRUNE_MIN_SEQ = 250;
/** …and this old. */
export const PRUNE_MIN_MS = 30_000;

/** The subset of a bb thread event the ledger reads. */
export interface LedgerEvent {
  seq: number;
  createdAt: number;
  type: string;
  scope: { kind: "thread" } | { kind: "turn"; turnId: string };
  data: unknown;
}

export type TurnStatus = "running" | "completed" | "failed" | "interrupted";

/**
 * One turn record. `kind` is "turn" for real turns and "opening" for the
 * synthetic opening balance of a thread first seen with history.
 */
export interface TurnRecord {
  turnId: string;
  kind: "turn" | "opening";
  startedAt: number | null;
  completedAt: number | null;
  status: TurnStatus;
  model: string | null;
  /** First line of the prompt that started the turn. */
  prompt: string | null;
  tokens: Tokens;
  usageEvents: number;
  linesAdded: number;
  linesRemoved: number;
  fileChanges: number;
  /** Tokens are incomplete: pruned events after a harness restart, or an opening balance. */
  partial: boolean;
  /** Tokens were filled from bb's running total rather than read per turn. */
  filled: boolean;
  firstSeq: number;
  /** Wall time when it is not `completedAt - startedAt` (a collapsed record). */
  wallMs?: number;
}

export interface PendingRequest {
  model: string | null;
  prompt: string | null;
  at: number;
}

export interface RoutingFact {
  name: string;
  source: string;
  /** Null when bb masked the value. */
  value: string | null;
}

export type RateLimitKind = "subscription-window" | "spend-control" | "credits" | "unknown";

/** Per-thread cursor state kept between reads. */
export interface LedgerCursor {
  lastSeq: number;
  /** bb's cumulative `total` at the last usage event read, or null before any. */
  lastTotal: Tokens | null;
  firstSeenAt: number | null;
  /** Requests sent but not yet matched to a turn, by client request id. */
  pending: Record<string, PendingRequest>;
  /** Harness session ids from `thread/identity`, oldest first. */
  sessionIds: string[];
  routing: RoutingFact[];
  rateLimitKind: RateLimitKind | null;
  lastModel: string | null;
}

export const EMPTY_CURSOR: LedgerCursor = {
  lastSeq: 0,
  lastTotal: null,
  firstSeenAt: null,
  pending: {},
  sessionIds: [],
  routing: [],
  rateLimitKind: null,
  lastModel: null,
};

export interface GapReport {
  /** Turns whose usage was pruned. */
  turnIds: string[];
  fromMs: number;
  toMs: number;
  /** "filled": spread from bb's total; "partial": a harness restart fell inside, backfill needed. */
  resolution: "filled" | "partial";
}

export interface IngestResult {
  cursor: LedgerCursor;
  /** Turn records created or changed, keyed by turn id. */
  turns: Map<string, TurnRecord>;
  gaps: GapReport[];
  /** True when this read produced an opening balance. */
  opened: boolean;
}

export interface IngestInput {
  cursor: LedgerCursor;
  /** Existing records for turns this batch touches (others need not be loaded). */
  turns: ReadonlyMap<string, TurnRecord>;
  /** Events after `cursor.lastSeq`, ascending by seq. */
  events: readonly LedgerEvent[];
  /**
   * Sequence number the read is complete through: the thread's latest
   * sequence when every page was read. Becomes the next cursor.
   */
  latestSeq: number;
  now: number;
}

export const OPENING_TURN_ID = "opening";

function newTurn(turnId: string, seq: number): TurnRecord {
  return {
    turnId,
    kind: "turn",
    startedAt: null,
    completedAt: null,
    status: "running",
    model: null,
    prompt: null,
    tokens: ZERO_TOKENS,
    usageEvents: 0,
    linesAdded: 0,
    linesRemoved: 0,
    fileChanges: 0,
    partial: false,
    filled: false,
    firstSeq: seq,
  };
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** First non-empty line of the text inputs, at most 160 characters. */
export function promptFirstLine(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  for (const block of input) {
    const text = str(obj(block).text);
    if (text === null) continue;
    // bb prefixes messages it sends on a thread's behalf with a "[bb system]" line.
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    // …and a message relayed from another thread with "[bb message from thread:<id>]".
    const first = lines[0]?.trim() ?? "";
    const relayed = /^\[bb message from thread:([^\]]+)\]$/.exec(first);
    const prefix = first === "[bb system]" ? "bb" : relayed !== null ? `from ${relayed[1]}` : null;
    const line =
      prefix === null
        ? lines[0]
        : lines[1] === undefined
          ? `${prefix} message`
          : `${prefix}: ${lines[1].trim()}`;
    if (line !== undefined) {
      const trimmed = line.trim();
      return trimmed.length > 160 ? `${trimmed.slice(0, 159)}…` : trimmed;
    }
  }
  return null;
}

/**
 * A slimmer copy of an event for batching: fileChange diffs become line
 * counts and prompts become their first line.
 */
export function slimEvent(event: LedgerEvent): LedgerEvent {
  const data = obj(event.data);
  if (event.type === "item/completed") {
    const item = obj(data.item);
    if (item.type !== "fileChange") return { ...event, data: { item: { type: item.type } } };
    let added = 0;
    let removed = 0;
    for (const change of Array.isArray(item.changes) ? item.changes : []) {
      const diff = str(obj(change).diff);
      if (diff === null) continue;
      const counted = countDiffLines(diff);
      added += counted.added;
      removed += counted.removed;
    }
    return { ...event, data: { item: { type: "fileChange", lineCounts: { added, removed } } } };
  }
  if (event.type === "client/turn/requested") {
    const prompt = promptFirstLine(data.input);
    return {
      ...event,
      data: {
        requestId: data.requestId,
        execution: { model: obj(data.execution).model },
        input: prompt === null ? [] : [{ type: "text", text: prompt }],
      },
    };
  }
  if (event.type === "provider.env-resolved") {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return {
      ...event,
      data: { entries: entries.filter((e) => /BASE_URL$/.test(str(obj(e).name) ?? "")) },
    };
  }
  return event;
}

/** Lines added and removed in a unified diff, headers excluded. */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

function breakdown(value: unknown): BbTokenBreakdown | null {
  const b = obj(value);
  if (typeof b.totalTokens !== "number") return null;
  return {
    totalTokens: b.totalTokens,
    inputTokens: typeof b.inputTokens === "number" ? b.inputTokens : 0,
    cachedInputTokens: typeof b.cachedInputTokens === "number" ? b.cachedInputTokens : 0,
    ...(typeof b.cacheReadInputTokens === "number"
      ? { cacheReadInputTokens: b.cacheReadInputTokens }
      : {}),
    ...(typeof b.cacheWriteInputTokens === "number"
      ? { cacheWriteInputTokens: b.cacheWriteInputTokens }
      : {}),
    outputTokens: typeof b.outputTokens === "number" ? b.outputTokens : 0,
    reasoningOutputTokens:
      typeof b.reasoningOutputTokens === "number" ? b.reasoningOutputTokens : 0,
  };
}

function totalsDecreased(before: Tokens, after: Tokens): boolean {
  return (
    after.output < before.output ||
    after.input < before.input ||
    after.cacheRead < before.cacheRead ||
    after.cacheWrite < before.cacheWrite
  );
}

/**
 * Applies a batch of events to the ledger.
 *
 * Tokens come from each usage event's `last`, summed per turn, which stays
 * right across harness restarts. When usage events were pruned (the batch
 * spans at least {@link PRUNE_MIN_SEQ} sequence numbers and a completed turn
 * older than {@link PRUNE_MIN_MS} has none), the gap is filled from bb's
 * `total` if no `thread/identity` event fell inside it, and marked partial
 * otherwise. A first read whose history is incomplete (a completed turn has
 * no usage event) turns the surviving snapshot's `total` into an opening
 * balance instead.
 */
export function ingestEvents(input: IngestInput): IngestResult {
  const cursor: LedgerCursor = {
    ...input.cursor,
    pending: { ...input.cursor.pending },
    sessionIds: [...input.cursor.sessionIds],
    routing: [...input.cursor.routing],
  };
  const firstRead = cursor.firstSeenAt === null;
  if (firstRead) cursor.firstSeenAt = input.now;
  const changed = new Map<string, TurnRecord>();
  const gaps: GapReport[] = [];
  const turn = (turnId: string, seq: number): TurnRecord => {
    const existing = changed.get(turnId) ?? input.turns.get(turnId);
    const record = existing !== undefined ? { ...existing } : newTurn(turnId, seq);
    changed.set(turnId, record);
    return record;
  };

  // Usage events whose `last` was added in this batch, and completions seen.
  const usageTurns = new Set<string>();
  const completed: { turnId: string; at: number; seq: number }[] = [];
  const identitySeqs: number[] = [];
  let latestUsage: { seq: number; total: Tokens; turnId: string | null } | null = null;
  let lastsInBatch = ZERO_TOKENS;
  // Lasts read since the latest harness start: the part of bb's total they explain.
  let lastsSinceIdentity = ZERO_TOKENS;

  for (const event of input.events) {
    if (event.seq <= input.cursor.lastSeq) continue;
    const data = obj(event.data);
    const turnId = event.scope.kind === "turn" ? event.scope.turnId : null;
    switch (event.type) {
      case "client/turn/requested": {
        const requestId = str(data.requestId);
        if (requestId === null) break;
        const model = str(obj(data.execution).model);
        cursor.pending[requestId] = {
          model,
          prompt: promptFirstLine(data.input),
          at: event.createdAt,
        };
        if (model !== null) cursor.lastModel = model;
        break;
      }
      case "turn/input/accepted": {
        if (turnId === null) break;
        const requestId = str(data.clientRequestId);
        const request = requestId === null ? undefined : cursor.pending[requestId];
        const record = turn(turnId, event.seq);
        if (request !== undefined) {
          if (record.model === null) record.model = request.model;
          if (record.prompt === null) record.prompt = request.prompt;
          delete cursor.pending[requestId as string];
        }
        break;
      }
      case "turn/started": {
        if (turnId === null) break;
        const record = turn(turnId, event.seq);
        record.startedAt = event.createdAt;
        if (record.model === null) record.model = cursor.lastModel;
        break;
      }
      case "turn/completed": {
        if (turnId === null) break;
        const record = turn(turnId, event.seq);
        record.completedAt = event.createdAt;
        const status = str(data.status);
        record.status =
          status === "failed" || status === "interrupted" ? status : "completed";
        if (record.startedAt === null) record.startedAt = event.createdAt;
        completed.push({ turnId, at: event.createdAt, seq: event.seq });
        break;
      }
      case "provider/modelFallback": {
        const fallback = str(data.fallbackModel);
        if (turnId !== null && fallback !== null) turn(turnId, event.seq).model = fallback;
        break;
      }
      case "thread/tokenUsage/updated": {
        const usage = obj(data.tokenUsage);
        const last = breakdown(usage.last);
        const total = breakdown(usage.total);
        if (total !== null) {
          latestUsage = { seq: event.seq, total: fromBbBreakdown(total), turnId };
        }
        if (last === null || turnId === null) break;
        const lastTokens = fromBbBreakdown(last);
        const record = turn(turnId, event.seq);
        record.tokens = addTokens(record.tokens, lastTokens);
        record.usageEvents += 1;
        usageTurns.add(turnId);
        lastsInBatch = addTokens(lastsInBatch, lastTokens);
        lastsSinceIdentity = addTokens(lastsSinceIdentity, lastTokens);
        break;
      }
      case "item/completed": {
        const item = obj(data.item);
        if (item.type !== "fileChange" || turnId === null) break;
        const record = turn(turnId, event.seq);
        record.fileChanges += 1;
        const counts = obj(item.lineCounts);
        if (typeof counts.added === "number" && typeof counts.removed === "number") {
          record.linesAdded += counts.added;
          record.linesRemoved += counts.removed;
          break;
        }
        const changes = Array.isArray(item.changes) ? item.changes : [];
        for (const change of changes) {
          const diff = str(obj(change).diff);
          if (diff === null) continue;
          const counted = countDiffLines(diff);
          record.linesAdded += counted.added;
          record.linesRemoved += counted.removed;
        }
        break;
      }
      case "thread/identity": {
        identitySeqs.push(event.seq);
        lastsSinceIdentity = ZERO_TOKENS;
        const id = str(data.providerThreadId);
        if (id !== null && !cursor.sessionIds.includes(id)) cursor.sessionIds.push(id);
        break;
      }
      case "provider/rateLimits/updated": {
        const kind = str(obj(data.rateLimits).kind);
        if (
          kind === "subscription-window" ||
          kind === "spend-control" ||
          kind === "credits" ||
          kind === "unknown"
        ) {
          // An "unknown" report never replaces a known kind.
          if (kind !== "unknown" || cursor.rateLimitKind === null) cursor.rateLimitKind = kind;
        }
        break;
      }
      case "provider.env-resolved": {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        cursor.routing = entries.flatMap((entry): RoutingFact[] => {
          const e = obj(entry);
          const name = str(e.name);
          if (name === null || !/BASE_URL$/.test(name)) return [];
          const source = e.source;
          const sourceLabel =
            source === "shell"
              ? "shell"
              : typeof obj(source).plugin === "string"
                ? `plugin:${obj(source).plugin as string}`
                : typeof obj(source).core === "string"
                  ? `core:${obj(source).core as string}`
                  : "unknown";
          return [{ name, source: sourceLabel, value: str(e.value) }];
        });
        break;
      }
    }
  }

  let opened = false;
  const historyComplete = completed.every(
    (c) => usageTurns.has(c.turnId) || (input.turns.get(c.turnId)?.usageEvents ?? 0) > 0,
  );
  if (firstRead && !historyComplete) {
    // Opening balance: some usage events were pruned before first sight.
    // Turns keep the lasts that survived; bb's total, minus the lasts it
    // already explains (those since the latest harness start), stands in for
    // the pruned ones. It carries the partial flag until a backfill replaces it.
    const snapshot = latestUsage as { total: Tokens } | null;
    if (snapshot !== null) {
      const opening = newTurn(OPENING_TURN_ID, 0);
      opening.kind = "opening";
      opening.status = "completed";
      opening.tokens = subtractTokens(snapshot.total, lastsSinceIdentity);
      opening.partial = true;
      opening.model = cursor.lastModel;
      const firstStart = [...changed.values()]
        .map((t) => t.startedAt)
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b)[0];
      opening.startedAt = firstStart ?? null;
      opening.completedAt = input.now;
      changed.set(OPENING_TURN_ID, opening);
      opened = true;
    }
  } else if (!firstRead) {
    const span = input.latestSeq - input.cursor.lastSeq;
    const missing = completed.filter(
      (c) =>
        !usageTurns.has(c.turnId) &&
        (input.turns.get(c.turnId)?.usageEvents ?? 0) === 0 &&
        span >= PRUNE_MIN_SEQ &&
        input.now - c.at >= PRUNE_MIN_MS,
    );
    if (missing.length > 0) {
      const fromMs = Math.min(
        ...missing.map((m) => changed.get(m.turnId)?.startedAt ?? m.at),
      );
      const toMs = Math.max(...missing.map((m) => m.at));
      const latest = latestUsage as { seq: number; total: Tokens } | null;
      // Any restart between the cursor and the surviving snapshot reset bb's
      // total, so `total - stored total` no longer measures the gap.
      const restarted = identitySeqs.some((s) => latest === null || s <= latest.seq);
      const base = input.cursor.lastTotal;
      const canFill =
        !restarted && latest !== null && base !== null && !totalsDecreased(base, latest.total);
      if (canFill) {
        const gapTokens = subtractTokens(
          subtractTokens((latest as { total: Tokens }).total, base as Tokens),
          lastsInBatch,
        );
        const share = 1 / missing.length;
        for (const m of missing) {
          const record = turn(m.turnId, m.seq);
          record.tokens = addTokens(record.tokens, scaleTokens(gapTokens, share));
          record.filled = true;
        }
      } else {
        for (const m of missing) turn(m.turnId, m.seq).partial = true;
      }
      gaps.push({
        turnIds: missing.map((m) => m.turnId),
        fromMs,
        toMs,
        resolution: canFill ? "filled" : "partial",
      });
    }
  }

  const finalUsage = latestUsage as { total: Tokens } | null;
  if (finalUsage !== null) cursor.lastTotal = finalUsage.total;
  cursor.lastSeq = Math.max(
    input.cursor.lastSeq,
    input.latestSeq,
    ...input.events.map((e) => e.seq),
  );
  // Requests older than a day never matched a turn; drop them.
  for (const [id, request] of Object.entries(cursor.pending)) {
    if (input.now - request.at > 86_400_000) delete cursor.pending[id];
  }
  return { cursor, turns: changed, gaps, opened };
}
