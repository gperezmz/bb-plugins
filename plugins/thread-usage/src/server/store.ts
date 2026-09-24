/**
 * The plugin's SQLite storage. Rows hold JSON for the records
 * the pure modules work on; indexed columns are only what queries filter on.
 */
import type { Crossing } from "../core/budget";
import type { Edge } from "../core/family";
import type { GatewayRow } from "../core/gateway";
import { EMPTY_CURSOR, type LedgerCursor, type TurnRecord } from "../core/ledger";
import type { StoredLogEntry } from "../core/summary";

/** The subset of better-sqlite3's Database the store uses. */
export interface Db {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): unknown;
  transaction<F extends (...args: never[]) => unknown>(fn: F): F;
}

/** Append-only: never edit or reorder a shipped statement. */
export const MIGRATIONS: string[] = [
  `CREATE TABLE edges (
     thread_id TEXT PRIMARY KEY,
     parent_thread_id TEXT,
     source_thread_id TEXT,
     provider_id TEXT,
     project_id TEXT,
     environment_id TEXT,
     host_id TEXT,
     title TEXT,
     hidden INTEGER NOT NULL DEFAULT 0,
     archived_at INTEGER,
     deleted_at INTEGER,
     created_at INTEGER,
     status TEXT,
     idle_since INTEGER,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX edges_parent ON edges(parent_thread_id)`,
  `CREATE INDEX edges_source ON edges(source_thread_id)`,
  `CREATE TABLE threads (
     thread_id TEXT PRIMARY KEY,
     cursor TEXT NOT NULL,
     first_seen_at INTEGER,
     gaps TEXT NOT NULL DEFAULT '[]',
     history_backfilled INTEGER NOT NULL DEFAULT 0,
     logs_read_through INTEGER,
     logs_missing_host TEXT,
     logs_missing_since INTEGER,
     last_activity_at INTEGER,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE turns (
     thread_id TEXT NOT NULL,
     turn_id TEXT NOT NULL,
     started_at INTEGER,
     completed_at INTEGER,
     record TEXT NOT NULL,
     PRIMARY KEY (thread_id, turn_id)
   )`,
  `CREATE TABLE gateway_requests (
     request_id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     start_time INTEGER NOT NULL,
     spend REAL NOT NULL,
     row TEXT NOT NULL
   )`,
  `CREATE INDEX gateway_requests_thread ON gateway_requests(thread_id, start_time)`,
  `CREATE TABLE log_entries (
     thread_id TEXT NOT NULL,
     entry_key TEXT NOT NULL,
     agent_id TEXT,
     ts INTEGER NOT NULL,
     entry TEXT NOT NULL,
     PRIMARY KEY (thread_id, entry_key)
   )`,
  `CREATE TABLE backfill_queue (
     thread_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     from_ms INTEGER,
     to_ms INTEGER,
     priority INTEGER NOT NULL,
     state TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (thread_id, kind)
   )`,
  `CREATE TABLE crossings (
     crossing_key TEXT PRIMARY KEY,
     root_thread_id TEXT NOT NULL,
     amount REAL NOT NULL,
     crossed_at INTEGER NOT NULL,
     total REAL NOT NULL,
     toasted_at INTEGER
   )`,
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `ALTER TABLE edges ADD COLUMN title_from_prompt INTEGER NOT NULL DEFAULT 0`,
];

export interface GapRecord {
  fromMs: number;
  toMs: number;
  resolution: "filled" | "partial";
  /** Set once a harness-log backfill covered the gap. */
  backfilled?: boolean;
}

export interface ThreadState {
  threadId: string;
  cursor: LedgerCursor;
  firstSeenAt: number | null;
  gaps: GapRecord[];
  historyBackfilled: boolean;
  logsReadThrough: number | null;
  logsMissingHost: string | null;
  logsMissingSince: number | null;
  lastActivityAt: number | null;
}

export type BackfillKind = "events" | "logs";
export type BackfillState = "queued" | "running" | "done" | "failed";

export interface BackfillJob {
  threadId: string;
  kind: BackfillKind;
  fromMs: number | null;
  toMs: number | null;
  priority: number;
  state: BackfillState;
  attempts: number;
  lastError: string | null;
}

interface EdgeRow {
  thread_id: string;
  parent_thread_id: string | null;
  source_thread_id: string | null;
  provider_id: string | null;
  project_id: string | null;
  environment_id: string | null;
  host_id: string | null;
  title: string | null;
  hidden: number;
  archived_at: number | null;
  deleted_at: number | null;
  created_at: number | null;
  status: string | null;
  idle_since: number | null;
  title_from_prompt: number;
}

