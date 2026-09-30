// One-line notes on why a thread is blocked, failed or done: one row per
// thread in the plugin database's `notes` table, read into memory once and
// written through. The store publishes nothing: its caller publishes the
// thread records a change touched.
import type { BbPluginApi, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { NOTE_MAX_LENGTH, noteSchema, type Note, type ThreadNotes } from "../shared/signals";
import { createSerialQueue } from "./serial";
import type { ThreadTable } from "./thread-table";

/** The KV rows notes lived in up to 0.7.0, `note:<threadId>`. */
const NOTE_KEY_PREFIX = "note:";
/** bb's builtin plugin that lets any provider ask a multiple-choice question. */
const ASK_USER_QUESTION_PLUGIN_ID = "ask-user-question";
const FALLBACK_PENDING_TEXT = "Needs your input";

type PendingInteraction = PluginThreadEventPayloads["interaction.pending"]["interaction"];
type NoteSlot = keyof ThreadNotes;
export type NoteDraft = Pick<Note, "kind" | "text">;

export function noteKvKey(threadId: string): string {
  return `${NOTE_KEY_PREFIX}${threadId}`;
}

/**
 * Collapses whitespace, strips leading markdown headings, bullets, numbers
 * and quote marks, and truncates to NOTE_MAX_LENGTH with an ellipsis.
 */
export function noteText(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  for (;;) {
    const stripped = text.replace(/^(?:#{1,6}|[-*+>]|\d+[.)])\s+/, "");
    if (stripped === text) break;
    text = stripped;
  }
  if (text.length <= NOTE_MAX_LENGTH) return text;
  return `${text.slice(0, NOTE_MAX_LENGTH - 1).trimEnd()}…`;
}

/** The first line with text, without its markdown heading marks. */
function firstNonEmptyLine(text: string): string {
  for (const line of text.split("\n")) {
    const stripped = line.replace(/^\s*#+/, "").trim();
    if (stripped !== "") return stripped;
  }
  return "";
}

function withMore(first: string, total: number): string {
  return total > 1 ? `${first} (+${total - 1} more)` : first;
}

/** The first question's prompt from a `{ questions: [{ prompt }] }` object. */
function questionsText(data: unknown): string | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const questions = (data as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const prompt = (questions[0] as { prompt?: unknown } | null)?.prompt;
  return typeof prompt === "string" && prompt.trim() !== ""
    ? withMore(prompt, questions.length)
    : null;
}

function approvalText(subjectText: string, reason: string | null): string {
  return subjectText.trim() === "" && reason ? reason : subjectText;
}

function describeRaw(interaction: PendingInteraction): NoteDraft {
  const payload = interaction.payload as { kind: string };
  switch (interaction.payload.kind) {
    case "user_question": {
      const { questions } = interaction.payload;
      const first = questions[0]?.prompt ?? "";
      return { kind: "question", text: withMore(first, questions.length) };
    }
    case "approval": {
      const { subject, reason } = interaction.payload;
      switch (subject.kind) {
        case "command":
          return { kind: "approval", text: approvalText(subject.command, reason) };
        case "file_change":
          return {
            kind: "approval",
            text: `File changes${subject.writeScope ? ` in ${subject.writeScope}` : ""}`,
          };
        case "permission_grant":
          return {
            kind: "approval",
            text: `Permissions${subject.toolName ? ` for ${subject.toolName}` : ""}`,
          };
        case "tool_use":
          return { kind: "approval", text: subject.presentation.title ?? subject.tool };
        case "plan":
          return { kind: "plan", text: firstNonEmptyLine(subject.plan) };
        default:
          return { kind: "approval", text: reason ?? "" };
      }
    }
    case "plugin": {
      if (interaction.origin?.kind !== "plugin") break;
      const { title, presentation, data } = interaction.payload as {
        title: string;
        presentation?: { detail?: string };
        data: unknown;
      };
      if (interaction.origin.pluginId === ASK_USER_QUESTION_PLUGIN_ID) {
        return { kind: "question", text: questionsText(data) ?? title };
      }
      const detail = presentation?.detail ? noteText(presentation.detail) : "";
      const combined = `${title}: ${detail}`;
      return {
        kind: "input",
        text: detail !== "" && combined.length <= NOTE_MAX_LENGTH ? combined : title,
      };
    }
  }
  if ("title" in payload && typeof payload.title === "string") {
    return { kind: "input", text: payload.title };
  }
  return { kind: "input", text: FALLBACK_PENDING_TEXT };
}

/** The `pending` note for an interaction; never empty. */
export function describeInteraction(interaction: PendingInteraction): NoteDraft {
  const draft = describeRaw(interaction);
  const text = noteText(draft.text);
  return { kind: draft.kind, text: text === "" ? FALLBACK_PENDING_TEXT : text };
}

/** The `failed` note for a failure's text (see `failureText`); never empty. */
export function describeFailure(error: string | null): NoteDraft {
  const text = error === null ? "" : noteText(error);
  return { kind: "failed", text: text === "" ? "Failed" : text };
}

/** The `done` note for the last assistant text, or null when there is none. */
export function describeDone(lastAssistantText: string | null): NoteDraft | null {
  const text = lastAssistantText === null ? "" : noteText(lastAssistantText);
  return text === "" ? null : { kind: "done", text };
}

const NOTE_KINDS: ReadonlySet<unknown> = new Set(noteSchema.shape.kind.options);
const NOTE_SLOTS: readonly NoteSlot[] = ["pending", "failed", "done"];

/** A stored note as `noteSchema` reads it, or null where the schema refuses it. */
function parseNote(raw: unknown): Note | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { kind, text, at } = raw as Record<string, unknown>;
  if (!NOTE_KINDS.has(kind) || typeof text !== "string" || text.length > NOTE_MAX_LENGTH) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { kind: kind as Note["kind"], text, at };
}

/**
 * A stored row's notes as `threadNotesSchema` reads them, or null where the
 * schema refuses them. A cold read checks thousands of rows, and this check
 * costs a fraction of the schema's; a test holds the two equal.
 */
export function parseStoredNotes(raw: unknown): ThreadNotes | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const notes: ThreadNotes = {};
  for (const slot of NOTE_SLOTS) {
    if (record[slot] === undefined) continue;
    const note = parseNote(record[slot]);
    if (note === null) return null;
    notes[slot] = note;
  }
  return notes;
}

/** Per slot: a note to store, or null to delete it. Absent slots are kept. */
export type NoteChanges = Partial<Record<NoteSlot, Note | null>>;

export interface NoteStore {
  /** Every thread's notes. The map is the store's own: read it, do not change it. */
  all(): Promise<ReadonlyMap<string, ThreadNotes>>;
  get(threadId: string): Promise<ThreadNotes | undefined>;
  /** Applies the changes, and returns whether the thread's notes changed. */
  update(threadId: string, changes: NoteChanges): Promise<boolean>;
  /** Deletes every note of each thread, and returns the threads that had any. */
  forget(threadIds: readonly string[]): Promise<string[]>;
  /**
   * Forgets threads missing from `liveIds` whose newest note is older than
   * `before`, and returns their ids.
   */
  prune(liveIds: ReadonlySet<string>, before: number): Promise<string[]>;
}

export function createNoteStore(bb: Pick<BbPluginApi, "storage" | "log">, table: ThreadTable<unknown>): NoteStore {
  const serial = createSerialQueue();
  let cache: Map<string, ThreadNotes> | null = null;

  async function load(): Promise<Map<string, ThreadNotes>> {
    if (cache !== null) return cache;
    // Rows are checked as they are read, so KV rows move as they are.
    const moved = await table.moveFromKv(bb.storage.kv, NOTE_KEY_PREFIX, (_threadId, raw) => raw);
    if (moved > 0) bb.log.info(`moved the notes of ${moved} threads from KV into the plugin database`);
    const loaded = new Map<string, ThreadNotes>();
    for (const [threadId, raw] of table.all()) {
      const notes = parseStoredNotes(raw);
      if (notes === null || Object.keys(notes).length === 0) {
        bb.log.warn(`stored notes for ${threadId} are invalid; dropping them`);
        table.delete(threadId);
        continue;
      }
      loaded.set(threadId, notes);
    }
    cache = loaded;
    return loaded;
  }

  function save(rows: Map<string, ThreadNotes>, threadId: string, notes: ThreadNotes): void {
    if (Object.keys(notes).length === 0) {
      rows.delete(threadId);
      table.delete(threadId);
    } else {
      rows.set(threadId, notes);
      table.put(threadId, notes);
    }
  }

  return {
    all: () => serial(load),
    get: (threadId) => serial(async () => (await load()).get(threadId)),
    update: (threadId, changes) =>
      serial(async () => {
        const rows = await load();
        const current = rows.get(threadId) ?? {};
        const next: ThreadNotes = { ...current };
        for (const [slot, note] of Object.entries(changes) as [NoteSlot, Note | null][]) {
          if (note === null) delete next[slot];
          else next[slot] = note;
        }
        if (JSON.stringify(next) === JSON.stringify(current)) return false;
        save(rows, threadId, next);
        return true;
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
        for (const [threadId, notes] of [...rows]) {
          if (liveIds.has(threadId)) continue;
          const newest = Math.max(...Object.values(notes).map((note) => note.at));
          if (newest >= before) continue;
          save(rows, threadId, {});
          pruned.push(threadId);
        }
        return pruned;
      }),
  };
}
