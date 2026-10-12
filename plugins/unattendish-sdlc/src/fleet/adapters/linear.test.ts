import { afterEach, describe, expect, it } from "vitest";
import { createFakeLinear, type LinearComment, type LinearHistory, type LinearIssue, type LinearState } from "../../../test/fakes/linear";
import { listen, type Mounted } from "../../../test/fakes/listen";
import { HttpError, type HttpResponse, type HttpSession, type ReadRequest } from "../application/ports";
import type { ReadOutcome } from "../domain/model";
import { HttpClient } from "./http";
import { createLinearAdapter, isOperator, lastLineOf } from "./linear";

const TOKEN = "lin_api_secretsecret";
const SINCE = "2026-10-10T00:00:00Z";
const OPERATOR = "dana@acme.test";
const LABELS = { spec: "spec", ready: "Ready", inProgress: "in progress", needsInput: "needs input" };

const users = [
  { id: "u-dana", email: "dana@acme.test", displayName: "dana" },
  { id: "u-eli", email: "eli@acme.test", displayName: "eli" },
];

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
});

const issue = (identifier: string, extra: Partial<LinearIssue> = {}): LinearIssue => ({
  identifier,
  state: "started",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  labels: [],
  assignee: "u-dana",
  creator: "u-dana",
  history: [],
  comments: [],
  ...extra,
});

const comment = (id: string, extra: Partial<LinearComment> = {}): LinearComment => ({ id, createdAt: "2026-10-11T00:00:00Z", user: "u-eli", body: "hello", ...extra });
const entry = (id: string, extra: Partial<LinearHistory> = {}): LinearHistory => ({ id, createdAt: "2026-10-11T00:00:00Z", actor: "u-eli", ...extra });

interface Seen {
  method: string;
  headers: Record<string, string>;
}

