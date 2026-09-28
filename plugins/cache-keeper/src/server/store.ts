/**
 * Cache Keeper's SQLite storage: each thread's switches and setting, where
 * its idle stretch stands, what was sent and what it cost, how far each
 * thread's turns have been read, and the fetched price lists. Rows hold JSON; indexed
 * columns are only what queries filter on.
 */
import type { CheckInReason, TaskClock } from "../core/checkins";
import { newIdleStretch, type IdleStretch } from "../core/keeper";
import { textHash, type SentKind } from "../core/messages";
import { emptyTurnLog, normalizeTurnLog, type TurnLog } from "../core/turns";
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
  `CREATE TABLE sends (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     thread_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     history_id INTEGER NOT NULL,
     record TEXT NOT NULL
   )`,
  `CREATE INDEX sends_thread_at ON sends(thread_id, at)`,
  `CREATE TABLE turn_logs (thread_id TEXT PRIMARY KEY, record TEXT NOT NULL)`,
];

/** A background task Cache Keeper watches on a thread. */
export interface TaskRecord {
  kind: TaskKind;
  description: string;
  clock: TaskClock;
}

/** A message Cache Keeper sent whose turn it has not yet seen end. */
export interface InFlight {
  kind: SentKind;
  at: number;
  sendId: number;
}

/** The thread's read state before a Cache Keeper turn's first input, to put back once the turn ends. */
export interface ReadBefore {
  read: boolean;
  /** `lastReadAt` as bb left it once the input arrived: anything else later means the user changed it. */
  lastReadAt: number | null;
  /** Turns starting from here are the ones it waits on. */
  since: number;
}

export interface ThreadRecord {
  compactOn: boolean;
  /** Keep warm while waiting, as flipped on this tree top; null until flipped, when the setting decides. */
  keepWarm: boolean | null;
  /** The setting N; null until switched on. */
  setting: number | null;
  stretch: IdleStretch | null;
  inFlight: InFlight | null;
  tasks: Record<string, TaskRecord>;
  /** Last background-task event read from bb, so a restart reads on from it. */
  eventsAfterSeq: number;
  /** The compaction Cache Keeper sent in the current or last idle stretch. */
  compaction: CompactionRecord | null;
  readBefore: ReadBefore | null;
  /** The last turn whose attribution and cost were accounted for, by the seq it started at. */
  accountedSeq: number;
  /** Its most recent keep-warm, whose measured cost forecasts the next. */
  lastSendId: number | null;
  /** bb's reports that started Cache Keeper turns here, and their requests: not the user's calls per message. */
  keeperReports: { turns: number; requests: number };
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
  keepWarm: null,
  setting: null,
  stretch: null,
  inFlight: null,
  tasks: {},
  eventsAfterSeq: 0,
  compaction: null,
  readBefore: null,
  accountedSeq: 0,
  lastSendId: null,
  keeperReports: { turns: 0, requests: 0 },
});

/** A record as stored, brought to the current shape: the merged version kept `warmSpentUsd`, an estimate. */
function normalize(stored: Partial<ThreadRecord>): ThreadRecord {
  const record = { ...emptyRecord(), ...stored };
  if (record.stretch !== null) record.stretch = { ...newIdleStretch(record.stretch.startedAt), ...record.stretch, chargedUsd: record.stretch.chargedUsd ?? 0 };
  if (record.inFlight !== null && typeof record.inFlight.sendId !== "number") record.inFlight = null;
  return record;
}

/** One message Cache Keeper sent to one thread. */
export interface SendRecord {
  id: number;
  threadId: string;
  at: number;
  historyId: number;
  kind: SentKind;
  text: string;
  /** The idle stretch of the thread it went to, which its charges count against. */
  stretchStartedAt: number;
  /** Its real cost so far: its own turn and its share of the turns it forced above. */
  usd: number;
  /** Its own turn has been charged, so `usd` forecasts the next. */
  measured: boolean;
}

export type HistoryKind = "compaction" | "keep-warm" | "check-in" | "return";

export interface HistoryRow {
  id: number;
  threadId: string;
  at: number;
  kind: HistoryKind;
  record: HistoryRecord;
}

export interface HistoryRecord {
  /** Cost of what was sent, USD; null until known. A compaction's is estimated until its turn is charged. */
  usd: number | null;
  /** Where the cost fell, USD by thread. */
  split?: Record<string, number>;
  /** A keep-warm's threads, sent at the same moment. */
  threads?: string[];
  /** The tasks a keep-warm asked about. */
  folded?: string[];
  /** A check-in sent past the cost stop: its cost is shown at the cold-write price whatever its turn is charged. */
  coldWrite?: boolean;
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
    return normalize(parse<Partial<ThreadRecord>>(row?.record, {}));
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
    return rows.map((r) => ({ threadId: r.thread_id, record: normalize(parse<Partial<ThreadRecord>>(r.record, {})) }));
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

