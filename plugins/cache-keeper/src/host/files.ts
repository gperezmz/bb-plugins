/**
 * Reads Claude Code's files on this machine: a session's transcript at
 * `<root>/<cwd slug>/<sessionId>.jsonl`, a background command's output at
 * `<tmp>/claude-<uid>/<cwd slug>/<sessionId>/tasks/<id>.output`, and a
 * subagent's transcript at `<root>/<cwd slug>/<sessionId>/subagents/agent-<id>.jsonl`.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptFold, type ReportTurn, type TranscriptFacts, type TranscriptRequest } from "../core/transcript.js";

export interface Roots {
  /** Claude Code's `projects` directories, most likely first. */
  projects: string[];
  /** Where Claude Code may write background output, `<tmp>/claude-<uid>`: under `$TMPDIR` when set, else `/tmp`. */
  tasks: string[];
}

export function resolveRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): Roots {
  const config = env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : [join(home, ".claude"), join(home, ".config", "claude")];
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const tmps = [...new Set([env.TMPDIR ?? tmpdir(), "/tmp"])];
  return { projects: config.map((d) => join(d, "projects")), tasks: tmps.map((t) => join(t, `claude-${uid}`)) };
}

const exists = async (path: string) => (await stat(path).catch(() => null)) !== null;

/** One transcript read so far: the fold over its complete lines and where they end. */
interface Cursor {
  path: string;
  offset: number;
  fold: TranscriptFold;
}

const CHUNK = 1 << 20;

/** Folds transcripts incrementally, reading only what was appended since the last call. */
export class TranscriptReader {
  private readonly cursors = new Map<string, Cursor>();

  constructor(private readonly roots: Roots) {}

  async locate(sessionId: string): Promise<{ path: string; cwdSlug: string } | null> {
    const known = this.cursors.get(sessionId);
    if (known !== undefined && (await exists(known.path))) {
      return { path: known.path, cwdSlug: slugOf(known.path) };
    }
    for (const root of this.roots.projects) {
      const dirs = await readdir(root).catch(() => [] as string[]);
      for (const dir of dirs) {
        const path = join(root, dir, `${sessionId}.jsonl`);
        if (await exists(path)) return { path, cwdSlug: dir };
      }
    }
    return null;
  }

  async read(
    sessionId: string,
    requestsSince: number | null,
  ): Promise<{ found: boolean; cwdSlug: string | null; facts: TranscriptFacts; requests: TranscriptRequest[]; reports: ReportTurn[] }> {
    const located = await this.locate(sessionId);
    if (located === null) return { found: false, cwdSlug: null, facts: new TranscriptFold().result(), requests: [], reports: [] };
    let cursor = this.cursors.get(sessionId);
    const size = (await stat(located.path)).size;
    if (cursor === undefined || cursor.path !== located.path || size < cursor.offset) {
      cursor = { path: located.path, offset: 0, fold: new TranscriptFold() };
      this.cursors.set(sessionId, cursor);
    }
    await this.advance(cursor, size);
    return {
      found: true,
      cwdSlug: located.cwdSlug,
      facts: cursor.fold.result(),
      requests: requestsSince === null ? [] : cursor.fold.requestsSince(requestsSince),
      reports: cursor.fold.reportTurns(),
    };
  }

  private async advance(cursor: Cursor, size: number): Promise<void> {
    if (size <= cursor.offset) return;
    const handle = await open(cursor.path, "r");
    try {
      let carry = "";
      let position = cursor.offset;
      while (position < size) {
        const buffer = Buffer.alloc(Math.min(CHUNK, size - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        const text = carry + buffer.subarray(0, bytesRead).toString("utf8");
        const lines = text.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          cursor.offset += Buffer.byteLength(line, "utf8") + 1;
          feed(cursor.fold, line);
        }
      }
      // A last line without its newline may still be being written; it is read next time.
    } finally {
      await handle.close();
    }
  }
}

function feed(fold: TranscriptFold, line: string): void {
  if (line.trim() === "") return;
  try {
    const value: unknown = JSON.parse(line);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) fold.add(value as Record<string, unknown>);
  } catch {
    // A torn or foreign line says nothing about the cache.
  }
}

function slugOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 2] ?? "";
}

/** When a background command last printed: its output file's modification time. */
export async function commandActivity(roots: Roots, cwdSlug: string, sessionId: string, id: string) {
  const paths = roots.tasks.map((t) => join(t, cwdSlug, sessionId, "tasks", `${id}.output`));
  for (const outputFile of paths) {
    const info = await stat(outputFile).catch(() => null);
    if (info !== null) return { id, outputFile, changedAt: info.mtimeMs };
  }
  return { id, outputFile: paths[0]!, changedAt: null };
}

const TAIL = 256 * 1024;

/** A subagent's last tool, from the end of its transcript. */
export async function subagentActivity(roots: Roots, cwdSlug: string, sessionId: string, id: string) {
  for (const root of roots.projects) {
    const path = join(root, cwdSlug, sessionId, "subagents", `agent-${id}.jsonl`);
    const info = await stat(path).catch(() => null);
    if (info === null) continue;
    const handle = await open(path, "r");
    try {
      const length = Math.min(TAIL, info.size);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, info.size - length);
      return { id, lastTool: lastToolIn(buffer.toString("utf8")), changedAt: info.mtimeMs };
    } finally {
      await handle.close();
    }
  }
  return { id, lastTool: null, changedAt: null };
}

/** The name of the last `tool_use` block in a run of transcript lines. */
export function lastToolIn(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"tool_use"')) continue;
    try {
      const value = JSON.parse(line) as { message?: { content?: unknown } };
      const content = value.message?.content;
      if (!Array.isArray(content)) continue;
      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j] as { type?: unknown; name?: unknown };
        if (block?.type === "tool_use" && typeof block.name === "string") return block.name;
      }
    } catch {
      // The first line of the tail is usually cut; older lines are further up.
    }
  }
  return null;
}
