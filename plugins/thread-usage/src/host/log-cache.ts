/**
 * Incremental reads of the harnesses' append-only JSONL session logs.
 *
 * Each log file's entries are kept with the byte offset read through, so a
 * later read parses only the bytes appended since. The state lives in memory
 * while the host worker runs and in the plugin's host data directory between
 * workers (bb stops an idle worker). A file that shrank, was replaced (new
 * inode) or no longer ends with the bytes last read before the offset is
 * read again from the start.
 */
import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LogEntry } from "./contract.js";

/** Bump when the stored layout changes. A parser change is its {@link LineSpec.kind} instead. */
const CACHE_VERSION = 1;
/** Bytes before the offset kept to notice a rewritten file. */
const TAIL_BYTES = 64;
const CHUNK_BYTES = 1 << 20;
/** File states kept in memory by one worker. */
const MEMORY_FILES = 128;
/**
 * How long a session's log directories (or that it has none) are trusted
 * before every project is searched again. Kept under the server's 10-minute
 * overlap between incremental reads, so a file that appears in another
 * directory meanwhile is still read from its first entry.
 */
export const LOCATION_TTL_MS = 5 * 60_000;
/** Stored file states unused this long are deleted, checked at most once a day. */
const PRUNE_AFTER_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
/** A temporary file this old is left over from a worker that stopped mid-write. */
const TMP_AFTER_MS = 60 * 60_000;

/** How one harness turns log lines into entries. */
export interface LineSpec {
  /** Names the parser and its version in the cache key, e.g. "claude@1". */
  kind: string;
  /** Only lines containing this text are parsed. */
  needle: string;
  /** The entry of one parsed line, or null. `lineNo` is 1-based. */
  parse(value: Record<string, unknown>, lineNo: number): LogEntry | null;
  /** Keep one entry per key, the last line's (Claude Code); else every entry. */
  lastPerKey: boolean;
}

interface FileState {
  v: number;
  id: string;
  ino: number;
  mtimeMs: number;
  /** Bytes read through: just past the last newline. */
  offset: number;
  /** Lines before `offset`. */
  lineNo: number;
  /** The `TAIL_BYTES` before `offset`, base64. */
  tail: string;
  entries: LogEntry[];
}

interface LocationRecord {
  dirs: string[];
  at: number;
  /** Kept until the next search, so every page of a paged read treats them alike. */
  appeared?: string[];
}

const emptyState = (id: string): FileState => ({ v: CACHE_VERSION, id, ino: 0, mtimeMs: 0, offset: 0, lineNo: 0, tail: "", entries: [] });

/** Counters for the last reads, for measurement. */
export interface LogCacheStats {
  files: number;
  bytesRead: number;
  fullReads: number;
}

export class LogCache {
  private readonly memory = new Map<string, FileState>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private locations: Map<string, LocationRecord> | null = null;
  readonly stats: LogCacheStats = { files: 0, bytesRead: 0, fullReads: 0 };

