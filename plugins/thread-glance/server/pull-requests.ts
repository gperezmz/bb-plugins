// A thread's pull request as bb's GitHub PR Status plugin reports it for the
// thread's environment. The port is what auto-settle reads; the SDK adapter is
// the only code here that names `bb.sdk`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  PULL_REQUESTS_MAX_KEYS,
  PULL_REQUESTS_METHOD,
  pullRequestRows,
  readPullRequestRow,
} from "../shared/github-pr-status";

/** What bb answered for an environment's pull request. */
export type PullRequestStatus =
  /** No pull request can be had: none for the branch, no git repository, or GitHub PR Status disabled or absent. */
  | { kind: "absent" }
  /** The lookup failed or the answer was out of shape: no evidence either way. */
  | { kind: "unknown" }
  | {
      kind: "available";
      state: "closed" | "draft" | "merged" | "open";
      /** When the pull request last changed, in epoch ms; null when its timestamp does not parse. */
      updatedAt: number | null;
    };

export interface PullRequests {
  /** The pull request of each of `environmentIds`, each of them a key of the result. */
  read(environmentIds: readonly string[]): Promise<ReadonlyMap<string, PullRequestStatus>>;
}

const UNKNOWN: PullRequestStatus = { kind: "unknown" };
const ABSENT: PullRequestStatus = { kind: "absent" };

/**
 * Reads through `bb--github-pr-status`'s `pullRequests`, up to its 200 ids a
 * call. A row out of the declared shape is logged as an error and read as
 * unknown. A call that fails reads as absent only where bb lists the plugin as
 * not installed or disabled, since bb refuses a call to either; any other
 * failure, a plugin still starting among them, reads as unknown.
 */
export function createSdkPullRequests(bb: Pick<BbPluginApi, "sdk" | "log">): PullRequests {
  /** What a failed call says of every environment it asked about. */
  async function unanswered(): Promise<PullRequestStatus> {
    try {
      const { plugins } = await bb.sdk.plugins.list();
      const plugin = plugins.find((candidate) => candidate.id === GITHUB_PR_STATUS_PLUGIN_ID);
      return plugin === undefined || !plugin.enabled ? ABSENT : UNKNOWN;
    } catch {
      return UNKNOWN;
    }
  }

  return {
    async read(environmentIds) {
      const found = new Map<string, PullRequestStatus>();
      for (let at = 0; at < environmentIds.length; at += PULL_REQUESTS_MAX_KEYS) {
        const keys = environmentIds.slice(at, at + PULL_REQUESTS_MAX_KEYS);
        let answer: unknown;
        try {
          answer = await bb.sdk.plugins.callRpc({
            pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
            method: PULL_REQUESTS_METHOD,
            input: { keys },
            // Read here rather than by bb, so a row out of shape is told from a failed call.
            outputSchema: z.unknown(),
          });
        } catch {
          const status = await unanswered();
          for (const id of keys) found.set(id, status);
          continue;
        }
        const rows = pullRequestRows(answer);
        if (rows === null) {
          bb.log.error(`GitHub PR Status answered ${PULL_REQUESTS_METHOD} in a shape Thread Glance does not expect: not a record of rows`);
          for (const id of keys) found.set(id, UNKNOWN);
          continue;
        }
        for (const id of keys) {
          const row = readPullRequestRow(rows[id]);
          switch (row.kind) {
            case "available": {
              const updatedAt = Date.parse(row.pullRequest.updatedAt);
              found.set(id, { kind: "available", state: row.pullRequest.state, updatedAt: Number.isNaN(updatedAt) ? null : updatedAt });
              break;
            }
            case "absent":
              found.set(id, ABSENT);
              break;
            case "failed":
              found.set(id, UNKNOWN);
              break;
            case "mismatch":
              bb.log.error(`GitHub PR Status answered environment ${id} in a shape Thread Glance does not expect: ${row.issues}`);
              found.set(id, UNKNOWN);
              break;
          }
        }
      }
      return found;
    },
  };
}