const setup = async (state: Partial<LinearState>, options: { fetch?: typeof fetch } = {}) => {
  const fake = createFakeLinear({ users, ...state });
  mounted = await listen(fake);
  const headersSeen: Seen[] = [];
  const recording: typeof fetch = async (input, init) => {
    headersSeen.push({ method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return (options.fetch ?? fetch)(input, init);
  };
  const http = new HttpClient({ fetch: recording, sleep: async () => undefined }).session(
    { prefix: "linear:ENG", service: "linear", auth: "token", baseUrl: `${mounted.url}/graphql`, host: "127.0.0.1" },
    TOKEN,
  );
  const adapter = createLinearAdapter();
  const read = (refs: string[], extra: Partial<ReadRequest> = {}, watched: string[] = refs): Promise<ReadOutcome> =>
    adapter.read({
      source: { role: "tracker", service: "linear", team: "ENG" },
      http,
      items: refs.map((ref) => ({ role: "tracker", ref, url: null })),
      watchedRefs: new Set(watched),
      labels: LABELS,
      operator: OPERATOR,
      since: SINCE,
      scanPartition: false,
      stateOnly: false,
      signal: new AbortController().signal,
      ...extra,
    });
  return { fake, http, read, headersSeen, mounted };
};

const queries = (m: Mounted): string[] => m.requests.map((r) => (JSON.parse(r.body) as { query: string }).query);

describe("lastLineOf", () => {
  it("takes the last non-blank line, ignoring trailing blank lines", () => {
    expect(lastLineOf("first\nsecond  \n\n  \n")).toBe("second");
  });
  it("takes the answer below a quote-reply, not the marker above it", () => {
    expect(lastLineOf("> Parked on a question\n> <kbd>🤖 unattendish agent</kbd>\n\nGo with option B")).toBe("Go with option B");
  });
  it("keeps the marker when it is the last line", () => {
    expect(lastLineOf("Verdict: ship\n\n<kbd>🤖 unattendish agent</kbd>")).toBe("<kbd>🤖 unattendish agent</kbd>");
  });
  it("is null for an empty or blank body and cuts a long line to 500 characters", () => {
    expect(lastLineOf("")).toBeNull();
    expect(lastLineOf("\n \r\n")).toBeNull();
    expect(lastLineOf("x".repeat(900))).toHaveLength(500);
  });
  it("handles CRLF line ends", () => {
    expect(lastLineOf("a\r\nb\r\n")).toBe("b");
  });
});

describe("isOperator", () => {
  const person = { id: "u-dana", email: "Dana@Acme.test", displayName: "Dana" };
  it("matches the email, display name or id ignoring case, and nobody else", () => {
    expect(isOperator(person, "dana@acme.test")).toBe(true);
    expect(isOperator(person, "DANA")).toBe(true);
    expect(isOperator(person, "U-DANA")).toBe(true);
    expect(isOperator(person, "eli")).toBe(false);
    expect(isOperator(null, "dana")).toBe(false);
  });
});

describe("the snapshot of an issue", () => {
  it("reads state, url, labels as registered, and no checks or merge", async () => {
    const { read } = await setup({ issues: [issue("ENG-1", { labels: ["SPEC", "ready", "unrelated"], url: "https://linear.app/acme/issue/ENG-1/the-slug" })] });
    const outcome = await read(["ENG-1"]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.snapshots).toEqual([
      {
        role: "tracker",
        ref: "ENG-1",
        url: "https://linear.app/acme/issue/ENG-1/the-slug",
        open: true,
        merged: false,
        fleetLabels: ["spec", "Ready"],
        checks: null,
        inPartition: true,
        transitions: [],
      },
    ]);
  });

  it.each(["triage", "backlog", "unstarted", "started"])("counts a %s issue as open", async (state) => {
    const { read } = await setup({ issues: [issue("ENG-1", { state })] });
    expect((await read(["ENG-1"])).snapshots[0]!.open).toBe(true);
  });

  it.each(["completed", "canceled", "duplicate"])("counts a %s issue as closed and never merged", async (state) => {
    const { read } = await setup({ issues: [issue("ENG-1", { state })] });
    expect((await read(["ENG-1"])).snapshots[0]).toMatchObject({ open: false, merged: false, checks: null });
  });

  it.each([
    ["assigned to the operator by email, ignoring case", { assignee: "u-dana", creator: "u-eli" }, "DANA@acme.test", true],
    ["assigned to the operator by display name", { assignee: "u-dana", creator: "u-eli" }, "Dana", true],
    ["assigned to the operator by account id", { assignee: "u-dana", creator: "u-eli" }, "u-dana", true],
    ["filed by the operator and assigned to nobody", { assignee: null, creator: "u-dana" }, OPERATOR, true],
    ["filed by the operator and assigned to someone else", { assignee: "u-eli", creator: "u-dana" }, OPERATOR, false],
    ["neither assigned to nor filed by the operator", { assignee: "u-eli", creator: "u-eli" }, OPERATOR, false],
    ["filed by someone else and assigned to nobody", { assignee: null, creator: "u-eli" }, OPERATOR, false],
  ] as const)("puts an issue %s in the partition: %s", async (_name, who, operator, expected) => {
    const { read } = await setup({ issues: [issue("ENG-1", who)] });
    expect((await read(["ENG-1"], { operator })).snapshots[0]!.inPartition).toBe(expected);
  });

  it("reads the issue by its identifier whatever the ref's case", async () => {
    const { read } = await setup({ issues: [issue("ENG-12")] });
    expect((await read(["eng-12"])).snapshots[0]!.ref).toBe("eng-12");
  });
});

describe("transitions", () => {
  it("reports a close and a reopening with the actor's account id and other names, time and the history entry's id", async () => {
    const history = [
      entry("h1", { createdAt: "2026-10-11T08:00:00Z", fromState: "started", toState: "completed" }),
      entry("h2", { createdAt: "2026-10-12T08:00:00Z", actor: "u-dana", fromState: "completed", toState: "started" }),
    ];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions).toEqual([
      { kind: "closed", actor: "u-eli", actorAliases: ["eli@acme.test", "eli"], at: "2026-10-11T08:00:00Z", id: "linear:history:h1" },
      { kind: "reopened", actor: "u-dana", actorAliases: ["dana@acme.test", "dana"], at: "2026-10-12T08:00:00Z", id: "linear:history:h2" },
    ]);
  });

  it("does not count a move between two open states, or between two closed ones", async () => {
    const history = [
      entry("h1", { fromState: "backlog", toState: "started" }),
      entry("h2", { fromState: "completed", toState: "canceled" }),
    ];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions).toEqual([]);
  });

  it("reports labels of the four registered, spelled as registered, and none other", async () => {
    const history = [
      entry("h1", { addedLabels: ["READY", "bug"], removedLabels: ["In Progress"] }),
      entry("h2", { actor: null, removedLabels: ["spec"] }),
    ];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions).toEqual([
      { kind: "labelled", label: "Ready", actor: "u-eli", actorAliases: ["eli@acme.test", "eli"], at: "2026-10-11T00:00:00Z", id: "linear:history:h1:labelled:Ready" },
      { kind: "unlabelled", label: "in progress", actor: "u-eli", actorAliases: ["eli@acme.test", "eli"], at: "2026-10-11T00:00:00Z", id: "linear:history:h1:unlabelled:in progress" },
      { kind: "unlabelled", label: "spec", actor: null, at: "2026-10-11T00:00:00Z", id: "linear:history:h2:unlabelled:spec" },
    ]);
  });

  it("reports a state change and a label change of one entry as two transitions with different ids", async () => {
    const history = [entry("h1", { fromState: "started", toState: "completed", addedLabels: ["spec"] })];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    const ids = (await read(["ENG-1"])).snapshots[0]!.transitions.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("leaves out entries before since and keeps one exactly at it", async () => {
    const history = [
      entry("old", { createdAt: "2026-10-09T23:59:59Z", fromState: "started", toState: "completed" }),
      entry("edge", { createdAt: SINCE, fromState: "completed", toState: "started" }),
    ];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions.map((t) => t.id)).toEqual(["linear:history:edge"]);
  });

  it("reads transitions of an item that is not watched too", async () => {
    const history = [entry("h1", { addedLabels: ["spec"] })];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"], {}, [])).snapshots[0]!.transitions).toHaveLength(1);
  });
});

