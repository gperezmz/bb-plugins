// The server's thread records as a window holds them, and the pure steps that
// change them: a `sync` answer and a `records` signal. Each record keeps the
// revision it came at, so an answer computed before a signal cannot put back
// what the signal replaced.
import { sameRow, type LifecycleRow } from "@/shared/lifecycle";
import type { SyncPoint, ThreadRecord } from "@/shared/signals";

export interface HeldRecords {
  /** The lifecycle row of every thread that has one. */
  lifecycle: Readonly<Record<string, LifecycleRow>>;
  /** The server epoch and revision this window has seen up to; null before the first answer. */
  point: SyncPoint | null;
  /** Each thread's revision, as its record last came; a deleted row keeps its revision. */
  revisions: ReadonlyMap<string, number>;
}

export const NO_RECORDS: HeldRecords = { lifecycle: {}, point: null, revisions: new Map() };

/** Thread records at one revision of one epoch. */
export interface RecordsAt extends SyncPoint {
  records: Readonly<Record<string, ThreadRecord>>;
}

function sameEpoch(held: HeldRecords, epoch: string): boolean {
  return held.point !== null && held.point.epoch === epoch;
}

/** `held` with each record of `records` put in place at `revision`, unless a later one is already held. */
function withRecords(held: HeldRecords, records: Readonly<Record<string, ThreadRecord>>, revision: number): HeldRecords {
  let lifecycle: Record<string, LifecycleRow> | null = null;
  let revisions: Map<string, number> | null = null;
  for (const [threadId, record] of Object.entries(records)) {
    if ((held.revisions.get(threadId) ?? -1) > revision) continue;
    revisions ??= new Map(held.revisions);
    revisions.set(threadId, revision);
    const current = (lifecycle ?? held.lifecycle)[threadId];
    if (record.lifecycle === null) {
      if (current === undefined) continue;
      lifecycle ??= { ...held.lifecycle };
      delete lifecycle[threadId];
    } else if (current === undefined || !sameRow(current, record.lifecycle)) {
      lifecycle ??= { ...held.lifecycle };
      lifecycle[threadId] = record.lifecycle;
    }
  }
  if (revisions === null) return held;
  return { ...held, lifecycle: lifecycle ?? held.lifecycle, revisions };
}

/** Takes a `sync` answer: a full one replaces what was held, a delta changes what it names. */
export function applySync(held: HeldRecords, answer: RecordsAt & { full: boolean }): HeldRecords {
  const same = sameEpoch(held, answer.epoch);
  const point = { epoch: answer.epoch, revision: Math.max(answer.revision, same ? held.point!.revision : 0) };
  if (!answer.full) return { ...withRecords(held, answer.records, answer.revision), point };
  // Records that came by signal after this answer was made stay.
  const later: Record<string, ThreadRecord> = {};
  if (same) {
    for (const [threadId, revision] of held.revisions) {
      if (revision > answer.revision) later[threadId] = { lifecycle: held.lifecycle[threadId] ?? null };
    }
  }
  const replaced = withRecords({ ...NO_RECORDS, point }, answer.records, answer.revision);
  const merged = withRecordsKeepingRevisions(replaced, later, held.revisions);
  // A row that did not change keeps the object it was, so what reads it sees no change.
  let lifecycle: Record<string, LifecycleRow> | null = null;
  for (const [threadId, row] of Object.entries(merged.lifecycle)) {
    const before = held.lifecycle[threadId];
    if (before === undefined || before === row || !sameRow(before, row)) continue;
    lifecycle ??= { ...merged.lifecycle };
    lifecycle[threadId] = before;
  }
  return { ...merged, lifecycle: lifecycle ?? merged.lifecycle, point };
}

/** `held` with `records` put in place, each at the revision `revisions` gives it. */
function withRecordsKeepingRevisions(
  held: HeldRecords,
  records: Readonly<Record<string, ThreadRecord>>,
  revisions: ReadonlyMap<string, number>,
): HeldRecords {
  let next = held;
  for (const [threadId, record] of Object.entries(records)) {
    next = withRecords(next, { [threadId]: record }, revisions.get(threadId) ?? 0);
  }
  return next;
}

/** Takes a `records` signal; null when it comes from another epoch, which only a full `sync` settles. */
export function applySignal(held: HeldRecords, signal: RecordsAt): HeldRecords | null {
  if (!sameEpoch(held, signal.epoch)) return held.point === null ? held : null;
  const next = withRecords(held, signal.records, signal.revision);
  return signal.revision > held.point!.revision ? { ...next, point: { epoch: signal.epoch, revision: signal.revision } } : next;
}

/** Records built from rows cached in the browser: shown until the first answer lands; no point, no revisions. */
export function recordsFromCache(lifecycle: Readonly<Record<string, LifecycleRow>>): HeldRecords {
  return { ...NO_RECORDS, lifecycle };
}
