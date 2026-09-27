/**
 * Cache Keeper's SQLite storage: what each thread is set to and where its
 * idle stretch stands, what was sent, and the fetched price lists. Rows hold
 * JSON; indexed columns are only what queries filter on.
 */
import type { CheckInReason, TaskClock } from "../core/checkins";
import type { IdleStretch } from "../core/keeper";
import type { TaskKind } from "../core/waiting";

/** The subset of better-sqlite3's Database the store uses. */
export interface Db {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): unknown;
}

/** Append-only: never edit or reorder a shipped statement. */
export const MIGRATIONS: string[] = [
  `CREATE TABLE threads (
     thread_id TEXT PRIMARY KEY,
     compact_on INTEGER NOT NULL DEFAULT 0,
     record TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     thread_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,
     record TEXT NOT NULL
   )`,
  `CREATE INDEX history_at ON history(at)`,
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** A background task Cache Keeper watches on a thread. */
export interface TaskRecord {
  kind: TaskKind;
  description: string;
  clock: TaskClock;
}

/** A message Cache Keeper sent whose turn it has not yet seen end. */
export interface InFlight {
  kind: "compact" | "keep-warm" | "check-in";
  at: number;
  /** The history row the send wrote, for its cost once the turn ends. */
  historyId: number;
  /** bb reported the thread active after the send: that activation was this message's. */
  started?: boolean;
}

export interface ThreadRecord {
  compactOn: boolean;
  /** The setting N; null until switched on. */
  setting: number | null;
  stretch: IdleStretch | null;
  inFlight: InFlight | null;
  tasks: Record<string, TaskRecord>;
  /** Last background-task event read from bb, so a restart reads on from it. */
  eventsAfterSeq: number;
  /** The compaction Cache Keeper sent in the current or last idle stretch. */
  compaction: CompactionRecord | null;
}

export interface CompactionRecord {
  historyId: number;
  at: number;
  contextBefore: number;
  contextAfter: number | null;
  /** The cache-write rate and lifetime at the time, for the rewrite a return is spared. */
  w: number | null;
  lifetimeMs: number | null;
}

export const emptyRecord = (): ThreadRecord => ({
  compactOn: false,
  setting: null,
  stretch: null,
  inFlight: null,
  tasks: {},
  eventsAfterSeq: 0,
  compaction: null,
});

export type HistoryKind = "compaction" | "keep-warm" | "check-in" | "return";

export interface HistoryRow {
  id: number;
  threadId: string;
  at: number;
  kind: HistoryKind;
  record: HistoryRecord;
}

export interface HistoryRecord {
  /** Estimated cost of what was sent, USD; null until known. */
  usd: number | null;
  contextBefore?: number | null;
  contextAfter?: number | null;
  /** Check-in: the tasks it asked about. */
  tasks?: { id: string; kind: TaskKind; reason: CheckInReason }[];
  /** Return: the cold rewrite a compaction spared the first message back. */
  avoidedUsd?: number;
}

const parse = <T>(text: unknown, fallback: T): T => {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

export class Store {
  constructor(private readonly db: Db) {}

  get(threadId: string): ThreadRecord {
    const row = this.db.prepare("SELECT record FROM threads WHERE thread_id = ?").get(threadId) as { record: string } | undefined;
    return { ...emptyRecord(), ...parse<Partial<ThreadRecord>>(row?.record, {}) };
  }

  has(threadId: string): boolean {
    return this.db.prepare("SELECT 1 FROM threads WHERE thread_id = ?").get(threadId) !== undefined;
  }

  put(threadId: string, record: ThreadRecord, now: number): void {
    this.db
      .prepare(
        `INSERT INTO threads (thread_id, compact_on, record, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET compact_on = excluded.compact_on, record = excluded.record, updated_at = excluded.updated_at`,
      )
      .run(threadId, record.compactOn ? 1 : 0, JSON.stringify(record), now);
  }

  update(threadId: string, now: number, change: (record: ThreadRecord) => ThreadRecord): ThreadRecord {
    const next = change(this.get(threadId));
    this.put(threadId, next, now);
    return next;
  }

  all(): { threadId: string; record: ThreadRecord }[] {
    const rows = this.db.prepare("SELECT thread_id, record FROM threads").all() as { thread_id: string; record: string }[];
    return rows.map((r) => ({ threadId: r.thread_id, record: { ...emptyRecord(), ...parse<Partial<ThreadRecord>>(r.record, {}) } }));
  }

  compactOnIds(): string[] {
    return (this.db.prepare("SELECT thread_id FROM threads WHERE compact_on = 1").all() as { thread_id: string }[]).map((r) => r.thread_id);
  }

  addHistory(threadId: string, at: number, kind: HistoryKind, record: HistoryRecord): number {
    const result = this.db
      .prepare("INSERT INTO history (thread_id, at, kind, record) VALUES (?, ?, ?, ?)")
      .run(threadId, at, kind, JSON.stringify(record)) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  setHistoryCost(id: number, usd: number): void {
    this.patchHistory(id, { usd });
  }

  setContextAfter(id: number, contextAfter: number): void {
    this.patchHistory(id, { contextAfter });
  }

  private patchHistory(id: number, patch: Partial<HistoryRecord>): void {
    const row = this.db.prepare("SELECT record FROM history WHERE id = ?").get(id) as { record: string } | undefined;
    if (row === undefined) return;
    this.db.prepare("UPDATE history SET record = ? WHERE id = ?").run(JSON.stringify({ ...parse<HistoryRecord>(row.record, { usd: null }), ...patch }), id);
  }

  history(since: number, limit = 1000): HistoryRow[] {
    const rows = this.db
      .prepare("SELECT id, thread_id, at, kind, record FROM history WHERE at >= ? ORDER BY at DESC LIMIT ?")
      .all(since, limit) as { id: number; thread_id: string; at: number; kind: HistoryKind; record: string }[];
    return rows.map((r) => ({ id: r.id, threadId: r.thread_id, at: r.at, kind: r.kind, record: parse<HistoryRecord>(r.record, { usd: null }) }));
  }

  pruneHistory(before: number): void {
    this.db.prepare("DELETE FROM history WHERE at < ?").run(before);
  }

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? null : parse<T | null>(row.value, null);
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }
}
