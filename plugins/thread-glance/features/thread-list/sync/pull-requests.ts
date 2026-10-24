// An environment's pull request, read from bb's GitHub PR Status plugin
// through bb's keyed query, which batches the rows drawn in one render into
// one call and refreshes a row while it is watched.
import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  PULL_REQUESTS_METHOD,
  githubPrStatusContract,
  readPullRequestRow,
  type GitHubPullRequest,
} from "@/shared/github-pr-status";

const NO_KEYS: readonly string[] = [];

/**
 * The environment's pull request, or null while there is none to show: no
 * environment, no pull request, a failed lookup, a row out of shape, or GitHub
 * PR Status disabled or absent, so a badge is absent rather than wrong.
 */
export function usePullRequest(environmentId: string | null | undefined): GitHubPullRequest | null {
  const { data } = useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusContract,
    method: PULL_REQUESTS_METHOD,
    keys: environmentId == null ? NO_KEYS : [environmentId],
    enabled: environmentId != null,
  });
  const row = environmentId == null ? undefined : data?.[environmentId];
  return useMemo(() => {
    if (row === undefined) return null;
    const read = readPullRequestRow(row);
    return read.kind === "available" ? read.pullRequest : null;
  }, [row]);
}
