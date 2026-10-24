// What Thread Glance reads from bb's bundled GitHub PR Status plugin: its
// `pullRequests` RPC, one row per environment id. The plugin ships no contract
// to import, so the shape of a row is declared here, from the plugin bb 0.47.1
// bundles; that declaration is the line most likely to break on a later bb.
// The server's auto-settle and the app's badge and hover card read a row the
// same way, through `readPullRequestRow`.
import * as z from "zod/mini";

export const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";
export const PULL_REQUESTS_METHOD = "pullRequests";
/** The most environment ids one `pullRequests` call takes. */
export const PULL_REQUESTS_MAX_KEYS = 200;

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

const rowSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), pullRequest: pullRequestSchema }),
  z.object({ outcome: z.literal("absent") }),
  z.object({ outcome: z.literal("unavailable"), message: z.string() }),
]);

/** A pull request as GitHub PR Status reports it, with the fields Thread Glance reads. */
export type GitHubPullRequest = z.infer<typeof pullRequestSchema>;

/** One environment's row, read. */
export type PullRequestRow =
  | { kind: "available"; pullRequest: GitHubPullRequest }
  /** No pull request can be had: none for the branch, or no git repository. */
  | { kind: "absent" }
  /**
   * The plugin could not say, whatever the cause (offline, `gh` not logged in,
   * a stopped machine, a remote not on GitHub): no evidence either way.
   */
  | { kind: "failed"; message: string }
  /** The row is not in the declared shape; `issues` names where it differs. */
  | { kind: "mismatch"; issues: string };

/** Reads one row of a `pullRequests` answer; `undefined` is a row the answer left out. */
export function readPullRequestRow(row: unknown): PullRequestRow {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.length === 0 ? "row" : issue.path.join(".")}: ${issue.message}`);
    return { kind: "mismatch", issues: issues.join("; ") };
  }
  const value = parsed.data;
  switch (value.outcome) {
    case "available":
      return { kind: "available", pullRequest: value.pullRequest };
    case "absent":
      return { kind: "absent" };
    case "unavailable":
      return { kind: "failed", message: value.message };
  }
}

/** The answer as a record of rows, or null when it is not one. */
export function pullRequestRows(answer: unknown): Readonly<Record<string, unknown>> | null {
  return typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>) : null;
}

/**
 * The method as `experimental_useRpcKeyedQuery` takes it. Rows are left
 * unread here, so one row out of shape costs only that row, read by
 * `readPullRequestRow`.
 */
export const githubPrStatusContract = {
  [PULL_REQUESTS_METHOD]: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.unknown()),
  },
} as const;