describe("events", () => {
  it("turns comments and their replies into events carrying only the last line", async () => {
    const comments = [
      comment("c1", { body: "Looks good.\n\nSecret rationale here\n\n<kbd>🤖 unattendish agent</kbd>\n\n", user: "u-dana" }),
      comment("c2", { body: "reply body", parent: "c1", createdAt: "2026-10-11T01:00:00Z" }),
      comment("c3", { body: "", user: null, createdAt: "2026-10-11T02:00:00Z" }),
    ];
    const { read } = await setup({ issues: [issue("ENG-1", { url: "https://linear.app/acme/issue/ENG-1", comments })] });
    const outcome = await read(["ENG-1"]);
    expect(outcome.events).toEqual([
      { id: "linear:comment:c1", role: "tracker", ref: "ENG-1", url: "https://linear.app/acme/issue/ENG-1", kind: "commented", actor: "u-dana", actorAliases: ["dana@acme.test", "dana"], at: "2026-10-11T00:00:00Z", lastLine: "<kbd>🤖 unattendish agent</kbd>" },
      { id: "linear:comment:c2", role: "tracker", ref: "ENG-1", url: "https://linear.app/acme/issue/ENG-1", kind: "commented", actor: "u-eli", actorAliases: ["eli@acme.test", "eli"], at: "2026-10-11T01:00:00Z", lastLine: "reply body" },
      { id: "linear:comment:c3", role: "tracker", ref: "ENG-1", url: "https://linear.app/acme/issue/ENG-1", kind: "commented", actor: null, at: "2026-10-11T02:00:00Z", lastLine: null },
    ]);
    expect(JSON.stringify(outcome)).not.toContain("Secret rationale");
  });

  it("gives no alias for an actor whose email and display name are blank, and none for the account id", async () => {
    const blank = [{ id: "u-ghost", email: "", displayName: "" }];
    const history = [entry("h1", { actor: "u-ghost", fromState: "started", toState: "completed" })];
    const { read } = await setup({ users: blank, issues: [issue("ENG-1", { history, assignee: null, creator: null })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions).toEqual([{ kind: "closed", actor: "u-ghost", at: "2026-10-11T00:00:00Z", id: "linear:history:h1" }]);
  });

  it("sees a reply made after since to a comment made before it", async () => {
    const comments = [comment("c1", { createdAt: "2026-09-01T00:00:00Z" }), comment("c2", { parent: "c1", createdAt: "2026-10-11T00:00:00Z" })];
    const { read } = await setup({ issues: [issue("ENG-1", { comments })] });
    expect((await read(["ENG-1"])).events.map((e) => e.id)).toEqual(["linear:comment:c2"]);
  });

  it("filters by since, keeping a comment exactly at it", async () => {
    const comments = [comment("old", { createdAt: "2026-10-09T23:59:59Z" }), comment("edge", { createdAt: SINCE })];
    const { read } = await setup({ issues: [issue("ENG-1", { comments })] });
    expect((await read(["ENG-1"])).events.map((e) => e.id)).toEqual(["linear:comment:edge"]);
  });

  it("reads all the replies of a thread longer than the inline page", async () => {
    const replies = Array.from({ length: 70 }, (_, n) => comment(`r${n}`, { parent: "c1", createdAt: new Date(Date.UTC(2026, 9, 11, 0, n)).toISOString() }));
    const { read, mounted } = await setup({ issues: [issue("ENG-1", { comments: [comment("c1", { createdAt: "2026-09-01T00:00:00Z" }), ...replies] })] });
    expect((await read(["ENG-1"])).events).toHaveLength(70);
    expect(queries(mounted).some((q) => q.includes("CommentReplies"))).toBe(true);
  });

  it("reads no comments of an item that is not watched", async () => {
    const { read, mounted } = await setup({ issues: [issue("ENG-1", { comments: [comment("c1")] })] });
    const outcome = await read(["ENG-1"], {}, []);
    expect(outcome.events).toEqual([]);
    expect(queries(mounted).some((q) => q.includes("IssueComments"))).toBe(false);
  });

  it("reads state only: no events, no updated listing", async () => {
    const { read, mounted } = await setup({ issues: [issue("ENG-1", { comments: [comment("c1")], updatedAt: "2026-10-11T00:00:00Z" })] });
    const outcome = await read(["ENG-1"], { stateOnly: true, scanPartition: true });
    expect(outcome.snapshots).toHaveLength(1);
    expect(outcome.events).toEqual([]);
    expect(outcome.updated).toEqual([]);
    expect(queries(mounted).every((q) => q.includes("IssueRead"))).toBe(true);
  });

  it("pages through more comments than one page holds", async () => {
    const comments = Array.from({ length: 120 }, (_, n) => comment(`c${n}`));
    const { read } = await setup({ issues: [issue("ENG-1", { comments })] });
    expect((await read(["ENG-1"])).events).toHaveLength(120);
  });
});

describe("the partition scan", () => {
  const scanned = (extra: Partial<LinearIssue>) => issue("ENG-9", { labels: ["spec"], ...extra });

  it("returns open issues of the operator's partition carrying the spec or ready label, as snapshots with no events", async () => {
    const issues = [
      issue("ENG-1", { labels: ["spec"] }),
      issue("ENG-2", { labels: ["READY"], assignee: null, creator: "u-dana", comments: [comment("c1")] }),
      issue("ENG-3", { labels: ["spec"], state: "completed" }),
      issue("ENG-4", { labels: ["spec"], assignee: "u-eli", creator: "u-eli" }),
      issue("ENG-5", { labels: ["spec"], assignee: "u-eli", creator: "u-dana" }),
      issue("ENG-6", { labels: ["bug"] }),
      issue("ENG-7", { labels: [] }),
      issue("OPS-1", { labels: ["spec"], team: "OPS" }),
    ];
    const { read } = await setup({ issues });
    const outcome = await read([], { scanPartition: true });
    expect(outcome.snapshots.map((s) => s.ref).sort()).toEqual(["ENG-1", "ENG-2"]);
    expect(outcome.snapshots.every((s) => s.inPartition)).toBe(true);
    expect(outcome.events).toEqual([]);
  });

  it("does not list an issue twice when the watched set holds it", async () => {
    const { read } = await setup({ issues: [scanned({})] });
    const outcome = await read(["ENG-9"], { scanPartition: true });
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["ENG-9"]);
  });

  it("finds a partition item whose operator is named by display name or id", async () => {
    const id = "6d1f3a52-0c1b-4f0e-9a52-1d2f7e8b9c10";
    const { read } = await setup({ users: [{ id, email: "dana@acme.test", displayName: "dana" }], issues: [scanned({ assignee: id, creator: id })] });
    expect((await read([], { scanPartition: true, operator: "DANA" })).snapshots).toHaveLength(1);
    expect((await read([], { scanPartition: true, operator: id.toUpperCase() })).snapshots).toHaveLength(1);
  });

  it("scans nothing unless asked", async () => {
    const { read } = await setup({ issues: [scanned({})] });
    expect((await read([])).snapshots).toEqual([]);
  });

  it("reports a scan item's transitions too", async () => {
    const { read } = await setup({ issues: [scanned({ history: [entry("h1", { addedLabels: ["spec"] })] })] });
    expect((await read([], { scanPartition: true })).snapshots[0]!.transitions).toHaveLength(1);
  });
});

describe("the updated listing", () => {
  it("lists the team's issues updated since, with their urls and times, whatever the order", async () => {
    const issues = [
      issue("ENG-1", { updatedAt: "2026-10-09T00:00:00Z" }),
      issue("ENG-2", { updatedAt: "2026-10-11T00:00:00Z", url: "https://linear.app/acme/issue/ENG-2" }),
      issue("ENG-3", { updatedAt: SINCE }),
      issue("OPS-1", { updatedAt: "2026-10-11T00:00:00Z", team: "OPS" }),
    ];
    const { read } = await setup({ issues });
    const outcome = await read([]);
    expect(outcome.updated.map((u) => u.ref).sort()).toEqual(["ENG-2", "ENG-3"]);
    expect(outcome.updated.find((u) => u.ref === "ENG-2")).toEqual({ role: "tracker", ref: "ENG-2", url: "https://linear.app/acme/issue/ENG-2", at: "2026-10-11T00:00:00Z" });
  });

  it("pages through a listing longer than one page", async () => {
    const issues = Array.from({ length: 130 }, (_, n) => issue(`ENG-${n + 1}`, { updatedAt: "2026-10-11T00:00:00Z" }));
    const { read } = await setup({ issues });
    const outcome = await read([]);
    expect(outcome.updated).toHaveLength(130);
    expect(outcome.failures).toEqual([]);
  });

  it("reports a listing cut off after 20 pages of 50 as a failure with no ref, keeping what it read", async () => {
    const issues = Array.from({ length: 1001 }, (_, n) => issue(`ENG-${n + 1}`, { updatedAt: "2026-10-11T00:00:00Z" }));
    const { read } = await setup({ issues });
    const outcome = await read([]);
    expect(outcome.updated).toHaveLength(1000);
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.stringContaining("cut off") }]);
  });
});

