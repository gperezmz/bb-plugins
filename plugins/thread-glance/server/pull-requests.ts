// A thread's pull request as bb's GitHub PR Status plugin reports it for the
// thread's environment. The port is what auto-settle reads; the SDK adapter is
// the only code here that names `bb.sdk`, and what an answer means is decided
// in ./pull-request-status.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
// Full zod, unlike the rest of the plugin: `callRpc` types its output schema as a full zod type.
import { z } from "zod";
import { GITHUB_PR_STATUS_PLUGIN_ID, PULL_REQUESTS_MAX_KEYS, PULL_REQUESTS_METHOD, pullRequestRows } from "../shared/github-pr-status";
import { statusOfRefusedCall, statusOfRow, UNKNOWN, type PullRequestStatus } from "./pull-request-status";

export type { PullRequestStatus } from "./pull-request-status";

export interface PullRequests {
  /** The pull request of each of `environmentIds`, each of them a key of the result. */
  read(environmentIds: readonly string[]): Promise<ReadonlyMap<string, PullRequestStatus>>;
}

/**
 * Reads through `bb--github-pr-status`'s `pullRequests`, up to its 200 ids a
 * call. A row out of the declared shape is logged as an error and read as
 * unknown; a call bb refuses is read from how bb lists the plugin.
 */
export function createSdkPullRequests(bb: Pick<BbPluginApi, "sdk" | "log">): PullRequests {
  async function refused(): Promise<PullRequestStatus> {
    let plugin: { enabled: boolean } | undefined | null;
    try {
      const { plugins } = await bb.sdk.plugins.list();
      plugin = plugins.find((candidate) => candidate.id === GITHUB_PR_STATUS_PLUGIN_ID);
    } catch {
      plugin = null;
    }
    return statusOfRefusedCall(plugin);
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
            // Read here rather than by bb, so a row out of shape is told from a refused call.
            outputSchema: z.unknown(),
          });
        } catch {
          const status = await refused();
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
          const { status, mismatch } = statusOfRow(rows[id]);
          if (mismatch !== null) bb.log.error(`GitHub PR Status answered environment ${id} in a shape Thread Glance does not expect: ${mismatch}`);
          found.set(id, status);
        }
      }
      return found;
    },
  };
}
