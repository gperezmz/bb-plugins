// Per-thread tables in the plugin's own SQLite database, one row per thread
// id: `stamps` holds a column per stamp kind, NULL where the thread has none,
// and `notes` one JSON value, whose shape varies. Both lived in KV rows up to
// 0.7.0, and `moveFromKv` brings those over once.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STAMP_KINDS, type StampKind, type ThreadStamps } from "../shared/contract";

type Database = ReturnType<BbPluginApi["storage"]["database"]>;
type Kv = BbPluginApi["storage"]["kv"];

const KV_READ_BATCH = 50;

/**
 * The schema, one statement per migration. Append-only: bb records each
 * statement's hash and refuses a changed or reused index.
 */
export const MIGRATIONS: readonly string[] = [
  "CREATE TABLE stamps (thread_id TEXT PRIMARY KEY NOT NULL, started_at INTEGER, finished_at INTEGER, seen_at INTEGER, idle_at INTEGER, pending_at INTEGER) WITHOUT ROWID",
  "CREATE TABLE notes (thread_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL) WITHOUT ROWID",
];

const COLUMNS: Record<StampKind, string> = {
  startedAt: "started_at",
  finishedAt: "finished_at",
  seenAt: "seen_at",
  idleAt: "idle_at",
  pendingAt: "pending_at",
};

/** A table of one thread's values of type `T`. */
export interface ThreadTable<T> {
  /** Every row's thread id and its stored value. */
  all(): [threadId: string, value: T][];
  put(threadId: string, value: T): void;
  delete(threadId: string): void;
  /**
   * Moves every KV row under `prefix` into the table in one transaction, then
   * deletes those KV rows. A row the table already holds keeps its value, so
   * a move a restart cut short, run again, duplicates and overwrites nothing.
   * `accept` turns a KV value into the table's, or null to drop it. Returns
   * how many rows it moved.
   */
  moveFromKv(kv: Kv, prefix: string, accept: (threadId: string, value: unknown) => T | null): Promise<number>;
}

/** Reads every KV row under `prefix`, in parallel batches, since KV has no bulk read. */
async function readKvRows(kv: Kv, prefix: string): Promise<{ keys: string[]; rows: [string, unknown][] }> {
  const keys = await kv.list(prefix);
  const rows: [string, unknown][] = [];
  for (let start = 0; start < keys.length; start += KV_READ_BATCH) {
    const batch = keys.slice(start, start + KV_READ_BATCH);
    const values = await Promise.all(batch.map((key) => kv.get<unknown>(key)));
    batch.forEach((key, i) => {
      if (values[i] !== undefined) rows.push([key.slice(prefix.length), values[i]]);
    });
  }
  return { keys, rows };
}

function createTable<T>(
  db: Database,
  statements: { select: string; upsert: string; insertNew: string; remove: string },
  toRow: (threadId: string, value: T) => unknown[],
  fromRow: (row: unknown[]) => [string, T],
): ThreadTable<T> {
  // Rows as arrays: a cold read of thousands skips building an object per row.
  const select = db.prepare(statements.select).raw(true);
  const upsert = db.prepare(statements.upsert);
  const insertNew = db.prepare(statements.insertNew);
  const remove = db.prepare(statements.remove);
  const insertAll = db.transaction((rows: [string, T][]) => {
    for (const [threadId, value] of rows) insertNew.run(...toRow(threadId, value));
  });
  return {
    all: () => (select.all() as unknown[][]).map(fromRow),
    put: (threadId, value) => void upsert.run(...toRow(threadId, value)),
    delete: (threadId) => void remove.run(threadId),
    async moveFromKv(kv, prefix, accept) {
      const { keys, rows } = await readKvRows(kv, prefix);
      if (keys.length === 0) return 0;
      const accepted = rows.flatMap(([threadId, raw]): [string, T][] => {
        const value = accept(threadId, raw);
        return value === null ? [] : [[threadId, value]];
      });
      insertAll(accepted);
      for (const key of keys) await kv.delete(key);
      return accepted.length;
    },
  };
}

export function createStampTable(db: Database): ThreadTable<ThreadStamps> {
  const columns = STAMP_KINDS.map((kind) => COLUMNS[kind]);
  const insert = `(thread_id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`;
  return createTable<ThreadStamps>(
    db,
    {
      select: `SELECT thread_id, ${columns.join(", ")} FROM stamps`,
      upsert: `INSERT OR REPLACE INTO stamps ${insert}`,
      insertNew: `INSERT OR IGNORE INTO stamps ${insert}`,
      remove: "DELETE FROM stamps WHERE thread_id = ?",
    },
    (threadId, stamps) => [threadId, ...STAMP_KINDS.map((kind) => stamps[kind] ?? null)],
    (row) => {
      const stamps: ThreadStamps = {};
      STAMP_KINDS.forEach((kind, i) => {
        const value = row[i + 1];
        if (value !== null) stamps[kind] = value as number;
      });
      return [row[0] as string, stamps];
    },
  );
}

/** The notes table; a value that is not JSON reads as undefined. */
export function createNoteTable(db: Database): ThreadTable<unknown> {
  return createTable<unknown>(
    db,
    {
      select: "SELECT thread_id, data FROM notes",
      upsert: "INSERT OR REPLACE INTO notes (thread_id, data) VALUES (?, ?)",
      insertNew: "INSERT OR IGNORE INTO notes (thread_id, data) VALUES (?, ?)",
      remove: "DELETE FROM notes WHERE thread_id = ?",
    },
    (threadId, notes) => [threadId, JSON.stringify(notes)],
    (row) => {
      try {
        return [row[0] as string, JSON.parse(row[1] as string) as unknown];
      } catch {
        return [row[0] as string, undefined];
      }
    },
  );
}
