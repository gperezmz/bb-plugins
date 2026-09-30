// Per-thread timestamps: one row per thread in the plugin database's `stamps`
// table, a column per kind, NULL where the thread has none. Rows are read into memory
// once and written through, so reading does not query every row per call.
// The store publishes nothing: its caller publishes the thread records a
// change touched.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STAMP_KINDS, type StampKind, type ThreadStamps } from "../shared/contract";
import { createSerialQueue } from "./serial";
import type { ThreadTable } from "./thread-table";

/** The KV rows stamps lived in up to 0.7.0, `stamp:<threadId>`. */
const STAMP_KEY_PREFIX = "stamp:";

export function stampKvKey(threadId: string): string {
  return `${STAMP_KEY_PREFIX}${threadId}`;
}

/** Keeps the known kinds whose value is a finite number; null if none. */
function parseThreadStamps(raw: unknown): ThreadStamps | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const result: ThreadStamps = {};
  for (const kind of STAMP_KINDS) {
    const value = record[kind];
    if (typeof value === "number" && Number.isFinite(value)) result[kind] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export interface StampStore {
  /** Every thread's stamps. The map is the store's own: read it, do not change it. */
  all(): Promise<ReadonlyMap<string, ThreadStamps>>;
  get(threadId: string): Promise<ThreadStamps | undefined>;
  /** Sets `kind` to `at` for each thread, and returns the threads it set. */
  stamp(kind: StampKind, threadIds: readonly string[], at: number): Promise<string[]>;
  /**
   * Sets `kind` to `at` for each thread whose stored value is earlier or
   * absent, and returns those. A later value is kept, so an event carrying an
   * earlier moment cannot move it back.
   */
  advance(kind: StampKind, threadIds: readonly string[], at: number): Promise<string[]>;
  /** Deletes `kind` for each thread that has it, and returns those. */
  clear(kind: StampKind, threadIds: readonly string[]): Promise<string[]>;
  /** Deletes every stamp of each thread, and returns the threads that had any. */
  forget(threadIds: readonly string[]): Promise<string[]>;
  /**
   * Forgets threads missing from `liveIds` whose newest stamp is older than
   * `before`, and returns their ids.
   *
   * `before` is when the caller started listing threads, so a thread created
   * after the list was read, and stamped since, is kept.
   */
  prune(liveIds: ReadonlySet<string>, before: number): Promise<string[]>;
}

export function createStampStore(
  bb: Pick<BbPluginApi, "storage" | "log">,
  table: ThreadTable<ThreadStamps>,
): StampStore {
  const serial = createSerialQueue();
  let cache: Map<string, ThreadStamps> | null = null;

  async function load(): Promise<Map<string, ThreadStamps>> {
    if (cache !== null) return cache;
    // The typed columns hold only valid stamps, so rows are checked once,
    // on their way in from KV.
    const moved = await table.moveFromKv(bb.storage.kv, STAMP_KEY_PREFIX, (threadId, raw) => {
      const stamps = parseThreadStamps(raw);
      if (stamps === null) bb.log.warn(`stored stamps for ${threadId} are invalid; dropping them`);
      return stamps;
    });
    if (moved > 0) bb.log.info(`moved the stamps of ${moved} threads from KV into the plugin database`);
    const loaded = new Map<string, ThreadStamps>();
    for (const [threadId, stamps] of table.all()) {
      if (Object.keys(stamps).length > 0) loaded.set(threadId, stamps);
    }
    cache = loaded;
    return loaded;
  }

  function save(rows: Map<string, ThreadStamps>, threadId: string, stamps: ThreadStamps): void {
    if (Object.keys(stamps).length === 0) {
      rows.delete(threadId);
      table.delete(threadId);
      return;
    }
    rows.set(threadId, stamps);
    table.put(threadId, stamps);
  }

  return {
    all: () => serial(load),
    get: (threadId) => serial(async () => (await load()).get(threadId)),
    stamp: (kind, threadIds, at) =>
      serial(async () => {
        const rows = await load();
        const stamped = [...new Set(threadIds)];
        for (const threadId of stamped) save(rows, threadId, { ...rows.get(threadId), [kind]: at });
        return stamped;
      }),
    advance: (kind, threadIds, at) =>
      serial(async () => {
        const rows = await load();
        const moved: string[] = [];
        for (const threadId of new Set(threadIds)) {
          const current = rows.get(threadId);
          if ((current?.[kind] ?? -Infinity) >= at) continue;
          save(rows, threadId, { ...current, [kind]: at });
          moved.push(threadId);
        }
        return moved;
      }),
    clear: (kind, threadIds) =>
      serial(async () => {
        const rows = await load();
        const cleared: string[] = [];
        for (const threadId of new Set(threadIds)) {
          const current = rows.get(threadId);
          if (current?.[kind] === undefined) continue;
          const { [kind]: _removed, ...rest } = current;
          save(rows, threadId, rest);
          cleared.push(threadId);
        }
        return cleared;
      }),
    forget: (threadIds) =>
      serial(async () => {
        const rows = await load();
        const forgotten = [...new Set(threadIds)].filter((threadId) => rows.has(threadId));
        for (const threadId of forgotten) save(rows, threadId, {});
        return forgotten;
      }),
    prune: (liveIds, before) =>
      serial(async () => {
        const rows = await load();
        const pruned: string[] = [];
        for (const [threadId, stamps] of [...rows]) {
          if (liveIds.has(threadId)) continue;
          if (Math.max(...Object.values(stamps)) >= before) continue;
          save(rows, threadId, {});
          pruned.push(threadId);
        }
        return pruned;
      }),
  };
}
