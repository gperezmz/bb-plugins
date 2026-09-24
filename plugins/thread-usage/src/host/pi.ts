/**
 * pi logs: `<root>/--<cwd>--/<timestamp>_<sessionId>.jsonl`. The first line is
 * a `{"type":"session","id":<sessionId>}` header; each assistant turn is a
 * `{"type":"message","id","timestamp","message":{"role":"assistant","model",
 * "usage":{input,output,cacheRead,cacheWrite,reasoning?,cacheWrite1h?,cost}}}`
 * line. pi prices the request itself, so `costUsd` is `usage.cost.total`.
 */
import { join } from "node:path";
import type { LogEntry } from "./contract.js";
import { LogCache, type LineSpec } from "./log-cache.js";
import {
  inWindow,
  listDir,
  num,
  rec,
  str,
  toMs,
  type TimeWindow,
} from "./files.js";

export async function locatePiSession(
  roots: string[],
  sessionId: string,
  bridgeRoots: string[] = [],
): Promise<string[]> {
  const out: string[] = [];
  // bb's pi bridge names the file after the session id itself.
  for (const root of bridgeRoots) {
    if ((await listDir(root)).includes(`${sessionId}.jsonl`)) out.push(join(root, `${sessionId}.jsonl`));
  }
  const suffix = `_${sessionId}.jsonl`;
  for (const root of roots) {
    for (const dir of await listDir(root)) {
      for (const name of await listDir(join(root, dir))) {
        if (name.endsWith(suffix)) out.push(join(root, dir, name));
      }
    }
  }
  return out.sort();
}

/** Names {@link toEntry} in the host's log cache: change it when `toEntry` changes, so cached entries are read again. */
const PI_PARSER = "pi@1";

export async function parsePiFile(
  path: string,
  sessionId: string,
  window: TimeWindow,
  signal: AbortSignal,
  cache: LogCache | null = null,
): Promise<LogEntry[]> {
  const spec: LineSpec = { kind: PI_PARSER, needle: '"usage"', lastPerKey: false, parse: (value, lineNo) => toEntry(value, lineNo, sessionId) };
  const entries = await (cache ?? new LogCache(null)).read(spec, path, sessionId, signal);
  return entries.filter((e) => inWindow(e.ts, window));
}

function toEntry(value: Record<string, unknown>, lineNo: number, sessionId: string): LogEntry | null {
  if (value.type !== "message") return null;
  const message = rec(value.message);
  const usage = rec(message.usage);
  if (message.role !== "assistant" || Object.keys(usage).length === 0) return null;

  const tokens = {
    input: num(usage.input),
    output: num(usage.output),
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
    cacheWrite1h: num(usage.cacheWrite1h),
    reasoning: num(usage.reasoning),
  };
  const total = rec(usage.cost).total;
  const costUsd = typeof total === "number" && Number.isFinite(total) ? total : null;
  // Aborted turns are logged with all-zero usage; they carry nothing to count.
  if (Object.values(tokens).every((n) => n === 0) && !costUsd) return null;

  const ts = toMs(value.timestamp) ?? toMs(message.timestamp);
  if (ts === null) return null;

  const key = str(value.id) ?? `${sessionId}:${lineNo}`;
  return { key, sessionId, agentId: null, ts, model: str(message.model), tokens, costUsd };
}

export async function readPiSession(
  roots: string[],
  sessionId: string,
  window: TimeWindow,
  signal: AbortSignal,
  bridgeRoots: string[] = [],
  cache: LogCache | null = null,
): Promise<{ found: boolean; entries: LogEntry[] }> {
  const files = await locatePiSession(roots, sessionId, bridgeRoots);
  const entries: LogEntry[] = [];
  for (const path of files) entries.push(...(await parsePiFile(path, sessionId, window, signal, cache)));
  return { found: files.length > 0, entries };
}
