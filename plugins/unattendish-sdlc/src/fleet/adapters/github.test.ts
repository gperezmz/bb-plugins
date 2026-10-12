import { afterEach, describe, expect, it } from "vitest";
import type { ReadOutcome, WatchedItem } from "../domain/model";
import type { ReadRequest, ResolvedCredential } from "../application/ports";
import { createFakeGithub, type FakeCheckRun, type FakeComment, type FakeEvent, type FakeGithubState, type FakeIssue, type FakeRepo, type FakeReview, type FakeReviewComment } from "../../../test/fakes/github";
import { listen, type Mounted } from "../../../test/fakes/listen";
import { createGithubAdapter } from "./github";
import { HttpClient } from "./http";

const SINCE = "2026-10-10T00:00:00Z";
const BEFORE = "2026-10-09T10:00:00Z";
const AFTER = "2026-10-10T10:00:00Z";
const LATER = "2026-10-10T11:00:00Z";
const LABELS = { spec: "spec", ready: "Status:Ready", inProgress: "in progress", needsInput: "needs input" };
const REPO = "org/repo";

const mounted: Mounted[] = [];
afterEach(async () => {
  await Promise.all(mounted.splice(0).map((one) => one.close()));
});

const issue = (number: number, extra: Partial<FakeIssue> = {}): FakeIssue => ({
  number,
  state: "open",
  labels: [],
  assignees: [],
  creator: "someone",
  createdAt: BEFORE,
  updatedAt: AFTER,
  ...extra,
});
const pull = (number: number, extra: Partial<FakeIssue> = {}, merged = false): FakeIssue =>
  issue(number, { pull: { merged, headSha: `sha${number}` }, ...extra });
const repo = (extra: Partial<FakeRepo> = {}): Partial<FakeGithubState> => ({ repos: { [REPO]: { issues: [], comments: [], reviewComments: [], reviews: [], events: [], checkRuns: [], statuses: [], ...extra } } });

const comment = (id: number, issueNumber: number, extra: Partial<FakeComment> = {}): FakeComment => ({
  id,
  issue: issueNumber,
  user: "olivia",
  body: "text",
  createdAt: AFTER,
  updatedAt: AFTER,
  ...extra,
});
const reviewComment = (id: number, pullNumber: number, extra: Partial<FakeReviewComment> = {}): FakeReviewComment => ({
  id,
  pull: pullNumber,
  reviewId: null,
  user: "olivia",
  body: "inline",
  createdAt: AFTER,
  updatedAt: AFTER,
  ...extra,
});
const review = (id: number, pullNumber: number, state: string, extra: Partial<FakeReview> = {}): FakeReview => ({
  id,
  pull: pullNumber,
  user: "olivia",
  body: "review body",
  state,
  submittedAt: AFTER,
  ...extra,
});
const event = (id: number, issueNumber: number, kind: string, extra: Partial<FakeEvent> = {}): FakeEvent => ({
  id,
  issue: issueNumber,
  event: kind,
  actor: "olivia",
  createdAt: AFTER,
  ...extra,
});
const run = (id: number, sha: string, status: string, conclusion: string | null): FakeCheckRun => ({ id, sha, name: `check ${id}`, status, conclusion });

const item = (number: number): WatchedItem => ({ role: "forge", ref: `#${number}`, url: null });

/** Mounts the fake with `state` and returns a way to read it as the adapter would. */
const harness = async (state: Partial<FakeGithubState>, prefix = "/api/v3") => {
  const fake = createFakeGithub(state);
  const server = await listen(fake);
  mounted.push(server);
  const credential: ResolvedCredential = { prefix: "github.com/org", service: "github", auth: "token", baseUrl: `${server.url}${prefix}`, host: "127.0.0.1" };
  const http = new HttpClient({ sleep: async () => undefined }).session(credential, "ghp_secret");
  const adapter = createGithubAdapter();
  const read = (extra: Partial<Omit<ReadRequest, "items">> & { watched?: number[]; items?: number[] } = {}): Promise<ReadOutcome> => {
    const { watched, items, ...rest } = extra;
    const numbers = items ?? watched ?? [];
    return adapter.read({
      source: { role: "forge", service: "github", host: "127.0.0.1", path: REPO },
      http,
      items: numbers.map(item),
      watchedRefs: new Set((watched ?? numbers).map((number) => `#${number}`)),
      labels: LABELS,
      operator: "olivia",
      since: SINCE,
      scanPartition: false,
      stateOnly: false,
      signal: new AbortController().signal,
      ...rest,
    });
  };
  return { fake, server, http, read, adapter };
};

