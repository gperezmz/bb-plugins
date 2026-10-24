// What Thread Glance reads from bb's bundled GitHub PR Status plugin: its
// `pullRequests` RPC, one row per environment id. The plugin ships no contract
// to import, so the shape of a row is declared here, from the plugin bb 0.47.1
// bundles; that declaration is the line most likely to break on a later bb.
// Each reader declares only the fields it reads: auto-settle a pull request's
// state and time (`readSettleRow`), the badge and the hover card what they
// show (`readPullRequestRow`), so a value added to a field auto-settle never
// reads leaves it working.
import * as z from "zod/mini";

export const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";
export const PULL_REQUESTS_METHOD = "pullRequests";
/** The most environment ids one `pullRequests` call takes. */
export const PULL_REQUESTS_MAX_KEYS = 200;

/**
 * How GitHub PR Status 0.1.0 opens an `unavailable` row's message when the
 * environment's workspace is gone, a lookup no later pass can answer either.
 * A reworded message reads as a failed lookup.
 */
export const WORKSPACE_GONE_MESSAGE = "Workspace path no longer exists: ";

const settlePullRequestSchema = z.object({
  state: z.enum(["draft", "open", "merged", "closed"]),
  updatedAt: z.string(),
});

const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(["draft", "open", "merged", "closed"]),
  // The badge and the hover card link to it, so only a web address passes.
  url: z.string().check(z.regex(/^https?:\/\//u)),
  updatedAt: z.string(),
  attention: z.enum([
    "checks_failed",
    "checks_pending",
    "changes_requested",
    "review_requested",
    "conflicts",
    "blocked",
    "draft",
    "queued",
    "ready_to_merge",
    "merged",
    "closed",
    "none",
  ]),
  checks: z.object({ state: z.enum(["passing", "failing", "pending", "no_checks", "unknown"]) }),
  review: z.object({ state: z.enum(["approved", "changes_requested", "review_required", "review_requested", "none"]) }),
  mergeability: z.object({ state: z.enum(["mergeable", "conflicts", "blocked", "draft", "unknown"]) }),
});

/** A pull request as GitHub PR Status reports it, with the fields the badge and the hover card read. */
export type GitHubPullRequest = z.infer<typeof pullRequestSchema>;

/** One environment's row, read. */
export type PullRequestRow<PullRequest> =
  | { kind: "available"; pullRequest: PullRequest }
  /** No pull request can be had: none for the branch, or no git repository. */
  | { kind: "absent" }
  /** The environment's workspace is gone, so no lookup will find its pull request again. */
  | { kind: "gone" }
  /**
   * The plugin could not say, whatever the cause (offline, `gh` not logged in,
   * a stopped machine, a remote not on GitHub): no evidence either way.
   */
  | { kind: "failed" }
  /** The row is not in the declared shape; `issues` names where it differs. */
  | { kind: "mismatch"; issues: string };

function rowReader<PullRequest>(pullRequest: z.ZodMiniType<PullRequest>) {
  const rowSchema = z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("available"), pullRequest }),
    z.object({ outcome: z.literal("absent") }),
    z.object({ outcome: z.literal("unavailable"), message: z.string() }),
  ]);
  /** Reads one row of a `pullRequests` answer; `undefined` is a row the answer left out. */
  return (row: unknown): PullRequestRow<PullRequest> => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.length === 0 ? "row" : issue.path.join(".")}: ${issue.message}`);
      return { kind: "mismatch", issues: issues.join("; ") };
    }
    const value = parsed.data;
    switch (value.outcome) {
      case "available":
        return { kind: "available", pullRequest: value.pullRequest as PullRequest };
      case "absent":
        return { kind: "absent" };
      case "unavailable":
        return value.message.startsWith(WORKSPACE_GONE_MESSAGE) ? { kind: "gone" } : { kind: "failed" };
    }
  };
}

/** A row as the badge and the hover card read it. */
export const readPullRequestRow = rowReader(pullRequestSchema);

/** A row as auto-settle reads it. */
export const readSettleRow = rowReader(settlePullRequestSchema);

const rowsSchema = z.record(z.string(), z.unknown());

/** The answer as a record of rows, or null when it is not one. */
export function pullRequestRows(answer: unknown): Readonly<Record<string, unknown>> | null {
  const parsed = rowsSchema.safeParse(answer);
  return parsed.success ? parsed.data : null;
}

/**
 * The method as `experimental_useRpcKeyedQuery` takes it. Rows are left
 * unread here, so one row out of shape costs only that row, read by
 * `readPullRequestRow`.
 */
export const githubPrStatusContract = {
  [PULL_REQUESTS_METHOD]: {
    input: z.object({ keys: z.array(z.string()) }),
    output: rowsSchema,
  },
} as const;
