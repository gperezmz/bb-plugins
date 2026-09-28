/**
 * Cache Keeper's SQLite storage: each thread's switches and setting, where
 * its idle stretch stands, how far its transcript and bb's event history have
 * been read, what was sent and what it cost, and the fetched price lists.
 * Rows hold JSON; indexed columns are only what queries filter on.
 *
 * Every write to a thread's record is a synchronous read-modify-write of the
 * stored row (`update`), so two writers never undo each other: a change made
 * while the engine awaits bb or a host is read back before the engine writes.
 */
import type { CheckInReason, TaskClock } from "../core/checkins";
import { newIdleStretch, type IdleStretch } from "../core/keeper";
import type { SentKind } from "../core/messages";
import type { HoldReason } from "../core/reasons";
import { emptyTurnLog, normalizeTurnLog, type TurnLog } from "../core/turns";
import type { TaskKind } from "../core/waiting";
import { EMPTY_FACTS, type TranscriptCursor } from "../core/transcript";

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
  // What a send was for: one send per thread and due time, even across a restart during the send.
  `ALTER TABLE sends ADD COLUMN due_key TEXT`,
  `CREATE UNIQUE INDEX sends_due ON sends(thread_id, due_key)`,
  `CREATE INDEX sends_at ON sends(at)`,
];

/**
 * Sets `auto_vacuum = incremental` before the first table exists, or rebuilds
 * a database made without it, so deleted rows give their pages back.
 */
export function ensureIncrementalVacuum(db: Db): void {
  const mode = (db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number } | undefined)?.auto_vacuum;
  if (mode === 2) return;
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  const tables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
  if (tables !== undefined) db.exec("VACUUM");
}

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

/** Where the thread's Claude Code transcript has been read to. */
export interface TranscriptRecord {
  /** The Claude Code session, from bb's latest `thread/identity`. */
  sessionId: string;
  /** Null until the transcript is first read. */
  cursor: TranscriptCursor | null;
  /** Why it could not be read or parsed, when the last read failed. */
  unreadable: string | null;
}

/** What Cache Keeper last decided for the thread, for `status`. */
export interface Decision {
  at: number;
  /** What was due: a compaction, a keep-warm or a check-in. */
  what: SentKind;
  /** Null when it was sent. */
  reason: HoldReason | null;
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
  /** The compaction Cache Keeper sent in the current or last idle stretch. */
  compaction: CompactionRecord | null;
  readBefore: ReadBefore | null;
  /** The last turn whose attribution and cost were accounted for, by the seq it started at. */
  accountedSeq: number;
  /** Its most recent keep-warm, whose measured cost forecasts the next. */
  lastSendId: number | null;
  /** bb's reports that started Cache Keeper turns here, and their requests: not the user's calls per message. */
  keeperReports: { turns: number; requests: number };
  transcript: TranscriptRecord | null;
  /** The context window bb reported for the thread, and the model it reported it for. */
  window: { model: string | null; tokens: number } | null;
  decision: Decision | null;
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
  compaction: null,
  readBefore: null,
  accountedSeq: 0,
  lastSendId: null,
  keeperReports: { turns: 0, requests: 0 },
  transcript: null,
  window: null,
  decision: null,
});

/**
 * A record as stored, brought to the current shape. The stored form leaves
 * out every null, false and empty object (`storedForm`), which are put back
 * here; records from before 0.1.0 also kept `warmSpentUsd` and
 * `eventsAfterSeq`, and no transcript cursor.
 */
export function normalizeRecord(stored: Partial<ThreadRecord> & Record<string, unknown>): ThreadRecord {
  const { eventsAfterSeq: _events, warmSpentUsd: _spent, ...known } = stored;
  const record = { ...emptyRecord(), ...known } as ThreadRecord;
  record.keepWarm ??= null;
  record.setting ??= null;
  if (record.stretch != null) record.stretch = { ...newIdleStretch(record.stretch.startedAt), ...record.stretch, chargedUsd: record.stretch.chargedUsd ?? 0 };
  else record.stretch = null;
  if (record.stretch !== null) record.stretch.compactedAt ??= null;
  if (record.inFlight == null || typeof record.inFlight.sendId !== "number") record.inFlight = null;
  record.tasks = Object.fromEntries(
    Object.entries(record.tasks ?? {}).map(([id, t]) => [id, { ...t, description: t.description ?? "", clock: Object.assign({ lastCheckInAt: null, stalledStreak: 0 }, t.clock) }]),
  );
  record.compaction = record.compaction == null ? null : Object.assign({ contextAfter: null, w: null, lifetimeMs: null }, record.compaction);
  record.readBefore = record.readBefore == null ? null : Object.assign({ read: false, lastReadAt: null }, record.readBefore);
  record.keeperReports = Object.assign({ turns: 0, requests: 0 }, record.keeperReports);
  record.lastSendId ??= null;
  record.window ??= null;
  // The window is stored without its model when that is the transcript's.
  if (record.window !== null && record.window.model === undefined) record.window.model = record.transcript?.cursor?.fold?.facts?.model ?? null;
  record.decision = record.decision == null ? null : { ...record.decision, reason: record.decision.reason ?? null };
  if (record.transcript == null || typeof record.transcript.sessionId !== "string") record.transcript = null;
  else {
    const t = record.transcript;
    const fold = t.cursor?.fold;
    record.transcript = {
      sessionId: t.sessionId,
      unreadable: t.unreadable ?? null,
      cursor:
        t.cursor == null || fold == null
          ? null
          : {
              ...t.cursor,
              fold: {
                facts: { ...EMPTY_FACTS, ...fold.facts },
                lastKey: fold.lastKey ?? null,
                contextAt: fold.contextAt ?? null,
                keeperTurn: fold.keeperTurn ?? false,
                awaitingRequest: fold.awaitingRequest ?? false,
              },
            },
    };
  }
  return record;
}