describe("GitHub adapter: a snapshot", () => {
  it("reads an open issue with its url, labels as registered and partition by assignee", async () => {
    const { read } = await harness(repo({ issues: [issue(1, { labels: ["SPEC", "bug", "Status:ready"], assignees: ["Olivia"], title: "A secret title" })] }));
    const { snapshots, failures } = await read({ items: [1] });
    expect(failures).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      role: "forge",
      ref: "#1",
      url: "https://github.example/org/repo/issues/1",
      open: true,
      merged: false,
      fleetLabels: ["spec", "Status:Ready"],
      checks: null,
      inPartition: true,
      transitions: [],
    });
  });

  it("puts an issue in the partition when the operator filed it and it is assigned to nobody, and not otherwise", async () => {
    const { read } = await harness(
      repo({
        issues: [
          issue(1, { creator: "olivia" }),
          issue(2, { creator: "olivia", assignees: ["bob"] }),
          issue(3, { creator: "bob" }),
          issue(4, { creator: "bob", assignees: ["olivia", "bob"] }),
          issue(5, { creator: null }),
        ],
      }),
    );
    const { snapshots } = await read({ items: [1, 2, 3, 4, 5] });
    expect(snapshots.map((snapshot) => [snapshot.ref, snapshot.inPartition])).toEqual([
      ["#1", true],
      ["#2", false],
      ["#3", false],
      ["#4", true],
      ["#5", false],
    ]);
  });

  it("reads a closed issue as not open", async () => {
    const { read } = await harness(repo({ issues: [issue(1, { state: "closed" })] }));
    expect((await read({ items: [1] })).snapshots[0]).toMatchObject({ open: false, merged: false, checks: null });
  });

  it("reads a pull request as what it is: open, closed unmerged, or merged", async () => {
    const { read } = await harness(repo({ issues: [pull(1), pull(2, { state: "closed" }), pull(3, { state: "closed" }, true)] }));
    const { snapshots } = await read({ items: [1, 2, 3] });
    expect(snapshots.map((snapshot) => [snapshot.ref, snapshot.open, snapshot.merged, snapshot.url])).toEqual([
      ["#1", true, false, "https://github.example/org/repo/pull/1"],
      ["#2", false, false, "https://github.example/org/repo/pull/2"],
      ["#3", false, true, "https://github.example/org/repo/pull/3"],
    ]);
  });

  it("finds out whether a reference is an issue or a pull request and reads the pull request's head", async () => {
    const { read, server } = await harness(repo({ issues: [issue(1), pull(2)], checkRuns: [run(1, "sha2", "completed", "success")] }));
    const { snapshots } = await read({ items: [1, 2] });
    expect(snapshots[0]!.checks).toBeNull();
    expect(snapshots[1]!.checks).toEqual({ sha: "sha2", outcome: "passed" });
    const paths = server.requests.map((request) => request.url.split("?")[0]);
    expect(paths).toContain("/api/v3/repos/org/repo/pulls/2");
    expect(paths).not.toContain("/api/v3/repos/org/repo/pulls/1");
  });

  it("works under the REST root of a server with a path prefix, and under none", async () => {
    for (const prefix of ["", "/api/v3", "/deep/api/v3"]) {
      const { read } = await harness(repo({ issues: [issue(1)] }), prefix);
      expect((await read({ items: [1] })).snapshots).toHaveLength(1);
    }
  });
});

