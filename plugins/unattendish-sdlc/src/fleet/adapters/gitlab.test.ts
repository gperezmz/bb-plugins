import { afterEach, describe, expect, it } from "vitest";
import { createFakeGitlab, type FakeGitlabState, type FakeItem, type FakeMergeRequest, type FakeNote } from "../../../test/fakes/gitlab";
import { listen, type Mounted } from "../../../test/fakes/listen";
import { HttpError, type ReadRequest, type ResolvedCredential } from "../application/ports";
import type { FleetLabels, ReadOutcome, WatchedItem } from "../domain/model";
import { HttpClient } from "./http";
import { createGitlabAdapter } from "./gitlab";
import { checksOutcome, lastLine, pipelineOutcome } from "./gitlab-normalise";

const TOKEN = "glpat-secretsecretsecret";
const PATH = "org/sub/repo";
const SINCE = "2026-10-10T00:00:00Z";
const BEFORE = "2026-10-09T00:00:00Z";
const AFTER = "2026-10-11T00:00:00Z";
const LABELS: FleetLabels = { spec: "spec", ready: "status:ready", inProgress: "status:in-progress", needsInput: "status:needs-input" };

const mounts: Mounted[] = [];
afterEach(async () => {
  await Promise.all(mounts.splice(0).map((mounted) => mounted.close()));
});

const world = async (projects: Record<string, { issues?: FakeItem[]; mergeRequests?: FakeMergeRequest[] }>, extra: Partial<FakeGitlabState> = {}) => {
  const fake = createFakeGitlab({
    ...extra,
    projects: Object.fromEntries(Object.entries(projects).map(([path, project]) => [path, { issues: project.issues ?? [], mergeRequests: project.mergeRequests ?? [] }])),
  });
  const mounted = await listen(fake);
  mounts.push(mounted);
  const credential: ResolvedCredential = { prefix: "gitlab.com/org", service: "gitlab", auth: "token", baseUrl: `${mounted.url}/api/v4`, host: "127.0.0.1" };
  const http = new HttpClient({ sleep: async () => undefined }).session(credential, TOKEN);
  const read = (over: Partial<ReadRequest> = {}): Promise<ReadOutcome> =>
    createGitlabAdapter().read({
      source: { role: "forge", service: "gitlab", host: "gitlab.com", path: PATH },
      http,
      items: [],
      watchedRefs: new Set(),
      labels: LABELS,
      operator: "olga",
      since: SINCE,
      scanPartition: false,
      stateOnly: false,
      signal: new AbortController().signal,
      ...over,
    });
  return { fake, mounted, http, read };
};