export interface EdgeExtra extends Edge {
  /** The title is bb's fallback, built from the first prompt; exports leave it out. */
  titleFromPrompt: boolean;
  environmentId: string | null;
  hostId: string | null;
  status: string | null;
  idleSince: number | null;
}

function toEdge(r: EdgeRow): EdgeExtra {
  return {
    threadId: r.thread_id,
    parentThreadId: r.parent_thread_id,
    sourceThreadId: r.source_thread_id,
    providerId: r.provider_id,
    projectId: r.project_id,
    environmentId: r.environment_id,
    hostId: r.host_id,
    title: r.title,
    titleFromPrompt: r.title_from_prompt === 1,
    hidden: r.hidden === 1,
    archivedAt: r.archived_at,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    status: r.status,
    idleSince: r.idle_since,
  };
}

export class Store {
  constructor(private readonly db: Db) {}

  // ---- edges ----

  upsertEdge(edge: Partial<EdgeExtra> & { threadId: string }, now: number): void {
    const existing = this.getEdge(edge.threadId);
    const merged: EdgeExtra = {
      threadId: edge.threadId,
      parentThreadId: pick(edge, existing, "parentThreadId", null),
      sourceThreadId: pick(edge, existing, "sourceThreadId", null),
      providerId: pick(edge, existing, "providerId", null),
      projectId: pick(edge, existing, "projectId", null),
      environmentId: pick(edge, existing, "environmentId", null),
      hostId: pick(edge, existing, "hostId", null),
      title: pick(edge, existing, "title", null),
      titleFromPrompt: pick(edge, existing, "titleFromPrompt", false),
      hidden: pick(edge, existing, "hidden", false),
      archivedAt: pick(edge, existing, "archivedAt", null),
      deletedAt: pick(edge, existing, "deletedAt", null),
      createdAt: pick(edge, existing, "createdAt", null),
      status: pick(edge, existing, "status", null),
      idleSince: pick(edge, existing, "idleSince", null),
    };
    this.db
      .prepare(
        `INSERT INTO edges (thread_id, parent_thread_id, source_thread_id, provider_id, project_id,
           environment_id, host_id, title, hidden, archived_at, deleted_at, created_at, status, idle_since, updated_at,
           title_from_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           parent_thread_id = excluded.parent_thread_id, source_thread_id = excluded.source_thread_id,
           provider_id = excluded.provider_id, project_id = excluded.project_id,
           environment_id = excluded.environment_id, host_id = excluded.host_id, title = excluded.title,
           hidden = excluded.hidden, archived_at = excluded.archived_at, deleted_at = excluded.deleted_at,
           created_at = excluded.created_at, status = excluded.status, idle_since = excluded.idle_since,
           updated_at = excluded.updated_at, title_from_prompt = excluded.title_from_prompt`,
      )
      .run(
        merged.threadId,
        merged.parentThreadId,
        merged.sourceThreadId,
        merged.providerId,
        merged.projectId,
        merged.environmentId,
        merged.hostId,
        merged.title,
        merged.hidden ? 1 : 0,
        merged.archivedAt,
        merged.deletedAt,
        merged.createdAt,
        merged.status,
        merged.idleSince,
        now,
        merged.titleFromPrompt ? 1 : 0,
      );
  }

  getEdge(threadId: string): EdgeExtra | null {
    const row = this.db.prepare(`SELECT * FROM edges WHERE thread_id = ?`).get(threadId) as
      | EdgeRow
      | undefined;
    return row === undefined ? null : toEdge(row);
  }

  allEdges(): EdgeExtra[] {
    return (this.db.prepare(`SELECT * FROM edges`).all() as EdgeRow[]).map(toEdge);
  }

  edgeCount(): number {
    return (this.db.prepare(`SELECT count(*) AS n FROM edges`).get() as { n: number }).n;
  }

  // ---- thread state ----