describe("GitHub adapter: checks", () => {
  const outcomeOf = async (extra: Partial<FakeRepo>) => {
    const { read } = await harness(repo({ issues: [pull(1)], ...extra }));
    const outcome = await read({ items: [1] });
    return { checks: outcome.snapshots[0]?.checks ?? null, failures: outcome.failures };
  };

  it("is pending while any check run is not completed", async () => {
    for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
      expect((await outcomeOf({ checkRuns: [run(1, "sha1", "completed", "success"), run(2, "sha1", status, null)] })).checks).toEqual({ sha: "sha1", outcome: "pending" });
    }
  });

  it("is passed when every run finished passing, skipped or neutral", async () => {
    const checkRuns = [run(1, "sha1", "completed", "success"), run(2, "sha1", "completed", "skipped"), run(3, "sha1", "completed", "neutral")];
    expect((await outcomeOf({ checkRuns })).checks).toEqual({ sha: "sha1", outcome: "passed" });
  });

  it("is failed when one finished run failed and none is pending", async () => {
    for (const conclusion of ["failure", "timed_out", "cancelled", "action_required"]) {
      expect((await outcomeOf({ checkRuns: [run(1, "sha1", "completed", "success"), run(2, "sha1", "completed", conclusion)] })).checks).toEqual({ sha: "sha1", outcome: "failed" });
    }
  });

  it("stays pending when a failure sits beside a run still going, since the set is not final", async () => {
    const checkRuns = [run(1, "sha1", "completed", "failure"), run(2, "sha1", "in_progress", null)];
    expect((await outcomeOf({ checkRuns })).checks).toEqual({ sha: "sha1", outcome: "pending" });
  });

  it("is null when the head has no check runs and no commit statuses", async () => {
    expect((await outcomeOf({ checkRuns: [run(1, "other", "completed", "failure")] })).checks).toBeNull();
  });

  it("counts legacy commit statuses: pending, success, failure and error", async () => {
    const status = (state: string, context = state) => ({ sha: "sha1", context, state });
    expect((await outcomeOf({ statuses: [status("success")] })).checks).toEqual({ sha: "sha1", outcome: "passed" });
    expect((await outcomeOf({ statuses: [status("success", "a"), status("pending", "b")] })).checks).toEqual({ sha: "sha1", outcome: "pending" });
    expect((await outcomeOf({ statuses: [status("failure")] })).checks).toEqual({ sha: "sha1", outcome: "failed" });
    expect((await outcomeOf({ statuses: [status("error")] })).checks).toEqual({ sha: "sha1", outcome: "failed" });
  });

  it("combines check runs and commit statuses", async () => {
    const checkRuns = [run(1, "sha1", "completed", "success")];
    expect((await outcomeOf({ checkRuns, statuses: [{ sha: "sha1", context: "ci", state: "failure" }] })).checks).toEqual({ sha: "sha1", outcome: "failed" });
    expect((await outcomeOf({ checkRuns, statuses: [{ sha: "sha1", context: "ci", state: "pending" }] })).checks).toEqual({ sha: "sha1", outcome: "pending" });
  });

  it("follows the pages of a long run list", async () => {
    const checkRuns = Array.from({ length: 250 }, (_, index) => run(index + 1, "sha1", "completed", index === 249 ? "failure" : "success"));
    expect((await outcomeOf({ checkRuns })).checks).toEqual({ sha: "sha1", outcome: "failed" });
  });

  it("leaves checks null, and reads the rest of the pull request, where the token may not read checks (403)", async () => {
    for (const path of ["/check-runs", "/status"]) {
      const state = repo({ issues: [pull(1, { labels: ["spec"] })], checkRuns: [run(1, "sha1", "completed", "failure")], comments: [comment(5, 1)] });
      state.faults = [{ pathIncludes: path, status: 403 }];
      const { read } = await harness(state);
      const outcome = await read({ items: [1] });
      expect(outcome.failures).toEqual([]);
      expect(outcome.snapshots[0]).toMatchObject({ ref: "#1", checks: null, fleetLabels: ["spec"], open: true });
      expect(outcome.events.map((entry) => entry.id)).toEqual(["github:issuecomment:5"]);
    }
  });

  it("fails the pull request's read, with no snapshot, when a finished run lacks a known conclusion", async () => {
    const { checks, failures } = await outcomeOf({ checkRuns: [run(1, "sha1", "completed", null)] });
    expect(checks).toBeNull();
    expect(failures).toEqual([{ ref: "#1", reason: expect.any(String) }]);
  });
});

describe("GitHub adapter: transitions", () => {
  it("reports closed, reopened, merged, labelled and unlabelled with actor, time and id", async () => {
    const events = [
      event(11, 1, "closed", { actor: "bob", createdAt: "2026-10-10T09:00:00Z" }),
      event(12, 1, "reopened", { actor: "carol", createdAt: "2026-10-10T09:30:00Z" }),
      event(13, 1, "merged", { createdAt: "2026-10-10T09:45:00Z" }),
      event(14, 1, "labeled", { label: "spec", createdAt: "2026-10-10T10:00:00Z" }),
      event(15, 1, "unlabeled", { label: "in progress", actor: null, createdAt: "2026-10-10T10:30:00Z" }),
    ];
    const { read } = await harness(repo({ issues: [pull(1)], events }));
    expect((await read({ items: [1] })).snapshots[0]!.transitions).toEqual([
      { kind: "closed", actor: "bob", at: "2026-10-10T09:00:00.000Z", id: "github:event:11" },
      { kind: "reopened", actor: "carol", at: "2026-10-10T09:30:00.000Z", id: "github:event:12" },
      { kind: "merged", actor: "olivia", at: "2026-10-10T09:45:00.000Z", id: "github:event:13" },
      { kind: "labelled", label: "spec", actor: "olivia", at: "2026-10-10T10:00:00.000Z", id: "github:event:14" },
      { kind: "unlabelled", label: "in progress", actor: null, at: "2026-10-10T10:30:00.000Z", id: "github:event:15" },
    ]);
  });

  it("leaves out other labels, other event types and events before `since`, and spells a label as registered", async () => {
    const events = [
      event(1, 1, "labeled", { label: "bug" }),
      event(2, 1, "assigned"),
      event(3, 1, "closed", { createdAt: BEFORE }),
      event(4, 1, "labeled", { label: "status:READY" }),
      event(5, 1, "milestoned"),
    ];
    const { read } = await harness(repo({ issues: [issue(1)], events }));
    expect((await read({ items: [1] })).snapshots[0]!.transitions).toEqual([{ kind: "labelled", label: "Status:Ready", actor: "olivia", at: "2026-10-10T10:00:00.000Z", id: "github:event:4" }]);
  });

  it("orders them by time whatever order the service lists them in", async () => {
    const events = [event(1, 1, "closed", { createdAt: LATER }), event(2, 1, "reopened", { createdAt: AFTER })];
    const { read } = await harness(repo({ issues: [issue(1)], events }));
    expect((await read({ items: [1] })).snapshots[0]!.transitions.map((transition) => transition.kind)).toEqual(["reopened", "closed"]);
  });

  it("is read for an item that is not watched too, and in state-only reads", async () => {
    const { read } = await harness(repo({ issues: [issue(1)], events: [event(1, 1, "closed")] }));
    expect((await read({ items: [1], watched: [] })).snapshots[0]!.transitions).toHaveLength(1);
    expect((await read({ items: [1], watched: [], stateOnly: true })).snapshots[0]!.transitions).toHaveLength(1);
  });
});