const issue = (iid: number, extra: Partial<FakeItem> = {}): FakeItem => ({ iid, state: "opened", author: "olga", updated_at: AFTER, ...extra });
const mr = (iid: number, extra: Partial<FakeMergeRequest> = {}): FakeMergeRequest => ({ ...issue(iid), sha: `sha${iid}`, ...extra });
const watch = (ref: string): WatchedItem => ({ role: "forge", ref, url: null });
const only = <T>(rows: readonly T[]): T => {
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const note = (id: number, body: string, extra: Partial<FakeNote> = {}): FakeNote => ({ id, author: "pat", body, created_at: AFTER, ...extra });

describe("the GitLab adapter: snapshots", () => {
  it("reads an issue: state, url, the registered labels as registered, partition", async () => {
    const { read, mounted } = await world({ [PATH]: { issues: [issue(1, { labels: ["Status:READY", "bug"], assignees: ["Olga"] })] } });
    const { snapshots, failures } = await read({ items: [watch("#1")] });
    expect(failures).toEqual([]);
    expect(only(snapshots)).toEqual({
      role: "forge",
      ref: "#1",
      url: `${mounted.url}/${PATH}/-/issues/1`,
      open: true,
      merged: false,
      fleetLabels: ["status:ready"],
      checks: null,
      inPartition: true,
      transitions: [],
    });
  });

  it("reads a closed issue as not open", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(2, { state: "closed" })] } });
    const snapshot = only((await read({ items: [watch("#2")] })).snapshots);
    expect(snapshot).toMatchObject({ open: false, merged: false });
  });

  it("finds the operator's partition by assignee, by author with no assignee, and neither", async () => {
    const { read } = await world({
      [PATH]: {
        issues: [
          issue(1, { author: "bob", assignees: ["olga"] }),
          issue(2, { author: "olga", assignees: [] }),
          issue(3, { author: "olga", assignees: ["bob"] }),
          issue(4, { author: "bob", assignees: [] }),
          issue(5, { author: "olga", assignees: ["bob", "olga"] }),
        ],
      },
    });
    const { snapshots } = await read({ items: ["#1", "#2", "#3", "#4", "#5"].map(watch) });
    expect(snapshots.map((s) => [s.ref, s.inPartition])).toEqual([
      ["#1", true],
      ["#2", true],
      ["#3", false],
      ["#4", false],
      ["#5", true],
    ]);
  });

  it("reads an open, a closed and a merged merge request", async () => {
    const { read } = await world({
      [PATH]: {
        mergeRequests: [mr(1), mr(2, { state: "closed" }), mr(3, { state: "merged", merged_at: AFTER, merged_by: "olga" })],
      },
    });
    const { snapshots } = await read({ items: ["!1", "!2", "!3"].map(watch) });
    expect(snapshots.map((s) => [s.ref, s.open, s.merged])).toEqual([
      ["!1", true, false],
      ["!2", false, false],
      ["!3", false, true],
    ]);
  });

  it("never carries a title, a description or a display name", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1, { title: "Secret title", description: "Secret description", notes: [note(1, "hello")] })], mergeRequests: [mr(2, { merged_by: "olga" })] } });
    const outcome = await read({ items: [watch("#1"), watch("!2")], watchedRefs: new Set(["#1", "!2"]) });
    const text = JSON.stringify(outcome);
    for (const forbidden of ["Secret title", "Secret description", "Display name of", TOKEN]) expect(text).not.toContain(forbidden);
  });

  it("reads nothing but the project it was given, URL-encoded as the :id", async () => {
    const { read, mounted } = await world({ [PATH]: { issues: [issue(1)] } });
    await read({ items: [watch("#1")] });
    expect(mounted.requests.map((r) => r.url)[1]).toMatch(/^\/api\/v4\/projects\/org%2Fsub%2Frepo\/issues\/1/);
  });
});

describe("the GitLab adapter: transitions", () => {
  it("reports registered label changes and closes and reopens, with actor, time and id, on or after since", async () => {
    const { read } = await world({
      [PATH]: {
        issues: [
          issue(1, {
            labelEvents: [
              { id: 1, user: "olga", created_at: BEFORE, label: "spec", action: "add" },
              { id: 2, user: "olga", created_at: AFTER, label: "Status:Ready", action: "add" },
              { id: 3, user: "bot", created_at: AFTER, label: "bug", action: "add" },
              { id: 4, user: "pat", created_at: "2026-10-11T01:00:00Z", label: "spec", action: "remove" },
              { id: 5, user: "pat", created_at: AFTER, label: null, action: "add" },
            ],
            stateEvents: [
              { id: 10, user: "pat", created_at: BEFORE, state: "closed" },
              { id: 11, user: "pat", created_at: "2026-10-11T02:00:00Z", state: "closed" },
              { id: 12, user: "olga", created_at: "2026-10-11T03:00:00Z", state: "reopened" },
              { id: 13, user: "olga", created_at: "2026-10-11T04:00:00Z", state: "locked" },
            ],
          }),
        ],
      },
    });
    const { transitions } = only((await read({ items: [watch("#1")] })).snapshots);
    expect(transitions).toEqual([
      { kind: "labelled", label: "status:ready", actor: "olga", at: AFTER.replace("Z", ".000Z"), id: "gitlab:label_event:2" },
      { kind: "unlabelled", label: "spec", actor: "pat", at: "2026-10-11T01:00:00.000Z", id: "gitlab:label_event:4" },
      { kind: "closed", actor: "pat", at: "2026-10-11T02:00:00.000Z", id: "gitlab:state_event:11" },
      { kind: "reopened", actor: "olga", at: "2026-10-11T03:00:00.000Z", id: "gitlab:state_event:12" },
    ]);
  });

  it("reads the merge from a merged state event when there is one, else from merged_at", async () => {
    const { read } = await world({
      [PATH]: {
        mergeRequests: [
          mr(1, { state: "merged", merged_at: AFTER, merged_by: "olga", stateEvents: [{ id: 7, user: "olga", created_at: AFTER, state: "merged" }] }),
          mr(2, { state: "merged", merged_at: AFTER, merged_by: "olga" }),
          mr(3, { state: "merged", merged_at: BEFORE, merged_by: "olga" }),
        ],
      },
    });
    const { snapshots } = await read({ items: ["!1", "!2", "!3"].map(watch) });
    expect(snapshots.map((s) => s.transitions.map((t) => [t.kind, t.id]))).toEqual([[["merged", "gitlab:state_event:7"]], [["merged", "gitlab:merged:2"]], []]);
    expect(snapshots[1]!.transitions[0]!.actor).toBe("olga");
  });
});