  /** `dir` null keeps the states in memory only. */
  constructor(
    private readonly dir: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Every entry of `path` (unfiltered), reading only what was appended since
   * the last call. `scope` names what the entries carry besides the file
   * (session and agent ids), so the same file read for another session is
   * kept apart. A missing file gives no entries.
   */
  read(spec: LineSpec, path: string, scope: string, signal: AbortSignal): Promise<LogEntry[]> {
    const id = `${spec.kind}\0${path}\0${scope}`;
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(() => this.readNow(spec, path, id, signal));
    const settled = run.catch(() => undefined);
    this.locks.set(id, settled);
    void settled.then(() => {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    });
    return run;
  }

  private async readNow(spec: LineSpec, path: string, id: string, signal: AbortSignal): Promise<LogEntry[]> {
    this.stats.files++;
    // In the background: the day's first read does not wait for the sweep.
    if (this.dir !== null && this.now() - this.pruneCheckedAt >= DAY_MS) this.pruning = this.pruneDaily();
    let st;
    try {
      st = await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.memory.delete(id);
      if (this.dir !== null) await rm(this.fileOf(id), { force: true }).catch(() => undefined);
      return [];
    }
    let state = this.memory.get(id) ?? (await this.load(id)) ?? emptyState(id);
    const unchanged = state.ino === st.ino && state.offset === st.size && state.mtimeMs === st.mtimeMs;
    if (!unchanged && !(await this.continues(state, path, st.ino, st.size))) {
      state = emptyState(id);
    }
    if (state.offset === 0) this.stats.fullReads++;
    const before = { offset: state.offset };
    const next: FileState = { ...state, ino: st.ino, mtimeMs: st.mtimeMs, entries: state.entries };
    const index = spec.lastPerKey ? new Map(next.entries.map((e, i) => [e.key, i])) : null;
    let touched = false;
    const apply = (entries: LogEntry[], entry: LogEntry) => {
      touched = true;
      const at = index?.get(entry.key);
      if (at === undefined) {
        index?.set(entry.key, entries.length);
        entries.push(entry);
      } else {
        entries[at] = entry;
      }
    };
    let rest: Buffer = Buffer.alloc(0);
    let changed = false;
    if (st.size > state.offset) {
      // Copy on write: a failed read must not leave half-applied entries behind.
      next.entries = [...state.entries];
      const needle = Buffer.from(spec.needle);
      const read = await readLines(path, state.offset, st.size, signal, (buf, start, end) => {
        next.lineNo++;
        if (end === start || buf.subarray(start, end).indexOf(needle) === -1) return;
        const entry = parseLine(spec, buf.toString("utf8", start, end), next.lineNo);
        if (entry !== null) apply(next.entries, entry);
      });
      this.stats.bytesRead += st.size - state.offset;
      next.offset = read.offset;
      rest = read.rest;
      if (next.offset !== before.offset) {
        next.tail = (await readRange(path, Math.max(0, next.offset - TAIL_BYTES), next.offset)).toString("base64");
      }
      changed = next.offset !== before.offset || touched;
      // Entries are only kept from newline-terminated lines.
      if (!touched) next.entries = state.entries;
    }
    this.remember(id, next);
    if (changed) await this.save(next);
    // A last line without its newline (possibly still being written) counts
    // when it parses, and is read again next time.
    if (rest.length > 0 && rest.indexOf(Buffer.from(spec.needle)) !== -1) {
      const entry = parseLine(spec, rest.toString("utf8"), next.lineNo + 1);
      if (entry !== null) {
        const entries = [...next.entries];
        apply(entries, entry);
        return entries;
      }
    }
    return next.entries;
  }

  /** True when the file still holds, unchanged, what `state` read. */
  private async continues(state: FileState, path: string, ino: number, size: number): Promise<boolean> {
    if (state.offset === 0) return true;
    if (state.ino !== ino || size < state.offset) return false;
    const tail = await readRange(path, Math.max(0, state.offset - TAIL_BYTES), state.offset);
    return tail.toString("base64") === state.tail;
  }

  private remember(id: string, state: FileState): void {
    this.memory.delete(id);
    this.memory.set(id, state);
    if (this.memory.size > MEMORY_FILES) this.memory.delete(this.memory.keys().next().value!);
  }

  private fileOf(id: string): string {
    return join(this.dir!, `${createHash("sha1").update(id).digest("hex")}.json`);
  }

  private async load(id: string): Promise<FileState | null> {
    if (this.dir === null) return null;
    try {
      const file = this.fileOf(id);
      const state = JSON.parse(await readFile(file, "utf8")) as FileState;
      if (state.v !== CACHE_VERSION || state.id !== id) return null;
      // Its modification time says when it was last used, for pruning.
      const now = new Date(this.now());
      await utimes(file, now, now).catch(() => undefined);
      return state;
    } catch {
      return null;
    }
  }

  private pruning: Promise<void> = Promise.resolve();

  /** Settles when a prune started by a read has finished (tests). */
  pruned(): Promise<void> {
    return this.pruning;
  }

  /** When this worker last looked at the prune marker. */
  private pruneCheckedAt = Number.NEGATIVE_INFINITY;

  /**
   * Once a day at most, across workers and within a long-lived one: deletes
   * stored states of files not read for {@link PRUNE_AFTER_MS} and temporary
   * files left by a worker that stopped mid-write. States this worker holds
   * in memory are in use, whatever their files' times say.
   */
  private async pruneDaily(): Promise<void> {
    if (this.dir === null || this.now() - this.pruneCheckedAt < DAY_MS) return;
    const now = this.now();
    this.pruneCheckedAt = now;
    const marker = join(this.dir, "pruned-at");
    try {
      const last = Number(await readFile(marker, "utf8").catch(() => "0"));
      // A marker from the future (the clock was set back) does not stop pruning.
      if (now - last < DAY_MS && last <= now) return;
      const inUse = new Set([...this.memory.keys()].map((id) => this.fileOf(id)));
      for (const name of await readdir(this.dir)) {
        const path = join(this.dir, name);
        const tmp = name.endsWith(".tmp");
        if (!tmp && (!name.endsWith(".json") || name === "locations.json" || inUse.has(path))) continue;
        const st = await stat(path).catch(() => null);
        if (st !== null && now - st.mtimeMs > (tmp ? TMP_AFTER_MS : PRUNE_AFTER_MS)) await rm(path, { force: true });
      }
      // Written after the sweep, so a failed one is tried again by the next worker (this one waits a day).
      await writeFile(marker, String(now));
    } catch {
      // Pruning only saves disk; it is tried again a day later.
    }
  }

  private async save(state: FileState): Promise<void> {
    if (this.dir === null) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const file = this.fileOf(state.id);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, file);
    } catch {
      // The cache only saves work: a failed write means a full read next time.
    }
  }

  // ---- where a session's files are ----

  /**
   * The directories a session's files were last found in; `fresh` while
   * under {@link LOCATION_TTL_MS} old. Null when never searched (or over a day ago).
   */
  async location(sessionId: string): Promise<{ dirs: string[]; appeared: string[]; fresh: boolean } | null> {
    const all = await this.loadLocations();
    const found = all.get(sessionId);
    return found === undefined
      ? null
      : { dirs: found.dirs, appeared: found.appeared ?? [], fresh: this.now() - found.at < LOCATION_TTL_MS };
  }

  /** `appeared`: files the search found outside the location it replaces (see ClaudeFiles). */
  async setLocation(sessionId: string, dirs: string[], appeared: string[] = []): Promise<void> {
    const all = await this.loadLocations();
    const now = this.now();
    all.set(sessionId, { dirs, at: now, ...(appeared.length > 0 ? { appeared } : {}) });
    // Kept for a day past trust, to tell a file that appeared since from one that was always there.
    for (const [key, value] of all) if (now - value.at >= DAY_MS) all.delete(key);
    if (this.dir === null) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const file = join(this.dir, "locations.json");
      await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify({ v: CACHE_VERSION, sessions: Object.fromEntries(all) }));
      await rename(`${file}.${process.pid}.tmp`, file);
    } catch {
      // As for file states: losing it costs one search.
    }
  }

  private async loadLocations(): Promise<Map<string, LocationRecord>> {
    if (this.locations !== null) return this.locations;
    this.locations = new Map();
    if (this.dir !== null) {
      try {
        const stored = JSON.parse(await readFile(join(this.dir, "locations.json"), "utf8")) as {
          v: number;
          sessions: Record<string, LocationRecord>;
        };
        if (stored.v === CACHE_VERSION) this.locations = new Map(Object.entries(stored.sessions));
      } catch {
        // None stored yet.
      }
    }
    return this.locations;
  }
}

function parseLine(spec: LineSpec, line: string, lineNo: number): LogEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return spec.parse(value as Record<string, unknown>, lineNo);
}

async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(to - from);
    const { bytesRead } = await fh.read(buf, 0, buf.length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Calls `onLine` for each newline-terminated line in `[from, to)`. Returns
 * the offset just past the last newline and the bytes after it.
 */
async function readLines(
  path: string,
  from: number,
  to: number,
  signal: AbortSignal,
  onLine: (buf: Buffer, start: number, end: number) => void,
): Promise<{ offset: number; rest: Buffer }> {
  const fh = await open(path, "r");
  try {
    let pos = from;
    let offset = from;
    let carry: Buffer = Buffer.alloc(0);
    while (pos < to) {
      signal.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, to - pos));
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
      let start = 0;
      for (let nl = buf.indexOf(10, start); nl !== -1; nl = buf.indexOf(10, start)) {
        // A CRLF line ends before its CR, as readline would give it.
        onLine(buf, start, nl > start && buf[nl - 1] === 13 ? nl - 1 : nl);
        start = nl + 1;
      }
      offset += start;
      carry = buf.subarray(start);
    }
    signal.throwIfAborted();
    return { offset, rest: carry };
  } finally {
    await fh.close();
  }
}