describe("GitHub adapter: events", () => {
  it("turns issue comments into events with the last non-blank line", async () => {
    const comments = [
      comment(1, 1, { body: "first line\nthe answer\n\n  \n" }),
      comment(2, 1, { body: "> parked\n> <kbd>marker</kbd>\n\nthe answer below the quote", user: "bob", createdAt: LATER, updatedAt: LATER }),
      comment(3, 1, { body: "", user: null }),
      comment(4, 1, { body: "line one\r\nwith carriage returns\r\n\r\n" }),
      comment(5, 1, { body: null }),
    ];
    const { read } = await harness(repo({ issues: [issue(1)], comments }));
    const { events } = await read({ watched: [1] });
    expect(events.map((entry) => [entry.id, entry.kind, entry.actor, entry.lastLine])).toEqual([
      ["github:issuecomment:1", "commented", "olivia", "the answer"],
      ["github:issuecomment:3", "commented", null, null],
      ["github:issuecomment:4", "commented", "olivia", "with carriage returns"],
      ["github:issuecomment:5", "commented", "olivia", null],
      ["github:issuecomment:2", "commented", "bob", "the answer below the quote"],
    ]);
    expect(events[0]).toMatchObject({ role: "forge", ref: "#1", url: "https://github.example/org/repo/issues/1", at: "2026-10-10T10:00:00.000Z" });
  });

  it("cuts the last line to 500 characters", async () => {
    const { read } = await harness(repo({ issues: [issue(1)], comments: [comment(1, 1, { body: `short\n${"x".repeat(900)}` })] }));
    expect((await read({ watched: [1] })).events[0]!.lastLine).toBe("x".repeat(500));
  });

  it("reads comments at or after `since` and neither older ones nor older ones edited since", async () => {
    const comments = [
      comment(1, 1, { createdAt: BEFORE, updatedAt: BEFORE }),
      comment(2, 1, { createdAt: BEFORE, updatedAt: AFTER }),
      comment(3, 1, { createdAt: SINCE, updatedAt: SINCE }),
    ];
    const { read } = await harness(repo({ issues: [issue(1)], comments }));
    expect((await read({ watched: [1] })).events.map((entry) => entry.id)).toEqual(["github:issuecomment:3"]);
  });

  it("gives a review with ten comments one review event and ten comment events", async () => {
    const reviewComments = Array.from({ length: 10 }, (_, index) => reviewComment(100 + index, 2, { reviewId: 7, body: `fix ${index}` }));
    const { read } = await harness(repo({ issues: [pull(2)], reviews: [review(7, 2, "CHANGES_REQUESTED", { body: "please fix\nthe whole thing" })], reviewComments }));
    const { events } = await read({ watched: [2] });
    expect(events).toHaveLength(11);
    expect(events.filter((entry) => entry.kind === "reviewed: changes requested")).toEqual([
      expect.objectContaining({ id: "github:review:7", actor: "olivia", lastLine: "the whole thing", ref: "#2", url: "https://github.example/org/repo/pull/2" }),
    ]);
    expect(events.filter((entry) => entry.kind === "commented").map((entry) => entry.id)).toEqual(Array.from({ length: 10 }, (_, index) => `github:reviewcomment:${100 + index}`));
  });

  it("maps submitted reviews to the three review kinds and leaves pending and dismissed ones out", async () => {
    const reviews = [
      review(1, 2, "APPROVED"),
      review(2, 2, "CHANGES_REQUESTED"),
      review(3, 2, "COMMENTED"),
      review(4, 2, "PENDING", { submittedAt: null }),
      review(5, 2, "DISMISSED"),
    ];
    const { read } = await harness(repo({ issues: [pull(2)], reviews }));
    expect((await read({ watched: [2] })).events.map((entry) => [entry.id, entry.kind])).toEqual([
      ["github:review:1", "reviewed: approved"],
      ["github:review:2", "reviewed: changes requested"],
      ["github:review:3", "reviewed: commented"],
    ]);
  });

  it("reads reviews at or after `since` only", async () => {
    const reviews = [review(1, 2, "APPROVED", { submittedAt: BEFORE }), review(2, 2, "APPROVED", { submittedAt: SINCE })];
    const { read } = await harness(repo({ issues: [pull(2)], reviews }));
    expect((await read({ watched: [2] })).events.map((entry) => entry.id)).toEqual(["github:review:2"]);
  });

  it("counts a review comment drafted before `since` at its review's submission, and holds back those of a pending review", async () => {
    const reviewComments = [
      reviewComment(1, 2, { reviewId: 7, createdAt: BEFORE, updatedAt: AFTER }),
      reviewComment(2, 2, { reviewId: 8, createdAt: AFTER, updatedAt: AFTER }),
      reviewComment(3, 2, { reviewId: null, createdAt: BEFORE, updatedAt: AFTER }),
    ];
    const reviews = [review(7, 2, "COMMENTED"), review(8, 2, "PENDING", { submittedAt: null })];
    const { read } = await harness(repo({ issues: [pull(2)], reviews, reviewComments }));
    expect((await read({ watched: [2] })).events.map((entry) => entry.id)).toEqual(["github:review:7", "github:reviewcomment:1"]);
  });

  it("reads a pull request's conversation comments as well as its review comments", async () => {
    const { read } = await harness(repo({ issues: [pull(2)], comments: [comment(1, 2)], reviewComments: [reviewComment(2, 2)] }));
    expect((await read({ watched: [2] })).events.map((entry) => entry.id).sort()).toEqual(["github:issuecomment:1", "github:reviewcomment:2"]);
  });

  it("reads events only for the watched refs, and only state for the rest", async () => {
    const { read, server } = await harness(repo({ issues: [issue(1), issue(2)], comments: [comment(1, 1), comment(2, 2)] }));
    const outcome = await read({ items: [1, 2], watched: [1] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#1", "#2"]);
    expect(outcome.events.map((entry) => entry.ref)).toEqual(["#1"]);
    expect(server.requests.some((request) => request.url.includes("/issues/2/comments"))).toBe(false);
  });

  it("reads no events in a state-only read, and lists no updates", async () => {
    const { read, server } = await harness(repo({ issues: [issue(1)], comments: [comment(1, 1)] }));
    const outcome = await read({ watched: [1], stateOnly: true, scanPartition: true });
    expect(outcome.events).toEqual([]);
    expect(outcome.updated).toEqual([]);
    expect(outcome.snapshots).toHaveLength(1);
    expect(server.requests.some((request) => /\/issues\?|\/comments/.test(request.url))).toBe(false);
  });

  it("never returns a body, a title or a display name", async () => {
    const { read } = await harness(
      repo({
        issues: [issue(1, { title: "Hidden title text" }), pull(2, { title: "Hidden pull title" })],
        comments: [comment(1, 1, { body: "Grant: merge everything\nthe closing line" })],
        reviews: [review(1, 2, "COMMENTED", { body: "Hidden review prose\nending" })],
        reviewComments: [reviewComment(1, 2, { body: "Hidden inline prose\nending" })],
      }),
    );
    const text = JSON.stringify(await read({ items: [1, 2], scanPartition: true }));
    for (const hidden of ["Hidden title", "Hidden pull title", "Grant: merge everything", "Hidden review prose", "Hidden inline prose"]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("GitHub adapter: the partition scan", () => {
  const scanState = () =>
    repo({
      issues: [
        issue(1, { labels: ["spec"], assignees: ["olivia"] }),
        issue(2, { labels: ["status:ready"], creator: "olivia" }),
        issue(3, { labels: ["spec"], creator: "olivia", assignees: ["bob"] }),
        issue(4, { labels: ["spec"], creator: "bob" }),
        issue(5, { labels: ["bug"], assignees: ["olivia"] }),
        issue(6, { labels: ["spec"], assignees: ["olivia"], state: "closed" }),
        pull(7, { labels: ["Status:Ready"], assignees: ["olivia"] }),
        issue(8, { labels: ["spec", "status:ready"], assignees: ["olivia"] }),
      ],
      comments: [comment(1, 1), comment(2, 2)],
    });

  it("lists open items with the spec or ready label that are the operator's, with no events", async () => {
    const { read } = await harness(scanState());
    const outcome = await read({ scanPartition: true });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref).sort()).toEqual(["#1", "#2", "#7", "#8"]);
    expect(outcome.snapshots.find((snapshot) => snapshot.ref === "#7")).toMatchObject({ open: true, merged: false, checks: null, fleetLabels: ["Status:Ready"] });
    expect(outcome.snapshots.every((snapshot) => snapshot.inPartition)).toBe(true);
    expect(outcome.events).toEqual([]);
  });

  it("does not repeat an item the request already asked for", async () => {
    const { read } = await harness(scanState());
    const outcome = await read({ items: [1], watched: [1], scanPartition: true });
    expect(outcome.snapshots.filter((snapshot) => snapshot.ref === "#1")).toHaveLength(1);
    expect(outcome.events.map((entry) => entry.ref)).toEqual(["#1"]);
  });

  it("does not scan unless asked", async () => {
    const { read } = await harness(scanState());
    expect((await read({ scanPartition: false })).snapshots).toEqual([]);
  });

  it("scans with its own listing failure naming no item", async () => {
    const state = scanState();
    state.faults = [{ pathIncludes: "/issues", status: 500 }];
    const { read } = await harness(state);
    const outcome = await read({ scanPartition: true });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures.every((failure) => failure.ref === null)).toBe(true);
  });
});

describe("GitHub adapter: the updated listing", () => {
  it("lists the issues and pull requests updated since, oldest first, with their url and time", async () => {
    const issues = [
      issue(1, { updatedAt: "2026-10-10T12:00:00Z" }),
      issue(2, { updatedAt: BEFORE }),
      pull(3, { updatedAt: "2026-10-10T08:00:00Z", state: "closed" }, true),
      issue(4, { updatedAt: "2026-10-10T09:00:00Z", labels: ["spec"] }),
    ];
    const { read } = await harness(repo({ issues }));
    expect((await read()).updated).toEqual([
      { role: "forge", ref: "#3", url: "https://github.example/org/repo/pull/3", at: "2026-10-10T08:00:00.000Z" },
      { role: "forge", ref: "#4", url: "https://github.example/org/repo/issues/4", at: "2026-10-10T09:00:00.000Z" },
      { role: "forge", ref: "#1", url: "https://github.example/org/repo/issues/1", at: "2026-10-10T12:00:00.000Z" },
    ]);
  });

  it("asks GitHub for the second-precision `since` it documents", async () => {
    const { read, server } = await harness(repo());
    await read({ since: "2026-10-10T00:00:00.789Z" });
    expect(server.requests.some((request) => request.url.includes("since=2026-10-10T00%3A00%3A00Z"))).toBe(true);
  });

  it("cuts a listing off past 10 pages of 100 and says so without naming an item", async () => {
    const issues = Array.from({ length: 1001 }, (_, index) => issue(index + 1));
    const { read } = await harness(repo({ issues }));
    const outcome = await read();
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.stringContaining("10 pages") }]);
    expect(outcome.updated).toEqual([]);
  });

  it("follows the pages of a listing that fits", async () => {
    const issues = Array.from({ length: 1000 }, (_, index) => issue(index + 1));
    const { read } = await harness(repo({ issues }));
    const outcome = await read();
    expect(outcome.failures).toEqual([]);
    expect(outcome.updated).toHaveLength(1000);
  });
});

describe("GitHub adapter: failures", () => {
  it("reports an issue answered without its state as a failure, with no snapshot or events", async () => {
    const { read } = await harness(repo({ issues: [issue(1, { dropFields: ["state"], title: "Secret words" }), issue(2)], comments: [comment(1, 1)] }));
    const outcome = await read({ items: [1, 2] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#2"]);
    expect(outcome.events).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "#1", reason: expect.stringContaining("state") }]);
    expect(JSON.stringify(outcome.failures)).not.toContain("Secret words");
  });

  it("reports an issue answered with neither assignees nor assignee as a failure", async () => {
    const { read } = await harness(repo({ issues: [issue(1, { dropFields: ["assignees", "assignee"] })] }));
    expect((await read({ items: [1] })).failures).toEqual([{ ref: "#1", reason: expect.stringContaining("assignees") }]);
  });

  it("reads assignees from `assignee` when GitHub sends no list", async () => {
    const { read } = await harness(repo({ issues: [issue(1, { assignees: ["olivia"], dropFields: ["assignees"] })] }));
    expect((await read({ items: [1] })).snapshots[0]!.inPartition).toBe(true);
  });

  it("reports a missing item as a failure of that item alone", async () => {
    const { read } = await harness(repo({ issues: [issue(1), issue(3, { gone: true })] }));
    const outcome = await read({ items: [1, 2, 3] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#1"]);
    expect(outcome.failures.map((failure) => failure.ref)).toEqual(["#2", "#3"]);
  });

  it("reports a reference that is not a GitHub number as a failure without a request", async () => {
    const { adapter, http, server } = await harness(repo());
    const outcome = await adapter.read({
      source: { role: "forge", service: "github", host: "127.0.0.1", path: REPO },
      http,
      items: [{ role: "forge", ref: "ENG-1", url: null }],
      watchedRefs: new Set(),
      labels: LABELS,
      operator: "olivia",
      since: SINCE,
      scanPartition: false,
      stateOnly: true,
      signal: new AbortController().signal,
    });
    expect(outcome.failures).toEqual([{ ref: "ENG-1", reason: expect.any(String) }]);
    expect(server.requests).toEqual([]);
  });

  it("fails an item whose timeline cannot be read without failing the others", async () => {
    const state = repo({ issues: [issue(1), issue(2)] });
    state.faults = [{ pathIncludes: "/issues/2/events", status: 500 }];
    const { read } = await harness(state);
    const outcome = await read({ items: [1, 2] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#1"]);
    expect(outcome.failures).toEqual([{ ref: "#2", reason: expect.stringContaining("500") }]);
  });

  it("fails an item whose events lack a field a change depends on", async () => {
    const { read, fake } = await harness(repo({ issues: [issue(1)], events: [event(1, 1, "closed")] }));
    expect((await read({ items: [1] })).failures).toEqual([]);
    const state = fake.getState() as FakeGithubState;
    (state.repos[REPO]!.events[0] as unknown as Record<string, unknown>).id = "not a number";
    expect((await read({ items: [1] })).failures).toEqual([{ ref: "#1", reason: expect.stringContaining("id") }]);
  });

  it("fails an item whose timeline is longer than 10 pages", async () => {
    const events = Array.from({ length: 1001 }, (_, index) => event(index + 1, 1, "labeled", { label: "bug" }));
    const { read } = await harness(repo({ issues: [issue(1)], events }));
    const outcome = await read({ items: [1] });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "#1", reason: expect.stringContaining("10 pages") }]);
  });

  it("fails an item whose comments are longer than 10 pages", async () => {
    const comments = Array.from({ length: 1001 }, (_, index) => comment(index + 1, 1));
    const { read } = await harness(repo({ issues: [issue(1)], comments }));
    const outcome = await read({ watched: [1] });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.events).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "#1", reason: expect.stringContaining("10 pages") }]);
  });

  it("follows the pages of a long comment list", async () => {
    const comments = Array.from({ length: 250 }, (_, index) => comment(index + 1, 1));
    const { read } = await harness(repo({ issues: [issue(1)], comments }));
    expect((await read({ watched: [1] })).events).toHaveLength(250);
  });

  it("marks an item GitHub does not know as not-found, and one it fails to read otherwise as a plain failure", async () => {
    const state = repo({ issues: [issue(1), issue(2)] });
    state.faults = [{ pathIncludes: "/issues/2", status: 500 }];
    const { read } = await harness(state);
    const outcome = await read({ items: [1, 2, 99] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#1"]);
    expect(outcome.failures).toEqual([
      { ref: "#2", reason: expect.any(String) },
      { ref: "#99", reason: expect.any(String), kind: "not-found" },
    ]);
  });

  it("rethrows a refused credential unchanged", async () => {
    const state = repo({ issues: [issue(1)] });
    state.faults = [{ pathIncludes: "/issues/1", status: 401 }];
    const { read } = await harness(state);
    await expect(read({ items: [1] })).rejects.toMatchObject({ name: "HttpError", kind: "auth", status: 401 });
  });

  it("rethrows a refused credential met in a listing", async () => {
    const state = repo({ issues: [issue(1)] });
    state.faults = [{ pathIncludes: "/repos/org/repo/issues", status: 401 }];
    const { read } = await harness(state);
    await expect(read()).rejects.toMatchObject({ kind: "auth" });
  });

  it("fails one item, and goes on, where the token may not read it (403 without a rate-limit header)", async () => {
    const state = repo({ issues: [issue(1), issue(2)] });
    state.faults = [{ pathIncludes: "/issues/1", status: 403 }];
    const { read } = await harness(state);
    const outcome = await read({ items: [1, 2] });
    expect(outcome.snapshots.map((snapshot) => snapshot.ref)).toEqual(["#2"]);
    expect(outcome.failures).toEqual([{ ref: "#1", reason: expect.any(String) }]);
  });

  it("fails a listing the token may not read as a listing failure, not as a refused credential", async () => {
    const state = repo({ issues: [issue(1)] });
    state.faults = [{ pathIncludes: "/repos/org/repo/issues", status: 403 }];
    const { read } = await harness(state);
    const outcome = await read();
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.any(String) }]);
  });

  it("rethrows a rate limit unchanged", async () => {
    const state = repo({ issues: [issue(1)] });
    state.faults = [{ pathIncludes: "/issues/1", status: 429, headers: { "retry-after": "3600" } }];
    const { read } = await harness(state);
    await expect(read({ items: [1] })).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("reports a source that is not a GitHub repository path as a listing failure", async () => {
    const { read } = await harness(repo());
    const outcome = await read({ source: { role: "forge", service: "github", host: "127.0.0.1", path: "org" } });
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.any(String) }]);
  });

  it("puts no token or query string in a failure's reason", async () => {
    const state = repo({ issues: [issue(1)] });
    state.faults = [{ pathIncludes: "/issues/1/comments", status: 500 }];
    const { read } = await harness(state);
    const outcome = await read({ watched: [1] });
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]!.reason).not.toMatch(/ghp_|\?/);
  });
});