describe("the GitLab adapter: events", () => {
  it("turns an issue's comments on or after since into events, and skips system notes", async () => {
    const { read } = await world({
      [PATH]: {
        issues: [
          issue(1, {
            notes: [
              note(1, "old", { created_at: BEFORE }),
              note(2, "closed", { system: true }),
              note(3, "first\n\nanswer here\n\n   \n"),
              note(4, "> <kbd>marker</kbd>\n\nthe answer", { author: "olga" }),
              note(5, "", { author: "olga" }),
            ],
          }),
        ],
      },
    });
    const { events } = await read({ items: [watch("#1")], watchedRefs: new Set(["#1"]) });
    expect(events.map((e) => [e.id, e.kind, e.actor, e.lastLine])).toEqual([
      ["gitlab:note:3", "commented", "pat", "answer here"],
      ["gitlab:note:4", "commented", "olga", "the answer"],
      ["gitlab:note:5", "commented", "olga", null],
    ]);
    expect(events[0]).toMatchObject({ role: "forge", ref: "#1", at: "2026-10-11T00:00:00.000Z" });
    expect(events[0]!.url).toContain("/issues/1");
  });

  it("reads a review of ten inline comments as ten comment events and the approval as one review event", async () => {
    const inline = Array.from({ length: 10 }, (_, i) => note(100 + i, `inline ${i}`, { type: "DiffNote", discussion: `d${i}`, author: "pat" }));
    const { read } = await world({
      [PATH]: {
        mergeRequests: [
          mr(5, {
            notes: [note(1, "conversation comment", { type: "DiscussionNote" }), ...inline, note(2, "approved", { system: true }), note(3, "stale", { created_at: BEFORE })],
            approvals: [
              { user: "pat", approved_at: AFTER },
              { user: "old", approved_at: BEFORE },
            ],
          }),
        ],
      },
    });
    const { events, failures } = await read({ items: [watch("!5")], watchedRefs: new Set(["!5"]) });
    expect(failures).toEqual([]);
    expect(events.filter((e) => e.kind === "commented")).toHaveLength(11);
    const approvals = events.filter((e) => e.kind !== "commented");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ kind: "reviewed: approved", actor: "pat", ref: "!5", lastLine: null });
    expect(approvals[0]!.id).toMatch(/^gitlab:approval:5:\d+:2026-10-11T00:00:00Z$/);
    expect(events.every((e) => e.id.startsWith("gitlab:"))).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it("reads events of watched items only, and none when only state is wanted", async () => {
    const { read, mounted } = await world({ [PATH]: { issues: [issue(1, { notes: [note(1, "x")] }), issue(2, { notes: [note(2, "y")] })] } });
    const first = await read({ items: [watch("#1"), watch("#2")], watchedRefs: new Set(["#1"]) });
    expect(first.events.map((e) => e.ref)).toEqual(["#1"]);
    expect(first.snapshots).toHaveLength(2);
    mounted.requests.length = 0;
    const stateOnly = await read({ items: [watch("#1")], watchedRefs: new Set(["#1"]), stateOnly: true, scanPartition: true });
    expect(stateOnly.events).toEqual([]);
    expect(stateOnly.updated).toEqual([]);
    expect(mounted.requests.map((r) => r.url).filter((u) => /\/notes|updated_after|labels=/.test(u))).toEqual([]);
  });

  it("is a failure, not a partial answer, when an approval lacks its time", async () => {
    const { read } = await world({ [PATH]: { mergeRequests: [mr(5, { omit: ["approvals.approved_by"] })] } });
    const outcome = await read({ items: [watch("!5")], watchedRefs: new Set(["!5"]) });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.events).toEqual([]);
    expect(only(outcome.failures)).toMatchObject({ ref: "!5" });
  });
});

