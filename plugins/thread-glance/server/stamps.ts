// Per-thread timestamps: one kv row per thread, `stamp:<threadId>`,
// holding whichever of the four kinds it has. Rows are read into memory once
// and written through, so listing does not read every row per call.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNELS, type StampKind, type StampSignal, type Stamps } from "../shared/contract";
import { createSerialQueue } from "./serial";

export const STAMP_KEY_PREFIX = "stamp:";
export const STAMP_KINDS: readonly StampKind[] = ["startedAt", "finishedAt", "pendingAt", "seenAt"];

export type ThreadStamps = Partial<Record<StampKind, number>>;

export function stampKvKey(threadId: string): string {
  return `${STAMP_KEY_PREFIX}${threadId}`;
}

/** Keeps the known kinds whose value is a finite number; null if none. */
export function parseThreadStamps(raw: unknown): ThreadStamps | null {
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
  list(): Promise<Stamps>;
  /** Sets `kind` to `at` for each thread and publishes one signal. */
  stamp(kind: StampKind, threadIds: readonly string[], at: number): Promise<void>;
  /** Deletes `kind` for each thread and publishes one signal with `value: null`. */
  clear(kind: StampKind, threadIds: readonly string[]): Promise<void>;
  /** Deletes every stamp of each thread. Publishes nothing. */
  forget(threadIds: readonly string[]): Promise<void>;
  /**
   * Forgets threads missing from `liveIds` whose newest stamp is older than
   * `before`, and returns their ids. Publishes nothing.
   *
   * `before` is when the caller started listing threads, so a thread created
   * after the list was read, and stamped since, is kept.
   */
  prune(liveIds: ReadonlySet<string>, before: number): Promise<string[]>;
}

export function createStampStore(
  bb: Pick<BbPluginApi, "storage" | "realtime" | "log">,
): StampStore {
  const { kv } = bb.storage;
  const serial = createSerialQueue();
  let cache: Map<string, ThreadStamps> | null = null;

  async function load(): Promise<Map<string, ThreadStamps>> {
    if (cache !== null) return cache;
    const loaded = new Map<string, ThreadStamps>();
    for (const key of await kv.list(STAMP_KEY_PREFIX)) {
      const threadId = key.slice(STAMP_KEY_PREFIX.length);
      const stamps = parseThreadStamps(await kv.get<unknown>(key));
      if (stamps === null) {
        bb.log.warn(`stored stamps for ${threadId} are invalid; dropping them`);
        await kv.delete(key);
        continue;
      }
      loaded.set(threadId, stamps);
    }
    cache = loaded;
    return loaded;
  }

  async function save(
    rows: Map<string, ThreadStamps>,
    threadId: string,
    stamps: ThreadStamps,
  ): Promise<void> {
    if (Object.keys(stamps).length === 0) {
      rows.delete(threadId);
      await kv.delete(stampKvKey(threadId));
      return;
    }
    rows.set(threadId, stamps);
    await kv.set(stampKvKey(threadId), stamps);
  }

  function publish(signal: StampSignal): void {
    bb.realtime.publish(CHANNELS.stamps, signal);
  }

  return {
    list: () =>
      serial(async () => {
        const result: Stamps = { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {} };
        for (const [threadId, stamps] of await load()) {
          for (const kind of STAMP_KINDS) {
            const value = stamps[kind];
            if (value !== undefined) result[kind][threadId] = value;
          }
        }
        return result;
      }),
    stamp: (kind, threadIds, at) =>
      serial(async () => {
        if (threadIds.length === 0) return;
        const rows = await load();
        for (const threadId of new Set(threadIds)) {
          await save(rows, threadId, { ...rows.get(threadId), [kind]: at });
        }
        publish({ kind, threadIds: [...threadIds], value: at });
      }),
    clear: (kind, threadIds) =>
      serial(async () => {
        if (threadIds.length === 0) return;
        const rows = await load();
        for (const threadId of new Set(threadIds)) {
          const current = rows.get(threadId);
          if (current?.[kind] === undefined) continue;
          const { [kind]: _removed, ...rest } = current;
          await save(rows, threadId, rest);
        }
        publish({ kind, threadIds: [...threadIds], value: null });
      }),
    forget: (threadIds) =>
      serial(async () => {
        const rows = await load();
        for (const threadId of threadIds) {
          if (rows.has(threadId)) await save(rows, threadId, {});
        }
      }),
    prune: (liveIds, before) =>
      serial(async () => {
        const rows = await load();
        const pruned: string[] = [];
        for (const [threadId, stamps] of [...rows]) {
          if (liveIds.has(threadId)) continue;
          if (Math.max(...Object.values(stamps)) >= before) continue;
          await save(rows, threadId, {});
          pruned.push(threadId);
        }
        return pruned;
      }),
  };
}
