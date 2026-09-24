// Realtime channels, their payloads and the schemas the app validates them
// with. Nothing here imports the SDK, so the app bundle can use its values.
import { z } from "zod";
import type { PreferenceKey } from "./preferences";

const stampMapSchema = z.record(z.string(), z.number());

/** Per-thread timestamps (epoch ms) kept by the server. */
export const stampsSchema = z.object({
  startedAt: stampMapSchema,
  finishedAt: stampMapSchema,
  pendingAt: stampMapSchema,
  seenAt: stampMapSchema,
});
export type Stamps = z.infer<typeof stampsSchema>;
export type StampKind = keyof Stamps;

/**
 * Why a thread is blocked, failed or done, in one line: what the server saw
 * on `interaction.pending`, `thread.failed` and `thread.idle`. Text is whitespace-collapsed and at most NOTE_MAX_LENGTH.
 */
export const NOTE_MAX_LENGTH = 140;
export const noteSchema = z.object({
  /** question: asks the user; approval: a command, file or permission; plan: plan review; input: other requests. */
  kind: z.enum(["question", "approval", "plan", "input", "failed", "done"]),
  text: z.string().max(NOTE_MAX_LENGTH),
  at: z.number(),
});
export type Note = z.infer<typeof noteSchema>;
export const threadNotesSchema = z.object({
  /** The latest pending interaction. */
  pending: noteSchema.optional(),
  /** The latest failure. */
  failed: noteSchema.optional(),
  /** The last assistant text when the thread went idle. */
  done: noteSchema.optional(),
});
export type ThreadNotes = z.infer<typeof threadNotesSchema>;

/** Realtime channels the server publishes on. */
export const CHANNELS = {
  preferences: "preferences",
  stamps: "stamps",
  scheduled: "scheduled",
  notes: "notes",
} as const;

/** `notes` payload: one thread's notes replaced; null deletes them. */
export interface NotesSignal {
  threadId: string;
  notes: ThreadNotes | null;
}

/** `preferences` payload: one key changed. */
export interface PreferenceSignal {
  key: PreferenceKey;
  value: unknown;
}

/** `stamps` payload: one thread's stamp changed; null deletes it. */
export interface StampSignal {
  kind: StampKind;
  threadIds: string[];
  value: number | null;
}

/** `scheduled` payload: the whole map, replaced. */
export interface ScheduledSignal {
  status: "ready" | "error";
  scheduled: Record<string, number>;
}