describe("the GitLab adapter: checks", () => {
  const statuses = async (pipelines: { id: number; sha: string; status: string }[], sha = "head") => {
    const { read } = await world({ [PATH]: { mergeRequests: [mr(1, { sha, pipelines })] } });
    const outcome = await read({ items: [watch("!1")] });
    return outcome.snapshots[0]?.checks ?? (outcome.failures.length > 0 ? outcome.failures : null);
  };

  it("is pending while any pipeline is pending or running, whatever else has finished", async () => {
    expect(await statuses([{ id: 1, sha: "head", status: "failed" }, { id: 2, sha: "head", status: "running" }])).toEqual({ sha: "head", outcome: "pending" });
    expect(await statuses([{ id: 1, sha: "head", status: "scheduled" }])).toEqual({ sha: "head", outcome: "pending" });
  });

  it("is failed when any finished failed or was canceled, passed when all passed, skipped or manual", async () => {
    expect(await statuses([{ id: 1, sha: "head", status: "success" }, { id: 2, sha: "head", status: "canceled" }])).toEqual({ sha: "head", outcome: "failed" });
    expect(await statuses([{ id: 1, sha: "head", status: "success" }, { id: 2, sha: "head", status: "skipped" }, { id: 3, sha: "head", status: "manual" }])).toEqual({ sha: "head", outcome: "passed" });
  });

  it("is null for a merge request with no pipeline at its head, and ignores pipelines of older commits", async () => {
    expect(await statuses([])).toBeNull();
    expect(await statuses([{ id: 1, sha: "older", status: "failed" }])).toBeNull();
  });

  it("is a failure for a status GitLab does not document", async () => {
    const result = await statuses([{ id: 1, sha: "head", status: "exploded" }]);
    expect(result).toEqual([{ ref: "!1", reason: expect.not.stringContaining("exploded") }]);
  });

  it("gives an issue no checks", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1)] } });
    expect(only((await read({ items: [watch("#1")] })).snapshots).checks).toBeNull();
  });
});

describe("the GitLab adapter: the partition scan", () => {
  it("lists open items with the spec or ready label that are the operator's, without events", async () => {
    const { read } = await world({
      [PATH]: {
        issues: [
          issue(1, { labels: ["spec"], assignees: ["olga"], notes: [note(1, "x")] }),
          issue(2, { labels: ["status:ready"], author: "olga", assignees: [] }),
          issue(3, { labels: ["spec"], author: "olga", assignees: ["bob"] }),
          issue(4, { labels: ["spec"], author: "bob", assignees: [] }),
          issue(5, { labels: ["spec"], assignees: ["olga"], state: "closed" }),
          issue(6, { labels: ["bug"], assignees: ["olga"] }),
          issue(7, { labels: ["spec", "status:ready"], assignees: ["olga"] }),
        ],
        mergeRequests: [mr(8, { labels: ["status:ready"], assignees: ["olga"] })],
      },
    });
    const outcome = await read({ scanPartition: true });
    expect(outcome.snapshots.map((s) => s.ref).sort()).toEqual(["!8", "#1", "#2", "#7"]);
    expect(outcome.snapshots.every((s) => s.inPartition)).toBe(true);
    expect(outcome.events).toEqual([]);
    expect(outcome.failures).toEqual([]);
  });

  it("does not read twice an item the request already lists", async () => {
    const { read, mounted } = await world({ [PATH]: { issues: [issue(1, { labels: ["spec"], assignees: ["olga"] })] } });
    const outcome = await read({ items: [watch("#1")], scanPartition: true });
    expect(outcome.snapshots).toHaveLength(1);
    expect(mounted.requests.filter((r) => /\/issues\/1(\?|$)/.test(r.url))).toHaveLength(1);
  });

  it("keeps what the other listings gave when one fails", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1, { labels: ["spec"], assignees: ["olga"] })], mergeRequests: [mr(2, { labels: ["spec"], assignees: ["olga"] })] } }, { faults: [{ match: "/merge_requests?", status: 500 }] });
    const outcome = await read({ scanPartition: true });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["#1"]);
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(outcome.failures.every((f) => f.ref === null)).toBe(true);
  });
});

