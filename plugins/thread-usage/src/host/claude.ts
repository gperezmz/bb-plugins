/**
 * Claude Code logs: `<root>/<project-slug>/<sessionId>.jsonl`, with subagents
 * in `<root>/<project-slug>/<sessionId>/subagents/agent-<id>.jsonl`.
 *
 * One API response is written as several assistant lines (one per content
 * block) that share `message.id` and `requestId`. Streaming means the early
 * lines can carry partial `output_tokens`; the last line has the final count
 * (verified on real logs: the last line held the maximum in every
 * multi-line response checked, and the input-side counts never differed), so
 * each `(message.id, requestId)` yields one entry from its last line.
 */
import { basename, dirname, join } from "node:path";
import type { LogEntry } from "./contract.js";
import { LogCache, type LineSpec } from "./log-cache.js";
import {
  inWindow,
  isFile,
  listDir,
  num,
  rec,
  str,
  toMs,
  type TimeWindow,
} from "./files.js";

/** Names {@link toEntry} in the host's log cache: change it when `toEntry` changes, so cached entries are read again. */
const CLAUDE_PARSER = "claude@1";

export interface ClaudeFiles {
  main: string[];
  /** Subagent files with the agent id taken from `agent-<id>.jsonl`. */
  subagents: { path: string; agentId: string }[];
  /**
   * Files in a directory the remembered location did not name: they may
   * have appeared while it was trusted, so their entries are read whole.
   */
  appeared?: Set<string>;
}

export async function locateClaudeSession(
  roots: string[],
  sessionId: string,
  cache: LogCache | null = null,
): Promise<ClaudeFiles> {
  // Searching every project directory is most of a small read (hundreds on a
  // busy machine), so where a session was found, or that it was found
  // nowhere, is remembered for a few minutes.
  const known = await cache?.location(sessionId);
  if (known != null && known.fresh) {
    if (known.dirs.length === 0) return { main: [], subagents: [] };
    const found = await filesIn(known.dirs, sessionId);
    if (found.main.length + found.subagents.length > 0) {
      if (known.appeared.length > 0) found.appeared = new Set(known.appeared);
      return found;
    }
  }
  const dirs: string[] = [];
  for (const root of roots) {
    for (const project of await listDir(root)) dirs.push(join(root, project));
  }
  const found = await filesIn(dirs, sessionId);
  if (known != null) {
    const before = new Set(known.dirs);
    found.appeared = new Set(
      [...found.main, ...found.subagents.map((s) => s.path)].filter((p) => !before.has(projectDirOf(p, sessionId))),
    );
  }
  if (cache !== null) await cache.setLocation(sessionId, found.dirs, [...(found.appeared ?? [])]);
  return found;
}

/** The project directory of a main (`<dir>/<id>.jsonl`) or subagent (`<dir>/<id>/subagents/…`) file. */
function projectDirOf(path: string, sessionId: string): string {
  const marker = `/${sessionId}/subagents/`;
  const at = path.lastIndexOf(marker);
  return at === -1 ? dirname(path) : path.slice(0, at);
}

async function filesIn(dirs: string[], sessionId: string): Promise<ClaudeFiles & { dirs: string[] }> {
  const found: ClaudeFiles & { dirs: string[] } = { main: [], subagents: [], dirs: [] };
  for (const dir of dirs) {
    let hit = false;
    const main = join(dir, `${sessionId}.jsonl`);
    if (await isFile(main)) {
      found.main.push(main);
      hit = true;
    }
    const subDir = join(dir, sessionId, "subagents");
    for (const name of (await listDir(subDir)).sort()) {
      const m = /^agent-(.+)\.jsonl$/.exec(name);
      if (m) {
        found.subagents.push({ path: join(subDir, name), agentId: m[1]! });
        hit = true;
      }
    }
    if (hit) found.dirs.push(dir);
  }
  return found;
}

function toEntry(
  line: Record<string, unknown>,
  file: string,
  lineNo: number,
  sessionId: string,
  agentId: string | null,
): LogEntry | null {
  if (line.type !== "assistant") return null;
  const message = rec(line.message);
  const usage = rec(message.usage);
  const model = str(message.model);
  if (model === "<synthetic>" || Object.keys(usage).length === 0) return null;
  const ts = toMs(line.timestamp);
  if (ts === null) return null;

  const id = str(message.id);
  const requestId = str(line.requestId);
  const creation = rec(usage.cache_creation);
  const write5m = num(creation.ephemeral_5m_input_tokens);
  const write1h = num(creation.ephemeral_1h_input_tokens);
  return {
    key: id && requestId ? `${id}:${requestId}` : `${basename(file)}:${lineNo}`,
    sessionId,
    agentId,
    ts,
    model,
    tokens: {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens) || write5m + write1h,
      cacheWrite1h: write1h,
      reasoning: num(rec(usage.output_tokens_details).thinking_tokens),
    },
    costUsd: null,
  };
}

/** Entries of one Claude Code log file, deduplicated, inside `window`. */
export async function parseClaudeFile(
  path: string,
  sessionId: string,
  agentId: string | null,
  window: TimeWindow,
  signal: AbortSignal,
  cache: LogCache | null = null,
): Promise<LogEntry[]> {
  const spec: LineSpec = {
    kind: CLAUDE_PARSER,
    needle: '"usage"',
    lastPerKey: true, // last line of a response wins
    parse: (value, lineNo) => toEntry(value, path, lineNo, sessionId, agentId ?? str(value.agentId)),
  };
  const entries = await (cache ?? new LogCache(null)).read(spec, path, `${sessionId}\0${agentId ?? ""}`, signal);
  return entries.filter((e) => inWindow(e.ts, window));
}

export async function readClaudeSession(
  roots: string[],
  sessionId: string,
  includeSubagents: boolean,
  window: TimeWindow,
  signal: AbortSignal,
  cache: LogCache | null = null,
): Promise<{ found: boolean; entries: LogEntry[] }> {
  const files = await locateClaudeSession(roots, sessionId, cache);
  const subagents = includeSubagents ? files.subagents : [];
  // A file that appeared while a remembered location hid it is read without
  // the incremental lower bound: that bound is the server's clock minus an
  // overlap, and this machine's clock may be behind it. The server keeps
  // entries by key, so the older ones cost nothing twice.
  const windowOf = (path: string): TimeWindow =>
    files.appeared?.has(path) === true && window.untilMs === null ? { sinceMs: null, untilMs: null } : window;
  const entries: LogEntry[] = [];
  for (const path of files.main) {
    entries.push(...(await parseClaudeFile(path, sessionId, null, windowOf(path), signal, cache)));
  }
  for (const { path, agentId } of subagents) {
    entries.push(...(await parseClaudeFile(path, sessionId, agentId, windowOf(path), signal, cache)));
  }
  return { found: files.main.length + files.subagents.length > 0, entries };
}
