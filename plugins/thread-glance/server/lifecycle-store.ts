// Lifecycle rows: one row per thread in the plugin database's
// `thread_lifecycle` table. Rows are read into memory once and written
// through. The store publishes nothing: its caller publishes the thread
// records a change touched.
import { EMPTY_ROW, isEmptyRow, sameRow, type LifecycleRow } from "../shared/lifecycle";
import type { Database } from "./database";

export interface LifecycleStore {
  /** Every row. The map is the store's own: read it, do not change it. */
  all(): ReadonlyMap<string, LifecycleRow>;
  get(threadId: string): LifecycleRow | null;
  /**
   * Stores each row, or deletes the thread's row for a null or empty one, in
   * one transaction. Returns the threads whose row changed.
   */
  putMany(rows: Iterable<readonly [threadId: string, row: LifecycleRow | null]>): string[];
  /** Deletes the rows of `threadIds` and returns the threads that had one. */
  forget(threadIds: Iterable<string>): string[];
  /** Deletes the rows of threads missing from `liveIds` and returns those threads. */
  prune(liveIds: ReadonlySet<string>): string[];
}

type Raw = [string, number | null, string | null, number | null, number | null, number | null, number];

/** SQLite keeps whatever a column is given, so anything but a finite number reads as absent. */
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowOf(raw: Raw): LifecycleRow {
  const settledAt = number(raw[1]);
  return {
    settledAt,
    settledKind: settledAt === null ? null : raw[2] === "auto" ? "auto" : "manual",
    parkedAt: number(raw[3]),
    snoozeUntil: number(raw[4]),
    snoozedAt: number(raw[5]),
    activeOverride: raw[6] === 1,
  };
}

export function createLifecycleStore(db: Database): LifecycleStore {
  const select = db
    .prepare(
      "SELECT thread_id, settled_at, settled_kind, parked_at, snooze_until, snoozed_at, active_override FROM thread_lifecycle",
    )
    .raw(true);
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO thread_lifecycle (thread_id, settled_at, settled_kind, parked_at, snooze_until, snoozed_at, active_override) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const remove = db.prepare("DELETE FROM thread_lifecycle WHERE thread_id = ?");
  const rows = new Map<string, LifecycleRow>();
  for (const raw of select.all() as Raw[]) {
    const row = rowOf(raw);
    if (!isEmptyRow(row)) rows.set(raw[0], row);
  }

  const write = db.transaction((entries: readonly (readonly [string, LifecycleRow | null])[]) => {
    const changed: string[] = [];
    for (const [threadId, row] of entries) {
      const next = row === null || isEmptyRow(row) ? null : row;
      if (sameRow(rows.get(threadId) ?? EMPTY_ROW, next ?? EMPTY_ROW)) continue;
      if (next === null) {
        remove.run(threadId);
        rows.delete(threadId);
      } else {
        upsert.run(
          threadId,
          next.settledAt,
          next.settledKind,
          next.parkedAt,
          next.snoozeUntil,
          next.snoozedAt,
          next.activeOverride ? 1 : 0,
        );
        rows.set(threadId, next);
      }
      changed.push(threadId);
    }
    return changed;
  });

  return {
    all: () => rows,
    get: (threadId) => rows.get(threadId) ?? null,
    putMany: (entries) => write([...entries]),
    forget: (threadIds) => write([...new Set(threadIds)].filter((id) => rows.has(id)).map((id) => [id, null] as const)),
    prune: (liveIds) => write([...rows.keys()].filter((id) => !liveIds.has(id)).map((id) => [id, null] as const)),
  };
}