describe("the GitLab adapter: the updated listing", () => {
  it("lists the issues and merge requests updated since, with their time and page", async () => {
    const { read, mounted } = await world({
      [PATH]: {
        issues: [issue(1, { updated_at: AFTER }), issue(2, { updated_at: BEFORE })],
        mergeRequests: [mr(3, { updated_at: "2026-10-12T00:00:00Z" }), mr(4, { updated_at: BEFORE })],
      },
    });
    const { updated } = await read();
    expect(updated.map((u) => [u.role, u.ref, u.at])).toEqual([
      ["forge", "#1", "2026-10-11T00:00:00.000Z"],
      ["forge", "!3", "2026-10-12T00:00:00.000Z"],
    ]);
    expect(updated[0]!.url).toBe(`${mounted.url}/${PATH}/-/issues/1`);
  });

  it("gives an item the role the request lists it under", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1)] } });
    const { updated } = await read({ items: [{ role: "tracker", ref: "#1", url: null }] });
    expect(updated[0]!.role).toBe("tracker");
  });
});

describe("the GitLab adapter: failures", () => {
  it("fails an issue answered without its state: no snapshot, no events, no text from the service", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1, { omit: ["state"], title: "Secret title", notes: [note(1, "x")] }), issue(2)] } });
    const outcome = await read({ items: [watch("#1"), watch("#2")], watchedRefs: new Set(["#1", "#2"]) });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["#2"]);
    expect(outcome.events.map((e) => e.ref)).not.toContain("#1");
    const failure = only(outcome.failures);
    expect(failure.ref).toBe("#1");
    expect(failure.reason).toContain("state");
    expect(failure.reason).not.toContain("Secret title");
  });

  it("fails a merge request answered without its head commit", async () => {
    const { read } = await world({ [PATH]: { mergeRequests: [mr(1, { omit: ["sha"] })] } });
    const outcome = await read({ items: [watch("!1")] });
    expect(outcome.snapshots).toEqual([]);
    expect(only(outcome.failures)).toMatchObject({ ref: "!1" });
  });

  it("fails an item GitLab does not know, and one whose reference is neither # nor !", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1)] } });
    const outcome = await read({ items: [watch("#99"), watch("ENG-1"), watch("#1")] });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["#1"]);
    expect(outcome.failures.map((f) => f.ref)).toEqual(["#99", "ENG-1"]);
    expect(outcome.failures[0]!.reason).toContain("404");
  });

  it("fails a label event without its id", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1, { labelEvents: [{ id: undefined as unknown as number, user: "x", created_at: AFTER, label: "spec", action: "add" }] })] } });
    const outcome = await read({ items: [watch("#1")] });
    expect(outcome.snapshots).toEqual([]);
    expect(only(outcome.failures).ref).toBe("#1");
  });

  it("rethrows a refused credential and a rate limit, unchanged", async () => {
    const refused = await world({ [PATH]: { issues: [issue(1)] } }, { faults: [{ match: "/issues/1", status: 401 }] });
    await expect(refused.read({ items: [watch("#1")] })).rejects.toMatchObject({ kind: "auth" });
    await expect(refused.read({ items: [watch("#1")] })).rejects.toBeInstanceOf(HttpError);
    const limited = await world({ [PATH]: { issues: [issue(1)] } }, { faults: [{ match: "/issues/1", status: 429 }] });
    await expect(limited.read({ items: [watch("#1")] })).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("fails an item whose read errs otherwise, and goes on", async () => {
    const { read } = await world({ [PATH]: { issues: [issue(1), issue(2)] } }, { faults: [{ match: "/issues/1/resource_label_events", status: 400 }] });
    const outcome = await read({ items: [watch("#1"), watch("#2")] });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["#2"]);
    expect(only(outcome.failures)).toMatchObject({ ref: "#1" });
  });

  it("reads a project it cannot see as a failure of the item and of each listing", async () => {
    const { read } = await world({ "other/project": { issues: [issue(1)] } });
    const outcome = await read({ items: [watch("#1")] });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures.map((f) => f.ref)).toEqual(["#1", null, null]);
  });

  it("fails a source that is not GitLab without a request", async () => {
    const { read, mounted } = await world({ [PATH]: {} });
    const outcome = await read({ source: { role: "tracker", service: "linear", team: "ENG" } });
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.any(String) }]);
    expect(mounted.requests).toEqual([]);
  });
});

