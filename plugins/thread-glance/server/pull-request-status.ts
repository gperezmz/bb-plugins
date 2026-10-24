// What GitHub PR Status's answer says of an environment's pull request, as
// auto-settle weighs it. Pure: the SDK adapter (./pull-requests) asks, this
// decides.
import { readSettleRow } from "../shared/github-pr-status";

/** What bb answered for an environment's pull request. */
export type PullRequestStatus =
  /** The branch has no pull request, or the environment is no git repository. */
  | { kind: "absent" }
  /**
   * Nothing is left to ask: the environment's workspace is gone, or GitHub PR
   * Status is disabled or not installed. The quiet rule may settle the thread,
   * but this returns no thread auto-settle settled, since what settled it, a
   * merge among them, is no less true for no longer being asked.
   */
  | { kind: "no-lookup" }
  /** The lookup failed or the answer was out of shape: no evidence either way. */
  | { kind: "unknown" }
  | {
      kind: "available";
      state: "closed" | "draft" | "merged" | "open";
      /** When the pull request last changed, in epoch ms; null when its timestamp does not parse. */
      updatedAt: number | null;
    };

export const UNKNOWN: PullRequestStatus = { kind: "unknown" };
const ABSENT: PullRequestStatus = { kind: "absent" };
const NO_LOOKUP: PullRequestStatus = { kind: "no-lookup" };

/** One row of an answer as a status, with the mismatch to log where the row is out of shape. */
export function statusOfRow(row: unknown): { status: PullRequestStatus; mismatch: string | null } {
  const read = readSettleRow(row);
  switch (read.kind) {
    case "available": {
      const updatedAt = Date.parse(read.pullRequest.updatedAt);
      return { status: { kind: "available", state: read.pullRequest.state, updatedAt: Number.isNaN(updatedAt) ? null : updatedAt }, mismatch: null };
    }
    case "absent":
      return { status: ABSENT, mismatch: null };
    case "gone":
      return { status: NO_LOOKUP, mismatch: null };
    case "failed":
      return { status: UNKNOWN, mismatch: null };
    case "mismatch":
      return { status: UNKNOWN, mismatch: read.issues };
  }
}

/**
 * What a call bb refused says of every environment it asked about, from how bb
 * lists GitHub PR Status (`undefined` where it lists no such plugin, `null`
 * where the list could not be read). bb refuses a call to a plugin it does not
 * have or that is disabled, which leaves nothing to ask; any other refusal, a
 * plugin still starting among them, is a failed lookup.
 */
export function statusOfRefusedCall(plugin: { enabled: boolean } | undefined | null): PullRequestStatus {
  if (plugin === null) return UNKNOWN;
  return plugin === undefined || !plugin.enabled ? NO_LOOKUP : UNKNOWN;
}
