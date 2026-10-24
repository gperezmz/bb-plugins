// What GitHub PR Status's answer says of an environment's pull request, as
// auto-settle weighs it. Pure: the SDK adapter (./pull-requests) asks, this
// decides.
import { readSettleRow } from "../shared/github-pr-status";

/** What bb answered for an environment's pull request. */
export type PullRequestStatus =
  /** No pull request can be had: none for the branch, no git repository, or GitHub PR Status disabled or absent. */
  | { kind: "absent" }
  /**
   * The environment's workspace is gone: no pull request will be found for it,
   * so the quiet rule may settle its thread, but nothing it says returns a
   * thread auto-settle settled, since the workspace going is no attention.
   */
  | { kind: "gone" }
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
      return { status: { kind: "gone" }, mismatch: null };
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
 * have or that is disabled, which is no pull request; any other refusal, a
 * plugin still starting among them, is a failed lookup.
 */
export function statusOfRefusedCall(plugin: { enabled: boolean } | undefined | null): PullRequestStatus {
  if (plugin === null) return UNKNOWN;
  return plugin === undefined || !plugin.enabled ? ABSENT : UNKNOWN;
}
