// One-line reasons under blocked and failed rows. Pure:
// the server stores what it saw; this decides what a row says.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Note, ThreadNotes } from "@/shared/contract";
import { normalizeQueued, normalizeStatus, type Flag, type NeedsKind } from "./state";

export interface RowNote {
  /** "Asks", "Approve", "Plan", "Failed", "Offline", "Finished"… */
  prefix: string;
  /** Empty when there is nothing to add: the prefix stands alone. */
  text: string;
  /** The tone of the row's glyph for the same reason. */
  tone: "attention" | "destructive" | "muted";
}

const PENDING_PREFIX: Record<NeedsKind, string> = {
  question: "Asks",
  approval: "Approve",
  plan: "Plan",
  input: "Needs",
};

/** What a pending note says the thread waits on you for, or null when there is none. */
export function needsKindOf(notes: ThreadNotes | undefined): NeedsKind | null {
  const kind = notes?.pending?.kind;
  return kind === "question" || kind === "approval" || kind === "plan" || kind === "input" ? kind : null;
}

/**
 * The line under a row: why it needs attention, or why it failed. Other states
 * have none, so the list stays one line per thread where nothing is wrong.
 */
export function rowNote(thread: PluginSidebarThread, notes: ThreadNotes | undefined): RowNote | null {
  if (thread.hasPendingInteraction) {
    const kind = needsKindOf(notes);
    const text = notes?.pending?.text.trim();
    if (kind === null || !text) return null;
    return { prefix: PENDING_PREFIX[kind], text, tone: "attention" };
  }
  if (normalizeStatus(thread) === "error") {
    const text = notes?.failed?.text.trim();
    // "Failed: Failed" says nothing the red glyph doesn't.
    return text && text.toLowerCase() !== "failed" ? { prefix: "Failed", text, tone: "destructive" } : null;
  }
  if (normalizeQueued(thread) === "failed") {
    return { prefix: "Failed", text: "queued message wasn't sent", tone: "destructive" };
  }
  return null;
}

/**
 * The line under a row in Needs attention that itself needs attention: its
 * most urgent reason among `attention`, its Needs attention flags. Waits on
 * you, then failed, then offline, then finished; each keeps its prefix when
 * there is no text to follow it.
 */
export function attentionNote(
  thread: PluginSidebarThread,
  notes: ThreadNotes | undefined,
  attention: ReadonlySet<Flag>,
): RowNote | null {
  if (attention.has("waits-on-you")) {
    return { prefix: PENDING_PREFIX[needsKindOf(notes) ?? "input"], text: notes?.pending?.text.trim() ?? "", tone: "attention" };
  }
  if (attention.has("unread-failed")) {
    const text = notes?.failed?.text.trim() ?? "";
    return { prefix: "Failed", text: text.toLowerCase() === "failed" ? "" : text, tone: "destructive" };
  }
  if (attention.has("queue-failed")) {
    return { prefix: "Failed", text: "queued message wasn't sent", tone: "destructive" };
  }
  if (attention.has("offline")) return { prefix: "Offline", text: thread.host?.name.trim() ?? "", tone: "attention" };
  if (attention.has("unread")) return { prefix: "Finished", text: lastReply(notes)?.text.trim() ?? "", tone: "muted" };
  return null;
}

/** A note as one line of text: "Failed: timeout", or "Failed" alone. */
export function noteText(note: RowNote): string {
  return note.text === "" ? note.prefix : `${note.prefix}: ${note.text}`;
}

/** The hover card's last-reply line. */
export function lastReply(notes: ThreadNotes | undefined): Note | null {
  return notes?.done ?? null;
}
