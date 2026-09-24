/**
 * Synthetic builders shared by the core and server tests. Ids, paths and
 * hosts are made up.
 */
import type { LedgerEvent, TurnRecord } from "../../src/core/ledger";
import type { GatewayRow } from "../../src/core/gateway";
import type { StoredLogEntry } from "../../src/core/summary";
import { ZERO_TOKENS, type Tokens } from "../../src/core/tokens";

export const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);
export const SEC = 1000;
export const MIN = 60 * SEC;

export function tokens(partial: Partial<Tokens>): Tokens {
  return { ...ZERO_TOKENS, ...partial };
}

/** A Claude-style bb breakdown: input is uncached, total = input + cached + output. */
export function claudeBreakdown(t: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) {
  const cacheRead = t.cacheRead ?? 0;
  const cacheWrite = t.cacheWrite ?? 0;
  return {
    totalTokens: t.input + cacheRead + cacheWrite + t.output,
    inputTokens: t.input,
    cachedInputTokens: cacheRead + cacheWrite,
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: t.output,
    reasoningOutputTokens: 0,
  };
}

type Scope = string | null;

export function ev(seq: number, createdAt: number, type: string, turnId: Scope, data: unknown = {}): LedgerEvent {
  return {
    seq,
    createdAt,
    type,
    scope: turnId === null ? { kind: "thread" } : { kind: "turn", turnId },
    data,
  };
}

export type B = ReturnType<typeof claudeBreakdown>;

export const usage = (seq: number, at: number, turnId: string, last: B, total: B) =>
  ev(seq, at, "thread/tokenUsage/updated", turnId, { tokenUsage: { last, total } });

export const requested = (seq: number, at: number, requestId: string, model: string, text = "do the thing") =>
  ev(seq, at, "client/turn/requested", null, {
    requestId,
    execution: { model },
    input: [{ type: "text", text }],
  });

export const accepted = (seq: number, at: number, turnId: string, requestId: string) =>
  ev(seq, at, "turn/input/accepted", turnId, { clientRequestId: requestId });

export const started = (seq: number, at: number, turnId: string) => ev(seq, at, "turn/started", turnId);

export const completed = (seq: number, at: number, turnId: string, status = "completed") =>
  ev(seq, at, "turn/completed", turnId, { status });

export const identity = (seq: number, at: number, providerThreadId: string) =>
  ev(seq, at, "thread/identity", null, { providerThreadId });

export const fileChange = (seq: number, at: number, turnId: string, diffs: string[]) =>
  ev(seq, at, "item/completed", turnId, {
    item: { type: "fileChange", changes: diffs.map((diff, i) => ({ path: `src/f${i}.ts`, diff })) },
  });

export function turnRecord(partial: Partial<TurnRecord> & { turnId: string }): TurnRecord {
  return {
    kind: "turn",
    startedAt: null,
    completedAt: null,
    status: "completed",
    model: null,
    prompt: null,
    tokens: ZERO_TOKENS,
    usageEvents: 1,
    linesAdded: 0,
    linesRemoved: 0,
    fileChanges: 0,
    partial: false,
    filled: false,
    firstSeq: 1,
    ...partial,
  };
}

export function gatewayRow(partial: Partial<GatewayRow> & { requestId: string; startTime: number }): GatewayRow {
  return {
    threadId: "thr_alpha",
    endTime: null,
    model: "claude-opus-5-5",
    promptTokens: 1000,
    completionTokens: 100,
    spend: 0.01,
    durationMs: 1500,
    status: "success",
    ...partial,
  };
}

export function logEntry(partial: Partial<StoredLogEntry> & { key: string; ts: number }): StoredLogEntry {
  return {
    sessionId: "sess-main",
    agentId: null,
    model: "claude-opus-5-5",
    tokens: tokens({ input: 100, output: 10 }),
    costUsd: null,
    ...partial,
  };
}
