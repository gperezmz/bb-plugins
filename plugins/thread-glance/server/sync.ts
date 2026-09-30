// The revision log behind `sync`: every change to a thread record takes the
// next revision of this server's epoch and is published as one `records`
// signal. Revisions live in memory; a server start opens a new epoch, and a
// window from an older one gets a full answer.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CHANNELS,
  type RecordsSignal,
  type SyncPoint,
  type ThreadNotes,
  type ThreadRecord,
  type ThreadStamps,
} from "../shared/signals";
import type { ArchivedThreads } from "./archived";
import type { NoteStore } from "./notes";
import type { StampStore } from "./stamps";

interface RecordsAnswer extends SyncPoint {
  /** True when `records` holds the record of every thread not archived, to replace what the window held. */
  full: boolean;
  records: Record<string, ThreadRecord>;
}

export interface RecordLog {
  readonly epoch: string;
  /** Takes a revision for the changes to `threadIds` and publishes their records in one signal; nothing when empty. */
  publish(threadIds: readonly string[]): Promise<void>;
  /**
   * The records changed since `since`, or, when `since` is null or from
   * another epoch, those of every thread not archived.
   */
  since(since: SyncPoint | null): Promise<RecordsAnswer>;
  /** The records of `threadIds` that have any, archived or not. */
  fetch(threadIds: readonly string[]): Promise<Omit<RecordsAnswer, "full">>;
}

function recordOf(stamps: ThreadStamps | undefined, notes: ThreadNotes | undefined): ThreadRecord {
  return { stamps: stamps ?? null, notes: notes ?? null };
}

export function createRecordLog(
  bb: Pick<BbPluginApi, "realtime">,
  stores: { stamps: StampStore; notes: NoteStore; archived: ArchivedThreads },
): RecordLog {
  const epoch = randomUUID();
  let revision = 0;
  /** The revision of each thread's last change in this epoch. */
  const changed = new Map<string, number>();

  async function recordsOf(threadIds: Iterable<string>, keepEmpty: boolean): Promise<Record<string, ThreadRecord>> {
    const [stamps, notes] = await Promise.all([stores.stamps.all(), stores.notes.all()]);
    const records: Record<string, ThreadRecord> = {};
    for (const threadId of threadIds) {
      const record = recordOf(stamps.get(threadId), notes.get(threadId));
      if (keepEmpty || record.stamps !== null || record.notes !== null) records[threadId] = record;
    }
    return records;
  }

  return {
    epoch,
    async publish(threadIds) {
      if (threadIds.length === 0) return;
      revision += 1;
      const taken = revision;
      for (const threadId of threadIds) changed.set(threadId, taken);
      const signal: RecordsSignal = { epoch, revision: taken, records: await recordsOf(new Set(threadIds), true) };
      bb.realtime.publish(CHANNELS.records, signal);
    },
    async since(since) {
      const current = revision;
      if (since !== null && since.epoch === epoch && since.revision <= current) {
        const ids = [...changed].flatMap(([threadId, changedAt]) => (changedAt > since.revision ? [threadId] : []));
        return { epoch, revision: current, full: false, records: await recordsOf(ids, true) };
      }
      await stores.archived.listed();
      const [stamps, notes] = await Promise.all([stores.stamps.all(), stores.notes.all()]);
      const ids = new Set([...stamps.keys(), ...notes.keys()].filter((threadId) => !stores.archived.has(threadId)));
      return { epoch, revision: current, full: true, records: await recordsOf(ids, false) };
    },
    async fetch(threadIds) {
      const current = revision;
      return { epoch, revision: current, records: await recordsOf(new Set(threadIds), false) };
    },
  };
}
