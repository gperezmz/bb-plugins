// One-line notes on why a thread is blocked, failed or done: one kv row per
// thread, `note:<threadId>`, read into memory once and written through.
import type { BbPluginApi, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import {
  CHANNELS,
  NOTE_MAX_LENGTH,
  threadNotesSchema,
  type Note,
  type NotesSignal,
  type ThreadNotes,
} from "../shared/contract";
import { createSerialQueue } from "./serial";

export const NOTE_KEY_PREFIX = "note:";
/** bb's builtin plugin that lets any provider ask a multiple-choice question. */
export const ASK_USER_QUESTION_PLUGIN_ID = "ask-user-question";
const FALLBACK_PENDING_TEXT = "Needs your input";

type PendingInteraction = PluginThreadEventPayloads["interaction.pending"]["interaction"];
export type NoteSlot = keyof ThreadNotes;
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

/** Per slot: a note to store, or null to delete it. Absent slots are kept. */
export type NoteChanges = Partial<Record<NoteSlot, Note | null>>;

export interface NoteStore {
  list(): Promise<Record<string, ThreadNotes>>;
  get(threadId: string): Promise<ThreadNotes | undefined>;
  /** Applies the changes and publishes the thread's notes if they changed. */
  update(threadId: string, changes: NoteChanges): Promise<void>;
  /** Deletes every note of each thread, publishing `notes: null` for each. */
  forget(threadIds: readonly string[]): Promise<void>;
  /**
   * Forgets threads missing from `liveIds` whose newest note is older than
   * `before`, and returns their ids.
   */
  prune(liveIds: ReadonlySet<string>, before: number): Promise<string[]>;
}

export function createNoteStore(bb: Pick<BbPluginApi, "storage" | "realtime" | "log">): NoteStore {
  const { kv } = bb.storage;
  const serial = createSerialQueue();
  let cache: Map<string, ThreadNotes> | null = null;

  async function load(): Promise<Map<string, ThreadNotes>> {
    if (cache !== null) return cache;
    const loaded = new Map<string, ThreadNotes>();
    for (const key of await kv.list(NOTE_KEY_PREFIX)) {
      const threadId = key.slice(NOTE_KEY_PREFIX.length);
      const parsed = threadNotesSchema.safeParse(await kv.get<unknown>(key));
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        bb.log.warn(`stored notes for ${threadId} are invalid; dropping them`);
        await kv.delete(key);
        continue;
      }
      loaded.set(threadId, parsed.data);
    }
    cache = loaded;
    return loaded;
  }

  async function save(
    rows: Map<string, ThreadNotes>,
    threadId: string,
    notes: ThreadNotes,
  ): Promise<void> {
    const empty = Object.keys(notes).length === 0;
    if (empty) {
      rows.delete(threadId);
      await kv.delete(noteKvKey(threadId));
    } else {
      rows.set(threadId, notes);
      await kv.set(noteKvKey(threadId), notes);
    }
    const signal: NotesSignal = { threadId, notes: empty ? null : notes };
    bb.realtime.publish(CHANNELS.notes, signal);
  }

  return {
    list: () => serial(async () => Object.fromEntries(await load())),
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
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        await save(rows, threadId, next);
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
        for (const [threadId, notes] of [...rows]) {
          if (liveIds.has(threadId)) continue;
          const newest = Math.max(...Object.values(notes).map((note) => note.at));
          if (newest >= before) continue;
          await save(rows, threadId, {});
          pruned.push(threadId);
        }
        return pruned;
      }),
  };
}
