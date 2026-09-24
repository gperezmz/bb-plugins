// Approvals: the engineer's consent to run something the manifest names.
//
// An approval is keyed on a hash of `{ id, text, ref }`, so a changed command,
// source or ref needs approval again while an unchanged one survives a
// force-push or a reordered manifest.
import { createHash } from "node:crypto";
import type { TeamCommand } from "./model.js";

export function approvalHash(input: {
  id: string;
  text: string;
  ref: string | null;
}): string {
  // Key order is fixed so the hash is stable across runtimes.
  const canonical = JSON.stringify([input.id, input.text, input.ref]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * `scope` is where the command runs (the item's machine rule). It is part of
 * the hash, so widening an approved check from one machine to all of them
 * needs approval again.
 */
export function teamCommand(
  role: TeamCommand["role"],
  id: string,
  text: string,
  ref: string | null = null,
  scope: unknown = null,
): TeamCommand {
  const where = scope === null ? "" : `@${JSON.stringify(scope)}`;
  return { role, id, text, ref, hash: approvalHash({ id: `${id}#${role}${where}`, text, ref }) };
}

export interface ApprovalRecord {
  hash: string;
  itemId: string;
  role: TeamCommand["role"];
  /** Always empty: the text stays in the cached manifest (it may hold a URL). */
  text: string;
  approvedAt: string;
}

/** Splits an item's commands into approved and pending. */
export function approvalState(
  commands: readonly TeamCommand[],
  approved: ReadonlySet<string>,
): { approved: TeamCommand[]; pending: TeamCommand[] } {
  const result = { approved: [] as TeamCommand[], pending: [] as TeamCommand[] };
  for (const command of commands) {
    (approved.has(command.hash) ? result.approved : result.pending).push(command);
  }
  return result;
}

/** Drops approvals whose command is gone from the manifest. */
export function pruneApprovals(
  records: readonly ApprovalRecord[],
  live: readonly TeamCommand[],
): ApprovalRecord[] {
  const liveHashes = new Set(live.map((command) => command.hash));
  return records.filter((record) => liveHashes.has(record.hash));
}
