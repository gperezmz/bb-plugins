// The revision log behind `sync`: every change to a thread record takes the
// next revision of this server's epoch and is published as one `records`
// signal. Revisions live in memory; a server start opens a new epoch, and a
// window from an older one gets a full answer.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHANNELS, type RecordsSignal, type SyncPoint, type ThreadRecord } from "../shared/signals";
import type { ArchivedThreads } from "./archived";
import type { LifecycleStore } from "./lifecycle-store";

export interface RecordsAnswer extends SyncPoint {
  /** True when `records` holds the record of every thread not archived, to replace what the window held. */
  full: boolean;
  records: Record<string, ThreadRecord>;
}

export interface RecordLog {
  readonly epoch: string;
  /** Takes a revision for the changes to `threadIds` and publishes their records in one signal; nothing when empty. */
  publish(threadIds: readonly string[]): void;
  /**
   * The records changed since `since`, or, when `since` is null or from
   * another epoch, those of every thread not archived.
   */
  since(since: SyncPoint | null): Promise<RecordsAnswer>;
}

export function createRecordLog(
  bb: Pick<BbPluginApi, "realtime">,
  stores: { lifecycle: LifecycleStore; archived: ArchivedThreads },
  epoch: string = randomUUID(),
): RecordLog {
  let revision = 0;
  /** The revision of each thread's last change in this epoch. */
  const changed = new Map<string, number>();

  const recordOf = (threadId: string): ThreadRecord => ({ lifecycle: stores.lifecycle.get(threadId) });

  return {
    epoch,
    publish(threadIds) {
      if (threadIds.length === 0) return;
      revision += 1;
      for (const threadId of threadIds) changed.set(threadId, revision);
      const records: Record<string, ThreadRecord> = {};
      for (const threadId of new Set(threadIds)) records[threadId] = recordOf(threadId);
      const signal: RecordsSignal = { epoch, revision, records };
      bb.realtime.publish(CHANNELS.records, signal);
    },
    async since(since) {
      if (since !== null && since.epoch === epoch && since.revision <= revision) {
        const records: Record<string, ThreadRecord> = {};
        for (const [threadId, changedAt] of changed) if (changedAt > since.revision) records[threadId] = recordOf(threadId);
        return { epoch, revision, full: false, records };
      }
      await stores.archived.listed();
      const records: Record<string, ThreadRecord> = {};
      for (const threadId of stores.lifecycle.all().keys()) {
        if (!stores.archived.has(threadId)) records[threadId] = recordOf(threadId);
      }
      return { epoch, revision, full: true, records };
    },
  };
}