/**
 * A record as stored: every null, false and empty or all-zero object left out, and
 * charges to a billionth of a dollar, so a typical thread's row stays under
 * 600 B. `normalizeRecord` puts the defaults back.
 */
export function storedForm(record: ThreadRecord): string {
  const model = record.transcript?.cursor?.fold.facts.model;
  const window = record.window !== null && record.window.model !== null && record.window.model === model ? { tokens: record.window.tokens } : record.window;
  return JSON.stringify({ ...record, window }, (key, value: unknown) => {
    // Keep warm while waiting is on, off, or null when nobody flipped it: its false is kept.
    if (key === "keepWarm" && value === false) return value;
    if (value === null || value === false) return undefined;
    if (typeof value === "number" && !Number.isInteger(value)) return Math.round(value * 1e9) / 1e9;
    if (typeof value === "object" && !Array.isArray(value) && Object.values(value as object).every((v) => v === null || v === false || v === undefined || v === 0)) return undefined;
    return value;
  });
}

/** One message Cache Keeper sent, or is sending, to one thread. */
export interface SendRecord {
  id: number;
  threadId: string;
  at: number;
  historyId: number;
  /** The due time it answered, e.g. `compact:<deadline>`: a second send for it is refused. */
  dueKey: string | null;
  kind: SentKind;
  /** Its text's hash, by which bb's record of it is matched. */
  hash: string;
  /** The idle stretch of the thread it went to, which its charges count against. */
  stretchStartedAt: number;
  /** What it was forecast to cost, charged in full if its own turn cannot be measured. */
  forecastUsd: number;
  /** Its cost so far: its own turn and its share of the turns it forced above. */
  usd: number;
  /** Its own turn has been charged, measured or at the forecast, so `usd` forecasts the next. */
  measured: boolean;
  /** Claimed but not yet taken by bb; a claim is kept through a restart, so the due time is never sent twice. */
  sending: boolean;
}

export type HistoryKind = "compaction" | "keep-warm" | "check-in" | "return" | "held";

export interface HistoryRow {
  id: number;
  threadId: string;
  at: number;
  kind: HistoryKind;
  record: HistoryRecord;
}