describe("a read that fails", () => {
  it("gives a failure and no snapshot or events for an issue answered without its state, and still reads the others", async () => {
    const { read } = await setup({ issues: [issue("ENG-1", { omit: ["state"], comments: [comment("c1")] }), issue("ENG-2")] });
    const outcome = await read(["ENG-1", "ENG-2"]);
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["ENG-2"]);
    expect(outcome.events).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "ENG-1", reason: expect.stringContaining("state") }]);
  });

  it.each(["assignee", "history"])("gives a failure for an issue answered without its %s", async (field) => {
    const { read } = await setup({ issues: [issue("ENG-1", { omit: [field] })] });
    const outcome = await read(["ENG-1"]);
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "ENG-1", reason: expect.stringContaining(field) }]);
  });

  it("gives a failure for an issue that is not found, without the service's words", async () => {
    const { read } = await setup({ issues: [issue("ENG-2")] });
    const outcome = await read(["ENG-1", "ENG-2"]);
    expect(outcome.snapshots.map((s) => s.ref)).toEqual(["ENG-2"]);
    expect(outcome.failures).toEqual([{ ref: "ENG-1", reason: expect.any(String), kind: "not-found" }]);
    expect(outcome.failures[0]!.reason).not.toMatch(/Entity not found|INVALID_INPUT/);
  });

  it("refuses a ref that is not an identifier without sending a request", async () => {
    const { read, mounted } = await setup({ issues: [] });
    const outcome = await read(["#12", "ENG-1) { id } mutation"], { stateOnly: true });
    expect(outcome.failures.map((f) => f.ref)).toEqual(["#12", "ENG-1) { id } mutation"]);
    expect(mounted.requests).toHaveLength(0);
  });

  it("gives a failure for a history entry without its id", async () => {
    const { read, fake } = await setup({ issues: [issue("ENG-1", { history: [entry("h1")] })] });
    const state = fake.getState() as LinearState;
    delete (state.issues[0]!.history[0] as Partial<LinearHistory>).id;
    const outcome = await read(["ENG-1"]);
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures).toHaveLength(1);
  });

  it("gives a failure for a history cut off after 20 pages", async () => {
    const history = Array.from({ length: 1001 }, (_, n) => entry(`h${n}`, { addedLabels: ["bug"] }));
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    const outcome = await read(["ENG-1"]);
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures).toEqual([{ ref: "ENG-1", reason: expect.stringContaining("cut off") }]);
  });

  it("reads a history longer than one page whole", async () => {
    const history = [...Array.from({ length: 120 }, (_, n) => entry(`h${n}`, { createdAt: "2026-09-01T00:00:00Z" })), entry("late", { addedLabels: ["spec"] })];
    const { read } = await setup({ issues: [issue("ENG-1", { history })] });
    expect((await read(["ENG-1"])).snapshots[0]!.transitions.map((t) => t.id)).toEqual(["linear:history:late:labelled:spec"]);
  });

  it("rethrows a refused credential answered as HTTP 401", async () => {
    const { read } = await setup({ issues: [issue("ENG-1")], unauthenticated: true });
    await expect(read(["ENG-1"])).rejects.toMatchObject({ name: "HttpError", kind: "auth" });
  });

  it("rethrows an authentication error answered inside a GraphQL response, with no text from the service", async () => {
    const { read } = await setup({ issues: [issue("ENG-1")], authenticationError: true });
    const failure = await read(["ENG-1"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ kind: "auth" });
    expect((failure as HttpError).message).not.toContain("Authentication required");
    expect((failure as HttpError).message).not.toContain(TOKEN);
  });

  it("fails the item, not the read, where the HTTP layer reports it forbidden (403)", async () => {
    const forbidden: HttpSession = {
      service: "linear",
      baseUrl: "http://127.0.0.1:1/graphql",
      request: async (): Promise<HttpResponse> => {
        throw new HttpError("forbidden", "POST / answered 403", 403);
      },
      paginate: async () => ({ items: [], truncated: false }),
      drainRequests: () => [],
      expiresAt: () => null,
      noteExpiresAt: () => undefined,
    };
    const { read } = await setup({ issues: [] });
    const outcome = await read(["ENG-1"], { http: forbidden });
    expect(outcome.snapshots).toEqual([]);
    expect(outcome.failures).toContainEqual({ ref: "ENG-1", reason: expect.any(String) });
  });

  it("rethrows a rate-limit error found in a GraphQL response", async () => {
    const limited: HttpSession = {
      service: "linear",
      baseUrl: "http://127.0.0.1:1/graphql",
      request: async (): Promise<HttpResponse> => ({ status: 200, json: { errors: [{ message: "x", extensions: { code: "RATELIMITED" } }] }, notModified: false, header: () => null }),
      paginate: async () => ({ items: [], truncated: false }),
      drainRequests: () => [],
      expiresAt: () => null,
      noteExpiresAt: () => undefined,
    };
    const { read } = await setup({ issues: [] });
    await expect(read(["ENG-1"], { http: limited })).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("gives a listing failure, not a throw, for the documented HTTP 400 rate-limit answer the HTTP layer reports as a client error", async () => {
    const { read } = await setup({ issues: [], rateLimited: true });
    const outcome = await read([]);
    expect(outcome.failures.every((f) => f.ref === null)).toBe(true);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it("puts no token and no text from the service in a failure's reason", async () => {
    const { read } = await setup({ issues: [issue("ENG-1", { omit: ["state"] })] });
    const outcome = await read(["ENG-1", "ENG-2"]);
    expect(JSON.stringify(outcome.failures)).not.toContain(TOKEN);
    expect(JSON.stringify(outcome.failures)).not.toContain("Entity not found");
  });

  it("refuses a source that is not Linear's", async () => {
    const { read } = await setup({ issues: [] });
    await expect(read([], { source: { role: "tracker", service: "jira", site: "x.atlassian.net", project: "P" } })).rejects.toThrow("another service");
  });

  it("stops when the read is aborted", async () => {
    const { read } = await setup({ issues: [issue("ENG-1")] });
    const controller = new AbortController();
    controller.abort();
    await expect(read(["ENG-1"], { signal: controller.signal })).rejects.toBeDefined();
  });
});

describe("the requests it sends", () => {
  it("sends only GraphQL queries, as POSTs, and never a mutation", async () => {
    const { read, mounted } = await setup({ issues: [issue("ENG-1", { labels: ["spec"], comments: [comment("c1")], updatedAt: "2026-10-11T00:00:00Z" })] });
    await read(["ENG-1"], { scanPartition: true });
    expect(mounted.requests.length).toBeGreaterThan(0);
    for (const request of mounted.requests) {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/graphql");
      expect(request.hasAuthorization).toBe(true);
    }
    for (const query of queries(mounted)) {
      expect(query.trimStart().startsWith("query ")).toBe(true);
      expect(query).not.toMatch(/\b(mutation|subscription)\b/);
    }
  });

  it("makes no conditional request on a repeat read, since the GraphQL endpoint documents none", async () => {
    const { read, headersSeen } = await setup({ issues: [issue("ENG-1")] });
    await read(["ENG-1"]);
    await read(["ENG-1"]);
    expect(headersSeen.length).toBeGreaterThan(2);
    expect(headersSeen.every((seen) => seen.headers["if-none-match"] === undefined)).toBe(true);
  });

  it("sends the key as is, with no Bearer", async () => {
    const { read, headersSeen } = await setup({ issues: [issue("ENG-1")] });
    await read(["ENG-1"]);
    expect(headersSeen[0]!.headers.authorization).toBe(TOKEN);
  });

  it("records every request as counted", async () => {
    const { read, http } = await setup({ issues: [issue("ENG-1")] });
    await read(["ENG-1"]);
    const records = http.drainRequests();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.counted)).toBe(true);
  });
});

describe("the fake, driven over HTTP", () => {
  it("loads state through /__admin/state, reads it back, and the adapter reads what was loaded", async () => {
    const { read, mounted } = await setup({ issues: [] });
    const loaded: LinearState = { users, issues: [issue("ENG-7", { labels: ["spec"] })] };
    await fetch(`${mounted.url}/__admin/state`, { method: "POST", body: JSON.stringify(loaded) });
    const back = await (await fetch(`${mounted.url}/__admin/state`)).json();
    expect(back).toEqual(loaded);
    expect((await read(["ENG-7"])).snapshots[0]).toMatchObject({ ref: "ENG-7", fleetLabels: ["spec"] });
    const logged = (await (await fetch(`${mounted.url}/__admin/requests`)).json()) as { method: string }[];
    expect(logged.every((request) => request.method === "POST")).toBe(true);
  });
});
