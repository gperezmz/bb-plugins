// A thread's pull request as bb reports it for the thread's environment. The
// port is what auto-settle reads; the SDK adapter is the only code here that
// names `bb.sdk`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** What bb answered for an environment's pull request. */
export type PullRequestStatus =
  /** The environment's branch has no pull request. */
  | { kind: "absent" }
  /** bb could not say: a failed or unavailable lookup is no evidence either way. */
  | { kind: "unknown" }
  | {
      kind: "available";
      state: "closed" | "draft" | "merged" | "open";
      /** When the pull request last changed, in epoch ms; null when bb's timestamp does not parse. */
      updatedAt: number | null;
    };

export interface PullRequests {
  read(environmentId: string): Promise<PullRequestStatus>;
}

export function createSdkPullRequests(bb: Pick<BbPluginApi, "sdk">): PullRequests {
  return {
    async read(environmentId) {
      try {
        const result = await bb.sdk.environments.pullRequest({ environmentId });
        if (result.outcome === "absent") return { kind: "absent" };
        if (result.outcome === "unavailable") return { kind: "unknown" };
        const updatedAt = Date.parse(result.pullRequest.updatedAt);
        return {
          kind: "available",
          state: result.pullRequest.state,
          updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
        };
      } catch {
        return { kind: "unknown" };
      }
    },
  };
}