  historyRow(id: number): HistoryRow | null {
    const r = this.db.prepare("SELECT id, thread_id, at, kind, record FROM history WHERE id = ?").get(id) as
      | { id: number; thread_id: string; at: number; kind: HistoryKind; record: string }
      | undefined;
    return r === undefined ? null : { id: r.id, threadId: r.thread_id, at: r.at, kind: r.kind, record: parse<HistoryRecord>(r.record, { usd: null }) };
  }

  patchHistoryRecord(id: number, patch: Partial<HistoryRecord>): void {
    this.patchHistory(id, patch);
  }

  /** Files an entry under another thread: a keep-warm that grew to several threads is listed under its tree's top. */
  retitleHistory(id: number, threadId: string): void {
    this.db.prepare("UPDATE history SET thread_id = ? WHERE id = ?").run(threadId, id);
  }

  // ---- sends ----

  addSend(send: Omit<SendRecord, "id" | "usd" | "measured">): number {
    const { threadId, at, historyId, ...rest } = send;
    const result = this.db
      .prepare("INSERT INTO sends (thread_id, at, history_id, record) VALUES (?, ?, ?, ?)")
      .run(threadId, at, historyId, JSON.stringify({ ...rest, usd: 0, measured: false })) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  getSend(id: number): SendRecord | null {
    const row = this.db.prepare("SELECT id, thread_id, at, history_id, record FROM sends WHERE id = ?").get(id) as SendRow | undefined;
    return row === undefined ? null : sendOf(row);
  }

  /** The send to `threadId` whose text has hash `hash` that bb recorded as a request at `requestedAt`: the latest one made just before. */
  findSend(threadId: string, hash: string, requestedAt: number): SendRecord | null {
    const rows = this.db
      .prepare("SELECT id, thread_id, at, history_id, record FROM sends WHERE thread_id = ? AND at BETWEEN ? AND ? ORDER BY at DESC")
      .all(threadId, requestedAt - 10 * 60_000, requestedAt + 5_000) as SendRow[];
    return rows.map(sendOf).find((s) => textHash(s.text.trim()) === hash) ?? null;
  }

  /** Adds `usd` of a turn in `incurredIn` to a send, and to its history row's total and split. */
  chargeSend(id: number, incurredIn: string, usd: number, own: boolean): SendRecord | null {
    const send = this.getSend(id);
    if (send === null) return null;
    const next: SendRecord = { ...send, usd: send.usd + usd, measured: send.measured || own };
    const { id: _id, threadId: _t, at: _a, historyId: _h, ...rest } = next;
    this.db.prepare("UPDATE sends SET record = ? WHERE id = ?").run(JSON.stringify(rest), id);
    const row = this.historyRow(send.historyId);
    if (row !== null) {
      const split = { ...(row.record.split ?? {}) };
      split[incurredIn] = (split[incurredIn] ?? 0) + usd;
      // A compaction's estimate gives way to what was charged.
      const base = row.record.split === undefined ? 0 : (row.record.usd ?? 0);
      this.patchHistory(send.historyId, row.record.coldWrite === true ? { split } : { usd: base + usd, split });
    }
    return next;
  }

  // ---- turn logs ----

  turnLog(threadId: string): TurnLog | null {
    const row = this.db.prepare("SELECT record FROM turn_logs WHERE thread_id = ?").get(threadId) as { record: string } | undefined;
    return row === undefined ? null : normalizeTurnLog({ ...emptyTurnLog(), ...parse<Partial<TurnLog>>(row.record, {}) });
  }

  putTurnLog(threadId: string, log: TurnLog): void {
    this.db
      .prepare("INSERT INTO turn_logs (thread_id, record) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET record = excluded.record")
      .run(threadId, JSON.stringify(log));
  }

  history(since: number, limit = 1000): HistoryRow[] {
    const rows = this.db
      .prepare("SELECT id, thread_id, at, kind, record FROM history WHERE at >= ? ORDER BY at DESC LIMIT ?")
      .all(since, limit) as { id: number; thread_id: string; at: number; kind: HistoryKind; record: string }[];
    return rows.map((r) => ({ id: r.id, threadId: r.thread_id, at: r.at, kind: r.kind, record: parse<HistoryRecord>(r.record, { usd: null }) }));
  }

  pruneHistory(before: number): void {
    this.db.prepare("DELETE FROM history WHERE at < ?").run(before);
    this.db.prepare("DELETE FROM sends WHERE at < ?").run(before);
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

interface SendRow {
  id: number;
  thread_id: string;
  at: number;
  history_id: number;
  record: string;
}

function sendOf(row: SendRow): SendRecord {
  const r = parse<Partial<SendRecord>>(row.record, {});
  return {
    id: row.id,
    threadId: row.thread_id,
    at: row.at,
    historyId: row.history_id,
    kind: r.kind ?? "keep-warm",
    text: r.text ?? "",
    stretchStartedAt: r.stretchStartedAt ?? 0,
    usd: r.usd ?? 0,
    measured: r.measured ?? false,
  };
}