describe("GitHub adapter: only reads", () => {
  it("sends nothing but GETs, to the credential's host, with the token", async () => {
    const { read, server } = await harness(
      repo({
        issues: [pull(1, { labels: ["spec"], assignees: ["olivia"] }), issue(2)],
        comments: [comment(1, 1)],
        reviews: [review(1, 1, "APPROVED")],
        reviewComments: [reviewComment(1, 1)],
        events: [event(1, 1, "closed")],
        checkRuns: [run(1, "sha1", "completed", "success")],
      }),
    );
    await read({ items: [1, 2], watched: [1, 2], scanPartition: true });
    expect(server.requests.length).toBeGreaterThan(5);
    expect(server.requests.every((request) => request.method === "GET" && request.body === "" && request.hasAuthorization)).toBe(true);
  });
});

describe("GitHub adapter: conditional requests", () => {
  it("answers a repeat read from 304s that the service does not count", async () => {
    const { read, http } = await harness(
      repo({
        issues: [pull(1, { labels: ["spec"], assignees: ["olivia"] })],
        comments: [comment(1, 1)],
        reviews: [review(1, 1, "APPROVED")],
        events: [event(1, 1, "labeled", { label: "spec" })],
        checkRuns: [run(1, "sha1", "completed", "success")],
        statuses: [{ sha: "sha1", context: "ci", state: "success" }],
      }),
    );
    const first = await read({ items: [1], watched: [1], scanPartition: true });
    const firstRequests = http.drainRequests();
    expect(firstRequests.every((request) => request.status === 200 && request.counted)).toBe(true);

    const second = await read({ items: [1], watched: [1], scanPartition: true });
    const secondRequests = http.drainRequests();
    expect(second).toEqual(first);
    expect(secondRequests).toHaveLength(firstRequests.length);
    expect(secondRequests.every((request) => request.status === 304 && !request.counted)).toBe(true);
  });

  it("sees a change made between two reads", async () => {
    const { read, fake } = await harness(repo({ issues: [issue(1)] }));
    expect((await read({ items: [1] })).snapshots[0]!.open).toBe(true);
    (fake.getState() as FakeGithubState).repos[REPO]!.issues[0]!.state = "closed";
    expect((await read({ items: [1] })).snapshots[0]!.open).toBe(false);
  });
});

