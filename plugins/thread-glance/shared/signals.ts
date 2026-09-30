// Realtime channels, their payloads and the schemas the app validates them
// with. Nothing here imports the SDK, so the app bundle can use its values.
import * as z from "zod/mini";
import type { PreferenceKey } from "./preferences";

/** Epoch ms per thread id. */
export const stampMapSchema = z.record(z.string(), z.number());

/** Per-thread timestamps (epoch ms), one map per kind, as the list reads them. */
export const stampsSchema = z.object({
  startedAt: stampMapSchema,
  finishedAt: stampMapSchema,
  pendingAt: stampMapSchema,
  seenAt: stampMapSchema,
  /** When a window saw the thread go from busy to idle, the latest such moment. */
  idleAt: stampMapSchema,
});
export type Stamps = z.infer<typeof stampsSchema>;
export type StampKind = keyof Stamps;
export const STAMP_KINDS: readonly StampKind[] = ["startedAt", "finishedAt", "pendingAt", "seenAt", "idleAt"];

/** One thread's stamps, whichever kinds it has. */
export const threadStampsSchema = z.object({
  startedAt: z.optional(z.number()),
  finishedAt: z.optional(z.number()),
  pendingAt: z.optional(z.number()),
  seenAt: z.optional(z.number()),
  idleAt: z.optional(z.number()),
});
export type ThreadStamps = z.infer<typeof threadStampsSchema>;

/**
 * Why a thread is blocked, failed or done, in one line: what the server saw
 * on `interaction.pending`, `thread.failed` and `thread.idle`. Text is whitespace-collapsed and at most NOTE_MAX_LENGTH.
 */
export const NOTE_MAX_LENGTH = 140;
export const noteSchema = z.object({
  /** question: asks the user; approval: a command, file or permission; plan: plan review; input: other requests. */
  kind: z.enum(["question", "approval", "plan", "input", "failed", "done"]),
  text: z.string().check(z.maxLength(NOTE_MAX_LENGTH)),
  at: z.number(),
});
export type Note = z.infer<typeof noteSchema>;
export const threadNotesSchema = z.object({
  /** The latest pending interaction. */
  pending: z.optional(noteSchema),
  /** The latest failure. */
  failed: z.optional(noteSchema),
  /** The last assistant text when the thread went idle. */
  done: z.optional(noteSchema),
});
export type ThreadNotes = z.infer<typeof threadNotesSchema>;

/** A thread record: one thread's stamps and notes, null where it has none. */
export const threadRecordSchema = z.object({
  stamps: z.nullable(threadStampsSchema),
  notes: z.nullable(threadNotesSchema),
});
export type ThreadRecord = z.infer<typeof threadRecordSchema>;
/** Thread records by thread id. */
export const threadRecordsSchema = z.record(z.string(), threadRecordSchema);

/**
 * Where a window stands in the server's changes: the server's epoch, new on
 * every server start, and the last revision it saw of that epoch.
 */
export const syncPointSchema = z.object({
  epoch: z.string(),
  revision: z.number(),
});
export type SyncPoint = z.infer<typeof syncPointSchema>;

/** Realtime channels the server publishes on. */
export const CHANNELS = {
  preferences: "preferences",
  scheduled: "scheduled",
  records: "records",
} as const;

/**
 * `records` payload: every thread record one change touched, whole, at the
 * revision it made. A thread whose stamps and notes are gone has both null.
 */
export const recordsSignalSchema = z.object({
  epoch: z.string(),
  revision: z.number(),
  records: threadRecordsSchema,
});
export type RecordsSignal = z.infer<typeof recordsSignalSchema>;

/** `preferences` payload: one key changed. */
export interface PreferenceSignal {
  key: PreferenceKey;
  value: unknown;
}

/** `scheduled` payload: the whole map, replaced. */
export interface ScheduledSignal {
  status: "ready" | "error";
  scheduled: Record<string, number>;
}
