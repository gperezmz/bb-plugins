// What the details dialog and hover card say of a pull request.
import { describe, expect, it } from "vitest";
import type { PluginSidebarPullRequest } from "@get-bb/plugin-sdk/app";
import { pullRequestFacts, pullRequestLabel } from "./PullRequestBadge";

function pullRequest(patch: Partial<PluginSidebarPullRequest> = {}): PluginSidebarPullRequest {
  return {
    number: 12,
    title: "Fix login",
    url: "https://example.test/12",
    state: "open",
    attention: "none",
    experimental_autoMerge: false,
    experimental_inMergeQueue: false,
    experimental_checks: { state: "passing" },
    experimental_review: { state: "approved" },
    experimental_mergeability: { state: "mergeable" },
    ...patch,
  };
}

describe("a pull request's facts", () => {
  it("names an open pull request's checks, review, mergeability, auto-merge and merge queue", () => {
    expect(pullRequestFacts(pullRequest({ experimental_autoMerge: true, experimental_inMergeQueue: true }))).toEqual([
      "Checks passing",
      "Approved",
      "Mergeable",
      "Auto-merge on",
      "In merge queue",
    ]);
  });

  it("leaves out what bb does not know and what the label already says", () => {
    const failing = pullRequest({
      attention: "checks_failed",
      experimental_checks: { state: "failing" },
      experimental_review: { state: "none" },
      experimental_mergeability: { state: "unknown" },
    });
    expect(pullRequestLabel(failing)).toBe("Pull request #12, checks failed: Fix login");
    expect(pullRequestFacts(failing)).toEqual([]);
    const queued = pullRequest({ attention: "queued", experimental_inMergeQueue: true });
    expect(pullRequestLabel(queued)).toBe("Pull request #12, in merge queue: Fix login");
    expect(pullRequestFacts(queued)).toEqual(["Checks passing", "Approved", "Mergeable"]);
  });

  it("names none once the pull request is merged or closed", () => {
    expect(pullRequestFacts(pullRequest({ state: "merged", attention: "merged" }))).toEqual([]);
    expect(pullRequestFacts(pullRequest({ state: "closed", attention: "closed" }))).toEqual([]);
  });
});