export interface HistoryRecord {
  /** Cost of what was sent, USD; null until known. */
  usd: number | null;
  /** `usd` is a forecast or an estimate: a compaction's, or a keep-warm's whose turn was not measured. */
  estimated?: boolean;
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
  /** Held: what was due, and why nothing was sent. Also a row naming a report row deleted or read state put back. */
  what?: SentKind | "report-row-deleted" | "read-state-restored";
  reason?: HoldReason;
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
    return normalizeRecord(parse<Partial<ThreadRecord> & Record<string, unknown>>(row?.record, {}));
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
      .run(threadId, record.compactOn ? 1 : 0, storedForm(record), now);
  }

  /** Applies `change` to the record as stored now, and stores the result. Never await between reading a record and this call. */
  update(threadId: string, now: number, change: (record: ThreadRecord) => ThreadRecord): ThreadRecord {
    const next = change(this.get(threadId));
    this.put(threadId, next, now);
    return next;
  }

  all(): { threadId: string; record: ThreadRecord }[] {
    const rows = this.db.prepare("SELECT thread_id, record FROM threads").all() as { thread_id: string; record: string }[];
    return rows.map((r) => ({ threadId: r.thread_id, record: normalizeRecord(parse<Partial<ThreadRecord> & Record<string, unknown>>(r.record, {})) }));
  }

  compactOnIds(): string[] {
    return (this.db.prepare("SELECT thread_id FROM threads WHERE compact_on = 1").all() as { thread_id: string }[]).map((r) => r.thread_id);
  }

  /** Whether anything was ever stored: a first load after a reinstall finds rows here. */
  isEmpty(): boolean {
    return this.db.prepare("SELECT 1 FROM threads LIMIT 1").get() === undefined && this.db.prepare("SELECT 1 FROM history LIMIT 1").get() === undefined;
  }

  /** Forgets a thread bb deleted: its record and its turn log. */
  delete(threadId: string): void {
    this.db.prepare("DELETE FROM threads WHERE thread_id = ?").run(threadId);
    this.deleteTurnLog(threadId);
  }

  // ---- history ----

  addHistory(threadId: string, at: number, kind: HistoryKind, record: HistoryRecord): number {
    const result = this.db
      .prepare("INSERT INTO history (thread_id, at, kind, record) VALUES (?, ?, ?, ?)")
      .run(threadId, at, kind, JSON.stringify(record)) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  deleteHistory(id: number): void {
    this.db.prepare("DELETE FROM history WHERE id = ?").run(id);
  }

  setContextAfter(id: number, contextAfter: number): void {
    this.patchHistoryRecord(id, { contextAfter });
  }

  patchHistoryRecord(id: number, patch: Partial<HistoryRecord>): void {
    const row = this.db.prepare("SELECT record FROM history WHERE id = ?").get(id) as { record: string } | undefined;
    if (row === undefined) return;
    this.db.prepare("UPDATE history SET record = ? WHERE id = ?").run(JSON.stringify({ ...parse<HistoryRecord>(row.record, { usd: null }), ...patch }), id);
  }

  historyRow(id: number): HistoryRow | null {
    const r = this.db.prepare("SELECT id, thread_id, at, kind, record FROM history WHERE id = ?").get(id) as HistoryDbRow | undefined;
    return r === undefined ? null : historyOf(r);
  }

  /** Files an entry under another thread: a keep-warm that grew to several threads is listed under its tree's top. */
  retitleHistory(id: number, threadId: string): void {
    this.db.prepare("UPDATE history SET thread_id = ? WHERE id = ?").run(threadId, id);
  }

  /** The most recent entries since `since`, newest first; `kinds` leaves out the rest. */
  history(since: number, limit = 1000, kinds: readonly HistoryKind[] | null = null): HistoryRow[] {
    const filter = kinds === null ? "" : ` AND kind IN (${kinds.map(() => "?").join(", ")})`;
    const rows = this.db
      .prepare(`SELECT id, thread_id, at, kind, record FROM history WHERE at >= ?${filter} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(since, ...(kinds ?? []), limit) as HistoryDbRow[];
    return rows.map(historyOf);
  }

  /** The thread's most recent entry of one of `kinds`, or null. */
  lastHistory(threadId: string, kinds: readonly HistoryKind[]): HistoryRow | null {
    const r = this.db
      .prepare(`SELECT id, thread_id, at, kind, record FROM history WHERE thread_id = ? AND kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY at DESC, id DESC LIMIT 1`)
      .get(threadId, ...kinds) as HistoryDbRow | undefined;
    return r === undefined ? null : historyOf(r);
  }

  /** Count and cost by kind since `since`, summed in SQLite so a busy install's month is not read row by row. */
  sums(since: number): Record<string, { count: number; usd: number; avoidedUsd: number }> {
    const rows = this.db
      .prepare(
        `SELECT kind, count(*) AS n, total(json_extract(record, '$.usd')) AS usd, total(json_extract(record, '$.avoidedUsd')) AS avoided
         FROM history WHERE at >= ? AND kind != 'held' GROUP BY kind`,
      )
      .all(since) as { kind: string; n: number; usd: number; avoided: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, { count: r.n, usd: r.usd, avoidedUsd: r.avoided }]));
  }

  /** Deletes history and sends older than `before`, then gives the freed pages back to the file system. */
  prune(before: number): void {
    this.db.prepare("DELETE FROM history WHERE at < ?").run(before);
    this.db.prepare("DELETE FROM sends WHERE at < ?").run(before);
    this.db.exec("PRAGMA incremental_vacuum");
  }

  // ---- sends ----

  /**
   * Claims the send for `dueKey` before it goes: null when one was already
   * claimed for that thread and due time, whether it went or a restart cut it
   * short.
   */
  claimSend(send: Omit<SendRecord, "id" | "usd" | "measured" | "sending" | "historyId">): number | null {
    const { threadId, at, dueKey, ...rest } = send;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO sends (thread_id, at, history_id, record, due_key) VALUES (?, ?, 0, ?, ?)")
      .run(threadId, at, JSON.stringify({ ...rest, forecastUsd: Math.round(rest.forecastUsd * 1e9) / 1e9, usd: 0, sending: true }), dueKey) as { changes?: number; lastInsertRowid?: number | bigint };
    return result.changes === 0 ? null : Number(result.lastInsertRowid ?? 0);
  }

  /** The claim went: bb took the message, under history entry `historyId`. */
  confirmSend(id: number, historyId: number): void {
    const send = this.getSend(id);
    if (send === null) return;
    this.db.prepare("UPDATE sends SET history_id = ?, record = ? WHERE id = ?").run(historyId, recordOf({ ...send, sending: false }), id);
  }

  /** The claim did not go, and its due time may be tried again. */
  dropSend(id: number): void {
    this.db.prepare("DELETE FROM sends WHERE id = ?").run(id);
  }

  getSend(id: number): SendRecord | null {
    const row = this.db.prepare("SELECT id, thread_id, at, history_id, due_key, record FROM sends WHERE id = ?").get(id) as SendRow | undefined;
    return row === undefined ? null : sendOf(row);
  }

  /** The send to `threadId` with text hash `hash` that bb recorded as a request at `requestedAt`: the latest one made just before. */
  findSend(threadId: string, hash: string, requestedAt: number): SendRecord | null {
    const rows = this.db
      .prepare("SELECT id, thread_id, at, history_id, due_key, record FROM sends WHERE thread_id = ? AND at BETWEEN ? AND ? ORDER BY at DESC")
      .all(threadId, requestedAt - 10 * 60_000, requestedAt + 5_000) as SendRow[];
    return rows.map(sendOf).find((s) => s.hash === hash && !s.sending) ?? null;
  }

  /**
   * Adds `usd` of a turn in `incurredIn` to a send, and to its history row's
   * total and split. The first charge replaces the forecast the row showed; a
   * charge at the forecast keeps the row marked as an estimate.
   */
  chargeSend(id: number, incurredIn: string, usd: number, own: boolean, estimated = false): SendRecord | null {
    const send = this.getSend(id);
    if (send === null) return null;
    const next: SendRecord = { ...send, usd: send.usd + usd, measured: send.measured || own };
    this.db.prepare("UPDATE sends SET record = ? WHERE id = ?").run(recordOf(next), id);
    const row = this.historyRow(send.historyId);
    if (row !== null) {
      const split = { ...(row.record.split ?? {}) };
      split[incurredIn] = (split[incurredIn] ?? 0) + usd;
      const base = row.record.split === undefined ? 0 : (row.record.usd ?? 0);
      const wasEstimate = row.record.split !== undefined && row.record.estimated === true;
      this.patchHistoryRecord(send.historyId, row.record.coldWrite === true ? { split } : { usd: base + usd, split, estimated: estimated || wasEstimate });
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

  deleteTurnLog(threadId: string): void {
    this.db.prepare("DELETE FROM turn_logs WHERE thread_id = ?").run(threadId);
  }

  // ---- meta ----

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? null : parse<T | null>(row.value, null);
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  deleteMeta(key: string): void {
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }

  /** Runs `work` in one transaction. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

interface HistoryDbRow {
  id: number;
  thread_id: string;
  at: number;
  kind: HistoryKind;
  record: string;
}

const historyOf = (r: HistoryDbRow): HistoryRow => ({ id: r.id, threadId: r.thread_id, at: r.at, kind: r.kind, record: parse<HistoryRecord>(r.record, { usd: null }) });

interface SendRow {
  id: number;
  thread_id: string;
  at: number;
  history_id: number;
  due_key: string | null;
  record: string;
}

function sendOf(row: SendRow): SendRecord {
  const r = parse<Partial<SendRecord>>(row.record, {});
  return {
    id: row.id,
    threadId: row.thread_id,
    at: row.at,
    historyId: row.history_id,
    dueKey: row.due_key,
    kind: r.kind ?? "keep-warm",
    hash: r.hash ?? "",
    stretchStartedAt: r.stretchStartedAt ?? 0,
    forecastUsd: r.forecastUsd ?? 0,
    usd: r.usd ?? 0,
    measured: r.measured ?? false,
    sending: r.sending ?? false,
  };
}

/** The JSON a send's row keeps: what its columns do not. */
function recordOf(send: SendRecord): string {
  const { id: _id, threadId: _t, at: _a, historyId: _h, dueKey: _d, sending, measured, ...rest } = send;
  return JSON.stringify({ ...rest, usd: Math.round(rest.usd * 1e9) / 1e9, forecastUsd: Math.round(rest.forecastUsd * 1e9) / 1e9, ...(measured ? { measured } : {}), ...(sending ? { sending } : {}) });
}