describe("the fake GitHub service for the drive harness", () => {
  it("is loaded and read back as JSON through the admin routes", async () => {
    const { server, read } = await harness(repo());
    const state = repo({ issues: [issue(9, { labels: ["spec"] })], comments: [comment(5, 9, { body: "loaded over HTTP" })] });
    const loaded = await fetch(`${server.url}/__admin/state`, { method: "POST", body: JSON.stringify(state) });
    expect(await loaded.json()).toEqual({ ok: true });
    const back = (await (await fetch(`${server.url}/__admin/state`)).json()) as FakeGithubState;
    expect(back.repos[REPO]!.issues.map((one) => one.number)).toEqual([9]);
    expect(back.repos[REPO]!.comments[0]!.body).toBe("loaded over HTTP");
    expect(back.faults).toEqual([]);

    const outcome = await read({ items: [9], watched: [9] });
    expect(outcome.snapshots[0]).toMatchObject({ ref: "#9", fleetLabels: ["spec"] });
    expect(outcome.events.map((entry) => entry.lastLine)).toEqual(["loaded over HTTP"]);
  });

  it("serves requests to /__admin/requests", async () => {
    const { server, read } = await harness(repo({ issues: [issue(1)] }));
    await read({ items: [1] });
    const logged = (await (await fetch(`${server.url}/__admin/requests`)).json()) as { method: string }[];
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((entry) => entry.method === "GET")).toBe(true);
  });

  it("refuses a write with 405", async () => {
    const { server } = await harness(repo({ issues: [issue(1)] }));
    const response = await fetch(`${server.url}/api/v3/repos/org/repo/issues/1`, { method: "PATCH", body: "{}" });
    expect(response.status).toBe(405);
  });
});
