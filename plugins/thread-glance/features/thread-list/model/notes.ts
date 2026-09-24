// One-line reasons under blocked and failed rows. Pure:
// the server stores what it saw; this decides what a row says.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Note, ThreadNotes } from "@/shared/contract";
import { normalizeQueued, normalizeStatus, type NeedsKind } from "./state";

export interface RowNote {
  /** "Asks", "Approve", "Plan", "Failed"… */
  prefix: string;
  text: string;
  tone: "attention" | "destructive";
}

const PENDING_PREFIX: Record<NeedsKind, string> = {
  question: "Asks",
  approval: "Approve",
  plan: "Plan",
  input: "Needs",
};

/** The needs-you kind a pending note names, or null when there is none. */
export function needsKindOf(notes: ThreadNotes | undefined): NeedsKind | null {
  const kind = notes?.pending?.kind;
  return kind === "question" || kind === "approval" || kind === "plan" || kind === "input" ? kind : null;
}

/**
 * The line under a row: why it needs you, or why it failed. Other states
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

/** The hover card's last-reply line. */
export function lastReply(notes: ThreadNotes | undefined): Note | null {
  return notes?.done ?? null;
}
