// The server's data as a window holds it, and the pure steps that change it:
// a `sync` answer, a `records` signal, a batch fetched by id. Each thread
// record keeps the revision it came at, so an answer computed before a
// signal cannot put back what the signal replaced.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  STAMP_KINDS,
  type RecordsSignal,
  type StampKind,
  type Stamps,
  type SyncPoint,
  type ThreadNotes,
  type ThreadRecord,
} from "@/shared/contract";

/** Thread records as the list reads them: stamps by kind, notes by thread. */
export interface Records {
  stamps: Stamps;
  notes: Readonly<Record<string, ThreadNotes>>;
}

export interface HeldRecords extends Records {
  /** The server epoch and revision this window has seen up to; null before the first answer. */
  point: SyncPoint | null;
  /** Each thread's revision, as its record last came. */
  revisions: ReadonlyMap<string, number>;
  /** Threads this window has asked about by id in this epoch, answered or not. */
  asked: ReadonlySet<string>;
}

export const NO_STAMPS: Stamps = { startedAt: {}, finishedAt: {}, pendingAt: {}, seenAt: {}, idleAt: {} };

export const NO_RECORDS: HeldRecords = {
  stamps: NO_STAMPS,
  notes: {},
  point: null,
  revisions: new Map(),
  asked: new Set(),
};

/** Thread records at one revision of one epoch: what `sync`, a signal or a fetch by id brings. */
export interface RecordsAt extends SyncPoint {
  records: Readonly<Record<string, ThreadRecord>>;
}

/** `held` with each record of `records` put in place, at `revision`, unless a later one is already held. */
function withRecords(held: HeldRecords, records: Readonly<Record<string, ThreadRecord>>, revision: number): HeldRecords {
  let stamps: Stamps | null = null;
  let notes: Record<string, ThreadNotes> | null = null;
  let revisions: Map<string, number> | null = null;
  for (const [threadId, record] of Object.entries(records)) {
    if ((held.revisions.get(threadId) ?? -1) > revision) continue;
    revisions ??= new Map(held.revisions);
    revisions.set(threadId, revision);
    for (const kind of STAMP_KINDS) {
      const value = record.stamps?.[kind];
      const current = (stamps ?? held.stamps)[kind][threadId];
      if (value === current) continue;
      stamps ??= { ...held.stamps };
      if (stamps[kind] === held.stamps[kind]) stamps[kind] = { ...held.stamps[kind] };
      if (value === undefined) delete stamps[kind][threadId];
      else stamps[kind][threadId] = value;
    }
    const currentNotes = (notes ?? held.notes)[threadId];
    if (record.notes === null && currentNotes === undefined) continue;
    if (record.notes !== null && currentNotes !== undefined && JSON.stringify(record.notes) === JSON.stringify(currentNotes)) continue;
    notes ??= { ...held.notes };
    if (record.notes === null) delete notes[threadId];
    else notes[threadId] = record.notes;
  }
  if (revisions === null) return held;
  return { ...held, stamps: stamps ?? held.stamps, notes: notes ?? held.notes, revisions };
}

/** Takes a `sync` answer: a full one replaces what was held, a delta changes what it names. */
export function applySync(held: HeldRecords, answer: RecordsAt & { full: boolean }): HeldRecords {
  const point = { epoch: answer.epoch, revision: Math.max(answer.revision, sameEpoch(held, answer.epoch) ? held.point!.revision : 0) };
  if (!answer.full) return { ...withRecords(held, answer.records, answer.revision), point };
  // Records that came by signal after this answer was made stay.
  const later: Record<string, ThreadRecord> = {};
  if (sameEpoch(held, answer.epoch)) {
    for (const [threadId, revision] of held.revisions) {
      if (revision > answer.revision) later[threadId] = recordOf(held, threadId);
    }
  }
  const replaced = withRecords({ ...NO_RECORDS, point }, answer.records, answer.revision);
  const merged = withRecords(replaced, later, point.revision);
  return { ...merged, point, asked: new Set() };
}

/** Takes a `records` signal; null when it comes from another epoch, which only a full `sync` settles. */
export function applySignal(held: HeldRecords, signal: RecordsSignal): HeldRecords | null {
  if (!sameEpoch(held, signal.epoch)) return held.point === null ? held : null;
  const next = withRecords(held, signal.records, signal.revision);
  return signal.revision > held.point!.revision ? { ...next, point: { epoch: signal.epoch, revision: signal.revision } } : next;
}

/** Takes the answer to a fetch by id of `threadIds`; a thread absent from it has no record. */
export function applyFetched(held: HeldRecords, threadIds: readonly string[], answer: RecordsAt): HeldRecords {
  if (!sameEpoch(held, answer.epoch)) return held;
  return markAsked(withRecords(held, answer.records, answer.revision), threadIds);
}

/** Marks `threadIds` asked, so a fetch in flight is not sent again. */
export function markAsked(held: HeldRecords, threadIds: readonly string[]): HeldRecords {
  const asked = new Set(held.asked);
  for (const threadId of threadIds) asked.add(threadId);
  return { ...held, asked };
}

/** A stamp this window changed before the server's signal confirms it. */
export function applyLocalStamp(held: HeldRecords, kind: StampKind, threadIds: readonly string[], value: number | null): HeldRecords {
  const map = { ...held.stamps[kind] };
  for (const threadId of threadIds) {
    if (value === null) delete map[threadId];
    else map[threadId] = value;
  }
  return { ...held, stamps: { ...held.stamps, [kind]: map } };
}

/**
 * The threads in bb's list to fetch by id: those the window holds no record
 * of and has not asked about in this epoch, created before `liveSince`.
 * `sync` leaves archived threads out, and one unarchived without an event
 * reaching the server looks the same; a thread created since the window went
 * live gets its record by signal.
 */
export function threadsToFetch(held: HeldRecords, threads: readonly PluginSidebarThread[], liveSince: number): string[] {
  if (held.point === null) return [];
  return threads.flatMap((thread) =>
    thread.createdAt < liveSince && !held.revisions.has(thread.id) && !held.asked.has(thread.id) ? [thread.id] : [],
  );
}

function sameEpoch(held: HeldRecords, epoch: string): boolean {
  return held.point !== null && held.point.epoch === epoch;
}

function recordOf(held: HeldRecords, threadId: string): ThreadRecord {
  const stamps: Record<string, number> = {};
  for (const kind of STAMP_KINDS) {
    const value = held.stamps[kind][threadId];
    if (value !== undefined) stamps[kind] = value;
  }
  return { stamps: Object.keys(stamps).length > 0 ? stamps : null, notes: held.notes[threadId] ?? null };
}
