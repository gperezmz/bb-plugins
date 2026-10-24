// Answers of bb 0.47.1's bundled GitHub PR Status plugin, captured with
// `bb plugin rpc call bb--github-pr-status pullRequests`. Every field and type
// is as captured; the merged pull request's title, address and branch came
// from a private repository and stand here as this repository's own #325.
export const CAPTURED_PULL_REQUESTS = {
  env_merged: {
    outcome: "available",
    pullRequest: {
      number: 325,
      title: "feat(thread-usage)!: price every request from models.dev with tiers",
      state: "merged",
      url: "https://github.com/gperezmz/bb-plugins/pull/325",
      baseRefName: "main",
      headRefName: "feat/price-every-request-from-models-dev-tiers",
      updatedAt: "2026-10-22T19:27:07Z",
      autoMerge: false,
      inMergeQueue: false,
      checks: { state: "passing", totalCount: 23, passedCount: 23, failedCount: 0, pendingCount: 0 },
      review: { state: "none", reviewRequestCount: 0 },
      mergeability: { state: "unknown", mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" },
      attention: "merged",
    },
  },
  env_none: { outcome: "absent" },
  env_offline: {
    outcome: "unavailable",
    message: "gh api graphql failed: error connecting to github.com-personal\ncheck your internet connection or https://githubstatus.com",
  },
  env_gone: { outcome: "unavailable", message: "Workspace path no longer exists: /tmp/tmp.qpn5eBNR89" },
} as const;
