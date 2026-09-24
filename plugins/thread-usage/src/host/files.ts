/** Filesystem helpers shared by the harness log parsers. */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { LogEntry } from "./contract.js";

export type Tokens = LogEntry["tokens"];

/** Half-open `[sinceMs, untilMs)` window; null bounds are open. */
export interface TimeWindow {
  sinceMs: number | null;
  untilMs: number | null;
}

export const inWindow = (ts: number, w: TimeWindow): boolean =>
  (w.sinceMs === null || ts >= w.sinceMs) && (w.untilMs === null || ts < w.untilMs);

/** Where each harness keeps its session logs; Claude Code has two candidates. */
export interface LogRoots {
  claude: string[];
  pi: string[];
  /** bb's pi bridge keeps its sessions here, named `<providerThreadId>.jsonl`. */
  piBridge: string[];
  codex: string[];
}

export function resolveRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): LogRoots {
  const claudeDirs = env.CLAUDE_CONFIG_DIR
    ? [env.CLAUDE_CONFIG_DIR]
    : [join(home, ".config", "claude"), join(home, ".claude")];
  return {
    claude: claudeDirs.map((d) => join(d, "projects")),
    pi: [join(env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent"), "sessions")],
    piBridge: [join(env.BB_DATA_DIR ?? join(home, ".bb"), "pi-bridge-sessions")],
    codex: [join(env.CODEX_HOME ?? join(home, ".codex"), "sessions")],
  };
}

export interface JsonlLine {
  /** 1-based line number within the file. */
  lineNo: number;
  value: Record<string, unknown>;
}

/**
 * Streams the JSON object lines of a file. Lines failing `prefilter` are
 * skipped before parsing (cheap for 100 MB logs); unparsable lines (e.g. one
 * still being written) are skipped. A missing file yields nothing.
 */
export async function* readJsonl(
  path: string,
  signal: AbortSignal,
  prefilter: (line: string) => boolean = () => true,
): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of rl) {
      lineNo++;
      if (lineNo % 256 === 0) signal.throwIfAborted();
      if (!line || !prefilter(line)) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        yield { lineNo, value: value as Record<string, unknown> };
      }
    }
    signal.throwIfAborted();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** A session id becomes part of a path, so it must not be able to leave its directory. */
export const isSafeSessionId = (id: string): boolean =>
  id.length > 0 && id !== "." && id !== ".." && !/[\\/\0]/.test(id);

export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Every `.jsonl` file below `dir`, depth-first in name order. */
export async function walkJsonl(dir: string, signal: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  const visit = async (d: string): Promise<void> => {
    signal.throwIfAborted();
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await visit(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  await visit(dir);
  return out;
}

/** Non-negative finite number, else 0. */
export const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Epoch ms from an ISO string or an epoch-ms number; null if neither parses. */
export function toMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export const compareEntries = (a: LogEntry, b: LogEntry): number =>
  a.ts - b.ts ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
  (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
  (a.agentId ?? "").localeCompare(b.agentId ?? "");
