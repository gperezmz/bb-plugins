/**
 * Codex logs: `<root>/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl`. Each
 * line is `{"timestamp","type","payload"}`. A request is an `event_msg` whose
 * `payload.type` is `token_count` with `payload.info.last_token_usage`; the
 * model is the latest `turn_context` line's `payload.model`.
 *
 * Codex's `input_tokens` includes the cached (and cache-write) tokens, so they
 * are subtracted to match the other harnesses' disjoint `input`. Codex
 * re-emits `token_count` (e.g. for rate-limit updates) with unchanged totals;
 * those repeats are not new requests, so an event whose
 * `total_token_usage.total_tokens` equals the previous one's is skipped.
 *
 * NOTE: written from the Codex source (`codex-rs/protocol`), not verified
 * against a real rollout file.
 */
import { basename } from "node:path";
import type { LogEntry } from "./contract.js";
import {
  inWindow,
  num,
  readJsonl,
  rec,
  str,
  toMs,
  walkJsonl,
  type TimeWindow,
} from "./files.js";

export async function locateCodexSessions(
  roots: string[],
  sessionIds: string[],
  signal: AbortSignal,
): Promise<Map<string, string[]>> {
  const bySession = new Map<string, string[]>(sessionIds.map((id) => [id, []]));
  for (const root of roots) {
    for (const path of await walkJsonl(root, signal)) {
      const name = basename(path);
      if (!name.startsWith("rollout-")) continue;
      for (const id of sessionIds) {
        if (name.endsWith(`-${id}.jsonl`)) bySession.get(id)!.push(path);
      }
    }
  }
  return bySession;
}

export async function parseCodexFile(
  path: string,
  sessionId: string,
  window: TimeWindow,
  signal: AbortSignal,
): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  const fileKey = basename(path, ".jsonl").replace(/^rollout-/, "");
  let model: string | null = null;
  let previousTotal: number | null = null;
  const wanted = (l: string) => l.includes('"token_count"') || l.includes('"turn_context"');

  for await (const { lineNo, value } of readJsonl(path, signal, wanted)) {
    const payload = rec(value.payload);
    if (value.type === "turn_context") {
      model = str(payload.model) ?? model;
      continue;
    }
    if (value.type !== "event_msg" || payload.type !== "token_count") continue;

    const info = rec(payload.info);
    const last = rec(info.last_token_usage);
    if (Object.keys(last).length === 0) continue;

    const total = rec(info.total_token_usage).total_tokens;
    if (typeof total === "number") {
      if (total === previousTotal) continue;
      previousTotal = total;
    }

    const ts = toMs(value.timestamp);
    if (ts === null || !inWindow(ts, window)) continue;

    const cacheRead = num(last.cached_input_tokens);
    const cacheWrite = num(last.cache_write_input_tokens);
    entries.push({
      key: `${fileKey}:${lineNo}`,
      sessionId,
      agentId: null,
      ts,
      model,
      tokens: {
        input: Math.max(0, num(last.input_tokens) - cacheRead - cacheWrite),
        output: num(last.output_tokens),
        cacheRead,
        cacheWrite,
        cacheWrite1h: 0,
        reasoning: num(last.reasoning_output_tokens),
      },
      costUsd: null,
    });
  }
  return entries;
}