  getThread(threadId: string): ThreadState | null {
    const row = this.db.prepare(`SELECT * FROM threads WHERE thread_id = ?`).get(threadId) as
      | {
          thread_id: string;
          cursor: string;
          first_seen_at: number | null;
          gaps: string;
          history_backfilled: number;
          logs_read_through: number | null;
          logs_missing_host: string | null;
          logs_missing_since: number | null;
          last_activity_at: number | null;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      threadId: row.thread_id,
      cursor: { ...EMPTY_CURSOR, ...(JSON.parse(row.cursor) as LedgerCursor) },
      firstSeenAt: row.first_seen_at,
      gaps: JSON.parse(row.gaps) as GapRecord[],
      historyBackfilled: row.history_backfilled === 1,
      logsReadThrough: row.logs_read_through,
      logsMissingHost: row.logs_missing_host,
      logsMissingSince: row.logs_missing_since,
      lastActivityAt: row.last_activity_at,
    };
  }

  putThread(state: ThreadState, now: number): void {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, cursor, first_seen_at, gaps, history_backfilled, logs_read_through,
           logs_missing_host, logs_missing_since, last_activity_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET cursor = excluded.cursor, first_seen_at = excluded.first_seen_at,
           gaps = excluded.gaps, history_backfilled = excluded.history_backfilled,
           logs_read_through = excluded.logs_read_through, logs_missing_host = excluded.logs_missing_host,
           logs_missing_since = excluded.logs_missing_since, last_activity_at = excluded.last_activity_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        state.threadId,
        JSON.stringify(state.cursor),
        state.firstSeenAt,
        JSON.stringify(state.gaps),
        state.historyBackfilled ? 1 : 0,
        state.logsReadThrough,
        state.logsMissingHost,
        state.logsMissingSince,
        state.lastActivityAt,
        now,
      );
  }

  /**
   * The latest rate-limit kind each provider reported on any thread, for
   * threads that never reported one themselves.
   */
  latestRateLimitKinds(): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT e.provider_id AS provider, json_extract(t.cursor, '$.rateLimitKind') AS kind
         FROM threads t JOIN edges e ON e.thread_id = t.thread_id
         WHERE json_extract(t.cursor, '$.rateLimitKind') IS NOT NULL
           AND json_extract(t.cursor, '$.rateLimitKind') != 'unknown'
         ORDER BY t.updated_at DESC`,
      )
      .all() as { provider: string | null; kind: string }[];
    const out = new Map<string, string>();
    for (const r of rows) if (r.provider !== null && !out.has(r.provider)) out.set(r.provider, r.kind);
    return out;
  }

  threadsWithMissingLogs(): ThreadState[] {
    const ids = this.db
      .prepare(`SELECT thread_id FROM threads WHERE logs_missing_since IS NOT NULL`)
      .all() as { thread_id: string }[];
    return ids.map((r) => this.getThread(r.thread_id)).filter((t): t is ThreadState => t !== null);
  }

  allThreadIds(): string[] {
    return (this.db.prepare(`SELECT thread_id FROM threads`).all() as { thread_id: string }[]).map(
      (r) => r.thread_id,
    );
  }

  // ---- turns ----

  getTurns(threadId: string): TurnRecord[] {
    return (
      this.db
        .prepare(`SELECT record FROM turns WHERE thread_id = ? ORDER BY started_at, turn_id`)
        .all(threadId) as { record: string }[]
    ).map((r) => JSON.parse(r.record) as TurnRecord);
  }

  getTurnsById(threadId: string, turnIds: readonly string[]): Map<string, TurnRecord> {
    const out = new Map<string, TurnRecord>();
    const stmt = this.db.prepare(`SELECT record FROM turns WHERE thread_id = ? AND turn_id = ?`);
    for (const id of turnIds) {
      const row = stmt.get(threadId, id) as { record: string } | undefined;
      if (row !== undefined) out.set(id, JSON.parse(row.record) as TurnRecord);
    }
    return out;
  }

  putTurns(threadId: string, turns: Iterable<TurnRecord>): void {
    const stmt = this.db.prepare(
      `INSERT INTO turns (thread_id, turn_id, started_at, completed_at, record) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, turn_id) DO UPDATE SET started_at = excluded.started_at,
         completed_at = excluded.completed_at, record = excluded.record`,
    );
    for (const t of turns) {
      stmt.run(threadId, t.turnId, t.startedAt, t.completedAt, JSON.stringify(t));
    }
  }

  deleteTurn(threadId: string, turnId: string): void {
    this.db.prepare(`DELETE FROM turns WHERE thread_id = ? AND turn_id = ?`).run(threadId, turnId);
  }

  countTurns(threadId: string): number {
    return (
      this.db.prepare(`SELECT count(*) AS n FROM turns WHERE thread_id = ?`).get(threadId) as {
        n: number;
      }
    ).n;
  }

  // ---- gateway rows ----

  /**
   * Upserts rows by request id. A sweep only adds or updates: an update
   * never lowers a row's spend.
   */
  upsertGatewayRows(rows: readonly GatewayRow[]): Set<string> {
    const touched = new Set<string>();
    const get = this.db.prepare(`SELECT spend FROM gateway_requests WHERE request_id = ?`);
    const put = this.db.prepare(
      `INSERT INTO gateway_requests (request_id, thread_id, start_time, spend, row) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET thread_id = excluded.thread_id, start_time = excluded.start_time,
         spend = excluded.spend, row = excluded.row`,
    );
    for (const row of rows) {
      const existing = get.get(row.requestId) as { spend: number } | undefined;
      if (existing !== undefined && existing.spend > row.spend) continue;
      put.run(row.requestId, row.threadId, row.startTime, row.spend, JSON.stringify(row));
      touched.add(row.threadId);
    }
    return touched;
  }

  getGatewayRows(threadId: string): GatewayRow[] {
    return (
      this.db
        .prepare(`SELECT row FROM gateway_requests WHERE thread_id = ? ORDER BY start_time`)
        .all(threadId) as { row: string }[]
    ).map((r) => JSON.parse(r.row) as GatewayRow);
  }

  threadHasGatewayRows(threadId: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM gateway_requests WHERE thread_id = ? LIMIT 1`).get(threadId) !==
      undefined
    );
  }

  anyGatewayRows(): boolean {
    return this.db.prepare(`SELECT 1 FROM gateway_requests LIMIT 1`).get() !== undefined;
  }

  // ---- log entries ----

  upsertLogEntries(threadId: string, entries: readonly StoredLogEntry[]): number {
    const put = this.db.prepare(
      `INSERT INTO log_entries (thread_id, entry_key, agent_id, ts, entry) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, entry_key) DO UPDATE SET agent_id = excluded.agent_id, ts = excluded.ts,
         entry = excluded.entry`,
    );
    for (const e of entries) {
      // Keys are unique per request, so a resumed session repeating a message counts once.
      put.run(threadId, `${e.agentId ?? "main"}:${e.key}`, e.agentId, e.ts, JSON.stringify(e));
    }
    return entries.length;
  }

  getLogEntries(threadId: string): StoredLogEntry[] {
    return (
      this.db
        .prepare(`SELECT entry FROM log_entries WHERE thread_id = ? ORDER BY ts`)
        .all(threadId) as { entry: string }[]
    ).map((r) => JSON.parse(r.entry) as StoredLogEntry);
  }

  // ---- backfill queue ----

  enqueue(job: Omit<BackfillJob, "state" | "attempts" | "lastError">, now: number): void {
    this.db
      .prepare(
        `INSERT INTO backfill_queue (thread_id, kind, from_ms, to_ms, priority, state, attempts, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)
         ON CONFLICT(thread_id, kind) DO UPDATE SET
           from_ms = CASE WHEN backfill_queue.state = 'done' THEN excluded.from_ms
                          ELSE min(coalesce(backfill_queue.from_ms, excluded.from_ms), coalesce(excluded.from_ms, backfill_queue.from_ms)) END,
           to_ms = CASE WHEN backfill_queue.state = 'done' THEN excluded.to_ms
                        ELSE max(coalesce(backfill_queue.to_ms, excluded.to_ms), coalesce(excluded.to_ms, backfill_queue.to_ms)) END,
           priority = max(backfill_queue.priority, excluded.priority),
           state = 'queued', updated_at = excluded.updated_at`,
      )
      .run(job.threadId, job.kind, job.fromMs, job.toMs, job.priority, now);
  }

  /** Queued jobs, newest threads first. */
  nextJobs(limit: number): BackfillJob[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM backfill_queue WHERE state = 'queued' ORDER BY priority DESC, updated_at LIMIT ?`,
        )
        .all(limit) as {
        thread_id: string;
        kind: BackfillKind;
        from_ms: number | null;
        to_ms: number | null;
        priority: number;
        state: BackfillState;
        attempts: number;
        last_error: string | null;
      }[]
    ).map((r) => ({
      threadId: r.thread_id,
      kind: r.kind,
      fromMs: r.from_ms,
      toMs: r.to_ms,
      priority: r.priority,
      state: r.state,
      attempts: r.attempts,
      lastError: r.last_error,
    }));
  }

  setJobState(
    threadId: string,
    kind: BackfillKind,
    state: BackfillState,
    error: string | null,
    now: number,
  ): void {
    this.db
      .prepare(
        `UPDATE backfill_queue SET state = ?, last_error = ?, updated_at = ?,
           attempts = attempts + CASE WHEN ? = 'running' THEN 1 ELSE 0 END
         WHERE thread_id = ? AND kind = ?`,
      )
      .run(state, error, now, state, threadId, kind);
  }

  /** Jobs left running by a stopped plugin go back to the queue. */
  requeueRunning(now: number): void {
    this.db
      .prepare(`UPDATE backfill_queue SET state = 'queued', updated_at = ? WHERE state = 'running'`)
      .run(now);
  }

  queueCounts(): Record<BackfillState, number> {
    const out: Record<BackfillState, number> = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const r of this.db
      .prepare(`SELECT state, count(*) AS n FROM backfill_queue GROUP BY state`)
      .all() as { state: BackfillState; n: number }[]) {
      out[r.state] = r.n;
    }
    return out;
  }

  failedJobs(limit: number): BackfillJob[] {
    return (
      this.db
        .prepare(`SELECT * FROM backfill_queue WHERE state = 'failed' ORDER BY updated_at DESC LIMIT ?`)
        .all(limit) as { thread_id: string; kind: BackfillKind; last_error: string | null }[]
    ).map((r) => ({
      threadId: r.thread_id,
      kind: r.kind,
      fromMs: null,
      toMs: null,
      priority: 0,
      state: "failed",
      attempts: 0,
      lastError: r.last_error,
    }));
  }

  // ---- crossings ----

  crossingKeys(): Set<string> {
    return new Set(
      (this.db.prepare(`SELECT crossing_key FROM crossings`).all() as { crossing_key: string }[]).map(
        (r) => r.crossing_key,
      ),
    );
  }

  /** Records a crossing once. `silent` marks its toast as already shown. */
  addCrossing(key: string, c: Crossing, opts: { silent?: boolean } = {}): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO crossings (crossing_key, root_thread_id, amount, crossed_at, total, toasted_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(key, c.rootThreadId, c.amount, c.crossedAt, c.totalAtCrossing, opts.silent === true ? c.crossedAt : null);
  }

  crossingFor(
    threadId: string,
    amount: number,
  ): { crossedAt: number; total: number; toastedAt: number | null } | null {
    const row = this.db
      .prepare(`SELECT crossed_at, total, toasted_at FROM crossings WHERE root_thread_id = ? AND amount = ?`)
      .get(threadId, amount) as
      | { crossed_at: number; total: number; toasted_at: number | null }
      | undefined;
    return row === undefined
      ? null
      : { crossedAt: row.crossed_at, total: row.total, toastedAt: row.toasted_at };
  }

  /** Marks a crossing's toast shown. Returns false when another window already showed it. */
  claimToast(threadId: string, amount: number, now: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE crossings SET toasted_at = ? WHERE root_thread_id = ? AND amount = ? AND toasted_at IS NULL`,
      )
      .run(now, threadId, amount) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  pendingToasts(amount: number): { rootThreadId: string; total: number }[] {
    return (
      this.db
        .prepare(`SELECT root_thread_id, total FROM crossings WHERE amount = ? AND toasted_at IS NULL`)
        .all(amount) as { root_thread_id: string; total: number }[]
    ).map((r) => ({ rootThreadId: r.root_thread_id, total: r.total }));
  }

  // ---- meta ----

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row === undefined ? null : (JSON.parse(row.value) as T);
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(value));
  }

  /**
   * Drops every ledger (turns and cursors) of a thread that still exists, so
   * the next discovery re-reads bb's events under changed rules. Edges, gateway rows, log entries and
   * crossings are kept: they are facts, not derived from the rules.
   */
  resetLedger(listed: ReadonlySet<string>): void {
    // Only threads bb still lists are dropped. A deleted thread's events can
    // no longer be read (bb answers 404), so its ledger could never be
    // rebuilt; that holds too for one deleted while the plugin was stopped.
    for (const id of listed) this.resetThreadLedger(id);
  }

  /** Drops one thread's ledger, unless the thread is deleted. Returns whether it did. */
  resetThreadLedger(threadId: string): boolean {
    if (this.getEdge(threadId)?.deletedAt != null) return false;
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM turns WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM threads WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM backfill_queue WHERE thread_id = ?`).run(threadId);
    })();
    return true;
  }

  // ---- retention ----

  /**
   * Collapses turn and gateway rows older than `cutoff` into one retained
   * turn and one retained row per thread (365 days).
   */
  collapseBefore(cutoff: number): number {
    const threads = this.db
      .prepare(
        `SELECT DISTINCT thread_id FROM turns WHERE completed_at IS NOT NULL AND completed_at < ? AND turn_id != 'retained'`,
      )
      .all(cutoff) as { thread_id: string }[];
    const run = this.db.transaction(() => {
      for (const { thread_id: threadId } of threads) {
        const old = this.getTurns(threadId).filter(
          (t) => t.turnId !== "retained" && t.kind === "turn" && t.completedAt !== null && t.completedAt < cutoff,
        );
        if (old.length === 0) continue;
        const prior = this.getTurnsById(threadId, ["retained"]).get("retained");
        const all = prior === undefined ? old : [prior, ...old];
        const retained = collapseTurns(all);
        for (const t of old) this.deleteTurn(threadId, t.turnId);
        this.putTurns(threadId, [retained]);
        const rows = this.getGatewayRows(threadId).filter((r) => r.startTime < cutoff);
        if (rows.length > 0) {
          const priorRow = rows.find((r) => r.requestId === `retained:${threadId}`);
          const merged: GatewayRow = {
            requestId: `retained:${threadId}`,
            threadId,
            startTime: retained.startedAt ?? rows[0]!.startTime,
            endTime: null,
            model: priorRow?.model ?? rows[0]!.model,
            promptTokens: rows.reduce((n, r) => n + r.promptTokens, 0),
            completionTokens: rows.reduce((n, r) => n + r.completionTokens, 0),
            spend: rows.reduce((n, r) => n + r.spend, 0),
            durationMs: rows.reduce((n, r) => n + (r.durationMs ?? 0), 0),
            status: null,
          };
          this.db
            .prepare(`DELETE FROM gateway_requests WHERE thread_id = ? AND start_time < ?`)
            .run(threadId, cutoff);
          this.db
            .prepare(
              `INSERT INTO gateway_requests (request_id, thread_id, start_time, spend, row) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(merged.requestId, threadId, merged.startTime, merged.spend, JSON.stringify(merged));
        }
      }
    });
    run();
    return threads.length;
  }
}

