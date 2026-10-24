import { describe, expect, it } from "vitest";
import type { GitHubPullRequest } from "@/shared/github-pr-status";
import { pullRequestFacts, pullRequestLabel, pullRequestTone, pullRequestTooltip } from "./pull-request";

type Attention = GitHubPullRequest["attention"];

const pr = (patch: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  checks: { state: "failing" },
  review: { state: "review_requested" },
  mergeability: { state: "mergeable" },
  number: 7,
  title: "Add shelves",
  url: "https://example.test/pr/7",
  updatedAt: "2026-10-24T12:00:00Z",
  state: "open",
  attention: "checks_failed",
  ...patch,
});

describe("the label and tone", () => {
  it("words bb's attention and Open when there is none", () => {
    const labels: Record<Attention, string> = {
      blocked: "Blocked",
      changes_requested: "Changes requested",
      checks_failed: "Checks failed",
      checks_pending: "Checks pending",
      closed: "Closed",
      conflicts: "Conflicts",
      draft: "Draft",
      merged: "Merged",
      none: "Open",
      queued: "In merge queue",
      ready_to_merge: "Ready to merge",
      review_requested: "Review requested",
    };
    for (const [attention, label] of Object.entries(labels)) expect(pullRequestLabel({ attention: attention as Attention })).toBe(label);
  });

  it("colours merged violet, the alerts red, open emerald and the rest muted", () => {
    const tone = (attention: Attention) => pullRequestTone({ attention });
    expect(tone("merged")).toBe("merged");
    for (const alert of ["blocked", "changes_requested", "checks_failed", "conflicts", "closed"] as const) expect(tone(alert)).toBe("alert");
    expect(tone("none")).toBe("open");
    for (const muted of ["draft", "checks_pending", "queued", "ready_to_merge", "review_requested"] as const) expect(tone(muted)).toBe("muted");
  });

  it("gives the title then the label as the tooltip", () => {
    expect(pullRequestTooltip(pr())).toBe("Add shelves\nChecks failed");
  });
});

describe("the facts line", () => {
  it("joins checks, review and mergeability of an open pull request", () => {
    expect(pullRequestFacts(pr())).toBe("Checks failing · Review requested · Mergeable");
  });

  it("is empty once merged or closed", () => {
    expect(pullRequestFacts(pr({ state: "merged", attention: "merged" }))).toBe("");
    expect(pullRequestFacts(pr({ state: "closed", attention: "closed" }))).toBe("");
  });
});
