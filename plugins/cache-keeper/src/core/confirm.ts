/**
 * The check made immediately before every automatic send, on the thread as
 * bb gives it afresh: still idle, not archived or deleted, a Claude Code
 * thread, with no pending interaction, and still switched on for what is
 * being sent. The first condition that fails is the reason nothing is sent.
 */
import type { HoldReason } from "./reasons";

/** A thread as bb gave it immediately before a send; null for one bb no longer has. */
export interface FreshThread {
  status: string;
  archived: boolean;
  deleted: boolean;
  providerId: string;
  /** Null when bb's reply lacked it: it counts as a pending interaction. */
  pending: boolean | null;
  /** Fields bb's reply lacked. */
  missing: readonly string[];
}

export function confirmSend(fresh: FreshThread | null, switchedOn: HoldReason | null): HoldReason | null {
  if (fresh === null || fresh.deleted) return "deleted";
  if (fresh.missing.length > 0) return "missing-field";
  if (fresh.archived) return "archived";
  if (fresh.providerId !== "claude-code") return "not-claude-code";
  if (fresh.status !== "idle") return "busy";
  if (fresh.pending === null) return "missing-field";
  if (fresh.pending) return "pending-interaction";
  return switchedOn;
}