describe("the GitLab adapter: pages", () => {
  it("follows the pages of a list", async () => {
    const notes = Array.from({ length: 7 }, (_, i) => note(i + 1, `comment ${i}`));
    const { read, mounted } = await world({ [PATH]: { issues: [issue(1, { notes })] } }, { maxPerPage: 2 });
    const { events, failures } = await read({ items: [watch("#1")], watchedRefs: new Set(["#1"]) });
    expect(failures).toEqual([]);
    expect(events).toHaveLength(7);
    expect(mounted.requests.filter((r) => r.url.includes("/notes"))).toHaveLength(4);
  });

  it("fails the item whose list is longer than 10 pages", async () => {
    const notes = Array.from({ length: 25 }, (_, i) => note(i + 1, "x"));
    const { read } = await world({ [PATH]: { issues: [issue(1, { notes }), issue(2)] } }, { maxPerPage: 2 });
    const outcome = await read({ items: [watch("#1"), watch("#2")], watchedRefs: new Set(["#1", "#2"]) });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["#2"]);
    expect(outcome.events).toEqual([]);
    expect(only(outcome.failures)).toMatchObject({ ref: "#1", reason: expect.stringContaining("more than 10 pages") });
  });

  it("reports a cut-off listing of updates as a failure with no reference, keeping what it read", async () => {
    const issues = Array.from({ length: 25 }, (_, i) => issue(i + 1));
    const { read } = await world({ [PATH]: { issues } }, { maxPerPage: 2 });
    const { updated, failures } = await read();
    expect(updated).toEqual([]);
    expect(failures).toEqual([{ ref: null, reason: expect.stringContaining("more than 10 pages") }]);
  });

  it("reads 10 full pages of 100 as complete", async () => {
    const issues = Array.from({ length: 300 }, (_, i) => issue(i + 1));
    const { read, mounted } = await world({ [PATH]: { issues } });
    const { updated, failures } = await read();
    expect(failures).toEqual([]);
    expect(updated).toHaveLength(300);
    expect(mounted.requests.some((r) => r.url.includes("per_page=100"))).toBe(true);
  });
});