function pick<K extends keyof EdgeExtra>(
  next: Partial<EdgeExtra>,
  existing: EdgeExtra | null,
  key: K,
  fallback: EdgeExtra[K],
): EdgeExtra[K] {
  if (next[key] !== undefined) return next[key] as EdgeExtra[K];
  if (existing !== null) return existing[key];
  return fallback;
}

/** One record standing for many old turns. */
export function collapseTurns(turns: readonly TurnRecord[]): TurnRecord {
  const starts = turns.map((t) => t.startedAt).filter((n): n is number => n !== null);
  const ends = turns.map((t) => t.completedAt).filter((n): n is number => n !== null);
  const sum = (f: (t: TurnRecord) => number) => turns.reduce((n, t) => n + f(t), 0);
  const tokens = turns.reduce(
    (acc, t) => ({
      input: acc.input + t.tokens.input,
      output: acc.output + t.tokens.output,
      cacheRead: acc.cacheRead + t.tokens.cacheRead,
      cacheWrite: acc.cacheWrite + t.tokens.cacheWrite,
      cacheWrite1h: acc.cacheWrite1h + t.tokens.cacheWrite1h,
      reasoning: acc.reasoning + t.tokens.reasoning,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
  );
  return {
    turnId: "retained",
    kind: "turn",
    startedAt: starts.length > 0 ? Math.min(...starts) : null,
    completedAt: ends.length > 0 ? Math.max(...ends) : null,
    status: "completed",
    model: turns[turns.length - 1]?.model ?? null,
    prompt: `${turns.length} turns older than a year, collapsed`,
    tokens,
    usageEvents: sum((t) => t.usageEvents),
    linesAdded: sum((t) => t.linesAdded),
    linesRemoved: sum((t) => t.linesRemoved),
    fileChanges: sum((t) => t.fileChanges),
    partial: turns.some((t) => t.partial),
    filled: turns.some((t) => t.filled),
    firstSeq: Math.min(...turns.map((t) => t.firstSeq)),
    wallMs: turns.reduce(
      (n, t) => n + (t.wallMs ?? (t.startedAt !== null && t.completedAt !== null ? t.completedAt - t.startedAt : 0)),
      0,
    ),
  };
}
