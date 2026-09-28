/**
 * Reads Claude Code's files on this machine: a session's transcript at
 * `<root>/<cwd slug>/<sessionId>.jsonl`, a background command's output at
 * `<tmp>/claude-<uid>/<cwd slug>/<sessionId>/tasks/<id>.output`, and a
 * subagent's transcript at `<root>/<cwd slug>/<sessionId>/subagents/agent-<id>.jsonl`.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptFold, type TranscriptCursor, type TranscriptFacts, type TranscriptRequest } from "../core/transcript.js";

export type { TranscriptCursor };

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

export interface TranscriptRead {
  found: boolean;
  cwdSlug: string | null;
  cursor: TranscriptCursor | null;
  facts: TranscriptFacts;
  /** The requests in the bytes read by this call, oldest first. */
  requests: TranscriptRequest[];
  /** Bytes read by this call. */
  bytesRead: number;
  /** Why the transcript could not be read or parsed; null when it could. */
  unreadable: string | null;
}

const CHUNK = 1 << 20;
/** The requests a read returns: the most recent this many, enough for any one turn Cache Keeper charges. */
const KEEP_REQUESTS = 200;

/** Finds `<root>/<cwd slug>/<sessionId>.jsonl`, trying the slug the cursor names first. */
export async function locate(roots: Roots, sessionId: string, slug: string | null): Promise<{ path: string; cwdSlug: string } | null> {
  if (slug !== null) {
    for (const root of roots.projects) {
      const path = join(root, slug, `${sessionId}.jsonl`);
      if (await exists(path)) return { path, cwdSlug: slug };
    }
  }
  for (const root of roots.projects) {
    const dirs = await readdir(root).catch(() => [] as string[]);
    for (const dir of dirs) {
      const path = join(root, dir, `${sessionId}.jsonl`);
      if (await exists(path)) return { path, cwdSlug: dir };
    }
  }
  return null;
}

/**
 * Reads a session's transcript on from `cursor`: only the bytes appended
 * since, unless the file is another one (its inode changed) or shorter than
 * the cursor, when it is read from the start. `toClock` puts its wall times on
 * the plugin's clock.
 */
export async function readTranscript(
  roots: Roots,
  sessionId: string,
  cursor: TranscriptCursor | null,
  toClock: (wall: number) => number = (wall) => wall,
): Promise<TranscriptRead> {
  const located = await locate(roots, sessionId, cursor?.cwdSlug ?? null);
  const empty = new TranscriptFold().result();
  if (located === null) return { found: false, cwdSlug: null, cursor: null, facts: empty, requests: [], bytesRead: 0, unreadable: null };
  let handle;
  try {
    handle = await open(located.path, "r");
  } catch (error) {
    return { found: true, cwdSlug: located.cwdSlug, cursor, facts: cursor?.fold.facts ?? empty, requests: [], bytesRead: 0, unreadable: messageOf(error) };
  }
  try {
    const info = await handle.stat();
    const same = cursor !== null && cursor.cwdSlug === located.cwdSlug && cursor.ino === info.ino && info.size >= cursor.offset;
    const fold = new TranscriptFold(KEEP_REQUESTS, toClock, same ? cursor.fold : null);
    let offset = same ? cursor.offset : 0;
    const start = offset;
    let parsed = 0;
    let broken = 0;
    let carry = "";
    let position = offset;
    while (position < info.size) {
      const buffer = Buffer.alloc(Math.min(CHUNK, info.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const lines = (carry + buffer.subarray(0, bytesRead).toString("utf8")).split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        offset += Buffer.byteLength(line, "utf8") + 1;
        const outcome = feed(fold, line);
        if (outcome === "parsed") parsed++;
        else if (outcome === "broken") broken++;
      }
    }
    // A last line without its newline may still be being written; it is read next time.
    const next: TranscriptCursor = { cwdSlug: located.cwdSlug, ino: info.ino, offset, fold: fold.state() };
    return {
      found: true,
      cwdSlug: located.cwdSlug,
      cursor: next,
      facts: fold.result(),
      requests: fold.requestsSince(-Infinity),
      bytesRead: offset - start,
      unreadable: parsed === 0 && broken > 0 ? `no line of the ${broken} read parses as JSON` : null,
    };
  } catch (error) {
    return { found: true, cwdSlug: located.cwdSlug, cursor, facts: cursor?.fold.facts ?? empty, requests: [], bytesRead: 0, unreadable: messageOf(error) };
  } finally {
    await handle.close();
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Whether a line can say anything about the cache: a request's usage, a
 * compaction, or a message typed as the user. A tool result, however long,
 * says nothing, and most of a transcript's bytes are tool results, so they
 * are left unparsed.
 */
export function worthParsing(line: string): boolean {
  if (line.includes('"usage"') || line.includes('"compact_boundary"')) return true;
  if (line.includes('"tool_result"')) return false;
  return /"type"\s*:\s*"user"/.test(line);
}

function feed(fold: TranscriptFold, line: string): "parsed" | "broken" | "skipped" {
  const trimmed = line.trim();
  if (trimmed === "") return "skipped";
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return "broken";
  if (!worthParsing(line)) return "skipped";
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return "skipped";
    fold.add(value as Record<string, unknown>);
    return "parsed";
  } catch {
    return "broken";
  }
}

function slugOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 2] ?? "";
}

/** When a background command last printed: its output file's modification time. */
export async function commandActivity(roots: Roots, cwdSlug: string, sessionId: string, id: string, toClock: (wall: number) => number = (wall) => wall) {
  const paths = roots.tasks.map((t) => join(t, cwdSlug, sessionId, "tasks", `${id}.output`));
  for (const outputFile of paths) {
    const info = await stat(outputFile).catch(() => null);
    if (info !== null) return { id, outputFile, changedAt: toClock(info.mtimeMs) };
  }
  return { id, outputFile: paths[0]!, changedAt: null };
}

const TAIL = 256 * 1024;

/** A subagent's last tool, from the end of its transcript. */
export async function subagentActivity(roots: Roots, cwdSlug: string, sessionId: string, id: string, toClock: (wall: number) => number = (wall) => wall) {
  for (const root of roots.projects) {
    const path = join(root, cwdSlug, sessionId, "subagents", `agent-${id}.jsonl`);
    const info = await stat(path).catch(() => null);
    if (info === null) continue;
    const handle = await open(path, "r");
    try {
      const length = Math.min(TAIL, info.size);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, info.size - length);
      return { id, lastTool: lastToolIn(buffer.toString("utf8")), changedAt: toClock(info.mtimeMs) };
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