describe("the GitLab adapter: requests", () => {
  it("sends reads only, each with the credential", async () => {
    const { read, mounted } = await world(
      { [PATH]: { issues: [issue(1, { labels: ["spec"], assignees: ["olga"] })], mergeRequests: [mr(2, { pipelines: [{ id: 1, sha: "sha2", status: "success" }] })] } },
      { token: { expires_at: "2027-03-01" } },
    );
    await read({ items: [watch("#1"), watch("!2")], watchedRefs: new Set(["#1", "!2"]), scanPartition: true });
    expect(mounted.requests.length).toBeGreaterThan(10);
    expect(mounted.requests.every((r) => r.method === "GET" && r.body === "" && r.hasAuthorization)).toBe(true);
  });

  it("answers a repeat read with conditional requests", async () => {
    const { read, http } = await world({ [PATH]: { issues: [issue(1, { notes: [note(1, "x")] })], mergeRequests: [mr(2)] } });
    const request = { items: [watch("#1"), watch("!2")], watchedRefs: new Set(["#1", "!2"]), scanPartition: true };
    const first = await read(request);
    http.drainRequests();
    const second = await read(request);
    expect(second).toEqual(first);
    const records = http.drainRequests();
    expect(records.length).toBeGreaterThan(5);
    expect(records.filter((r) => r.status === 304).length).toBe(records.filter((r) => !r.path.endsWith("/personal_access_tokens/self")).length);
  });

  it("reports the token's expiry once per read, and a failure of that call is no failure of the read", async () => {
    const withToken = await world({ [PATH]: { issues: [issue(1)] } }, { token: { expires_at: "2027-03-01" } });
    expect((await withToken.read({ items: [watch("#1")] })).failures).toEqual([]);
    expect(withToken.http.expiresAt()).toBe("2027-03-01T00:00:00.000Z");
    expect(withToken.mounted.requests.filter((r) => r.url.includes("personal_access_tokens/self"))).toHaveLength(1);

    const noExpiry = await world({ [PATH]: { issues: [issue(1)] } }, { token: { expires_at: null } });
    await noExpiry.read({ items: [watch("#1")] });
    expect(noExpiry.http.expiresAt()).toBeNull();

    const notAPersonalToken = await world({ [PATH]: { issues: [issue(1)] } });
    const outcome = await notAPersonalToken.read({ items: [watch("#1")] });
    expect(outcome.failures).toEqual([]);
    expect(outcome.snapshots).toHaveLength(1);
    expect(notAPersonalToken.http.expiresAt()).toBeNull();
  });
});

describe("the fake GitLab, driven over HTTP", () => {
  it("is loaded and read back as JSON through /__admin/state, and the adapter reads what was loaded", async () => {
    const { mounted, read } = await world({ [PATH]: {} });
    const loaded = { projects: { [PATH]: { issues: [issue(1, { labels: ["spec"] })], mergeRequests: [] } }, token: null, maxPerPage: 100, faults: [] };
    const posted = await fetch(`${mounted.url}/__admin/state`, { method: "POST", body: JSON.stringify(loaded) });
    expect(posted.status).toBe(200);
    const back = await fetch(`${mounted.url}/__admin/state`);
    expect(await back.json()).toEqual(loaded);
    expect(only((await read({ items: [watch("#1")] })).snapshots).ref).toBe("#1");

    const logged = (await (await fetch(`${mounted.url}/__admin/requests`)).json()) as { method: string }[];
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((r) => r.method === "GET")).toBe(true);
  });
});

describe("the rules the adapter rests on", () => {
  it("takes the last non-blank line, trimmed, cut to 500 characters", () => {
    expect(lastLine("a\nb\n\n \n")).toBe("b");
    expect(lastLine("only")).toBe("only");
    expect(lastLine("  \n\n")).toBeNull();
    expect(lastLine("")).toBeNull();
    expect(lastLine("x\r\ny\r\n")).toBe("y");
    expect(lastLine("z".repeat(600))).toHaveLength(500);
  });

  it("maps every documented pipeline status", () => {
    const expected = {
      success: "passed",
      skipped: "passed",
      manual: "passed",
      failed: "failed",
      canceled: "failed",
      created: "pending",
      waiting_for_resource: "pending",
      waiting_for_callback: "pending",
      preparing: "pending",
      pending: "pending",
      running: "pending",
      scheduled: "pending",
      canceling: "pending",
    } as const;
    for (const [status, outcome] of Object.entries(expected)) expect(pipelineOutcome(status)).toBe(outcome);
    expect(pipelineOutcome("blocked")).toBeNull();
    expect(checksOutcome([])).toBeNull();
  });
});
