import { afterEach, describe, expect, it } from "vitest";
import { createFakeJira, DEFAULT_STATUSES, jiraTime, type FakeJiraComment, type FakeJiraHistory, type FakeJiraIssue, type FakeJiraState } from "../../../test/fakes/jira";
import { listen, type Mounted } from "../../../test/fakes/listen";
import type { ReadRequest } from "../application/ports";
import { HttpError, type ResolvedCredential } from "../application/ports";
import type { FleetLabels, ReadOutcome } from "../domain/model";
import { HttpClient } from "./http";
import { createJiraAdapter } from "./jira";

const SITE = "example.atlassian.net";
const LABELS: FleetLabels = { spec: "Spec", ready: "Ready", inProgress: "In-Progress", needsInput: "Needs-Input" };
const OPERATOR = "acc-operator";
const TODO = "10000";
const PROGRESS = "10001";
const DONE = "10002";

/** A minute on the test's clock, as a number of minutes from `BASE`; `BASE` is an hour ago, on a whole minute. */
const BASE = Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000;
const at = (minutes: number, seconds = 0): string => jiraTime(new Date(BASE + minutes * 60_000 + seconds * 1000));
const iso = (minutes: number, seconds = 0): string => new Date(BASE + minutes * 60_000 + seconds * 1000).toISOString();

const USERS = [
  { accountId: OPERATOR, emailAddress: "op@example.com", displayName: "Olivia Operator" },
  { accountId: "acc-other", emailAddress: null, displayName: "Otto Other" },
  { accountId: "acc-bot", emailAddress: null, displayName: "Fleet Bot" },
];

let n = 100;
const issue = (key: string, over: Partial<FakeJiraIssue> = {}): FakeJiraIssue => ({
  id: String(n++),
  key,
  status: TODO,
  labels: [],
  assignee: null,
  creator: "acc-other",
  updated: at(-90),
  summary: "A title written on the service",
  ...over,
});
const note = (id: string, text: string, minutes = 5, author: string | null = "acc-other"): FakeJiraComment => ({ id, author, created: at(minutes), text });
const change = (id: string, minutes: number, items: FakeJiraHistory["items"], author: string | null = "acc-other"): FakeJiraHistory => ({ id, author, created: at(minutes), items });
const labelChange = (from: string, to: string): FakeJiraHistory["items"] => [{ field: "labels", from: null, fromString: from, to: null, toString: to }];
const statusChange = (from: string, fromString: string, to: string, toString: string): FakeJiraHistory["items"] => [{ field: "status", from, fromString, to, toString }];

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ version: 1, type: "doc", content });

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
});

const world = async (state: Partial<FakeJiraState>) => {
  const fake = createFakeJira({ users: USERS, ...state });
  mounted = await listen(fake);
  const live = mounted;
  const credential: ResolvedCredential = { prefix: `${SITE}/PROJ`, service: "jira", auth: "token", baseUrl: live.url, host: "127.0.0.1" };
  const session = new HttpClient({ sleep: async () => undefined }).session(credential, "me@example.com:token");
  const read = (over: Partial<ReadRequest> = {}): Promise<ReadOutcome> =>
    createJiraAdapter().read({
      source: { role: "tracker", service: "jira", site: SITE, project: "PROJ" },
      http: session,
      items: [],
      watchedRefs: new Set(),
      labels: LABELS,
      operator: OPERATOR,
      since: iso(0),
      scanPartition: false,
      stateOnly: false,
      signal: new AbortController().signal,
      ...over,
    });
  const watch = (...refs: string[]) => ({ items: refs.map((ref) => ({ role: "tracker" as const, ref, url: null })), watchedRefs: new Set(refs) });
  return { fake, live, read, watch, session };
};

const searches = (live: Mounted): URLSearchParams[] =>
  live.requests.filter((request) => request.url.includes("/search/jql")).map((request) => new URL(request.url, "http://x").searchParams);

describe("the Jira adapter's snapshot of an issue", () => {
  it("reads an open issue: its page, state, registered labels as registered, and no checks", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { labels: ["spec", "bug", "NEEDS-INPUT"] })] });
    const out = await read(watch("PROJ-1"));
    expect(out.failures).toEqual([]);
    expect(out.snapshots).toEqual([
      { role: "tracker", ref: "PROJ-1", url: `https://${SITE}/browse/PROJ-1`, open: true, merged: false, fleetLabels: ["Spec", "Needs-Input"], inPartition: false, transitions: [] },
    ]);
  });

  it("calls an issue whose status is in the done category closed, and never merged", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { status: DONE }), issue("PROJ-2", { status: PROGRESS })] });
    const out = await read(watch("PROJ-1", "PROJ-2"));
    expect(out.snapshots.map((s) => [s.ref, s.open, s.merged])).toEqual([["PROJ-1", false, false], ["PROJ-2", true, false]]);
  });

  it("puts an issue in the partition when assigned to the operator, or filed by them and assigned to nobody", async () => {
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", { assignee: OPERATOR }),
        issue("PROJ-2", { creator: OPERATOR }),
        issue("PROJ-3", { creator: OPERATOR, assignee: "acc-other" }),
        issue("PROJ-4", { creator: "acc-other", assignee: "acc-other" }),
        issue("PROJ-5", { creator: "acc-other", assignee: null }),
      ],
    });
    const out = await read(watch("PROJ-1", "PROJ-2", "PROJ-3", "PROJ-4", "PROJ-5"));
    expect(out.snapshots.map((s) => [s.ref, s.inPartition])).toEqual([["PROJ-1", true], ["PROJ-2", true], ["PROJ-3", false], ["PROJ-4", false], ["PROJ-5", false]]);
  });

  it("matches the operator against the account id or the email address, ignoring case", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { assignee: OPERATOR })] });
    expect((await read({ ...watch("PROJ-1"), operator: "OP@Example.com" })).snapshots[0]!.inPartition).toBe(true);
    expect((await read({ ...watch("PROJ-1"), operator: "ACC-OPERATOR" })).snapshots[0]!.inPartition).toBe(true);
    expect((await read({ ...watch("PROJ-1"), operator: "someone@example.com" })).snapshots[0]!.inPartition).toBe(false);
  });

  it("asks only for REST v3 paths", async () => {
    const { read, watch, live } = await world({ issues: [issue("PROJ-1")] });
    expect((await read(watch("PROJ-1"))).snapshots).toHaveLength(1);
    expect(live.requests.every((request) => request.url.startsWith("/rest/api/3/"))).toBe(true);
  });
});

describe("the Jira adapter's transitions", () => {
  it("reports a close and a reopen from status changes, by the category of the status, with actor, the actor's email address, UTC time and id", async () => {
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", {
          status: TODO,
          changelog: [
            change("201", 10, statusChange(TODO, "To Do", PROGRESS, "In Progress")),
            change("202", 20, statusChange(PROGRESS, "In Progress", DONE, "Done"), OPERATOR),
            change("203", 30, statusChange(DONE, "Done", TODO, "To Do"), "acc-bot"),
          ],
        }),
      ],
    });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots[0]!.transitions).toEqual([
      { kind: "closed", actor: OPERATOR, actorAliases: ["op@example.com"], at: iso(20), id: "jira:changelog:202:closed" },
      { kind: "reopened", actor: "acc-bot", at: iso(30), id: "jira:changelog:203:reopened" },
    ]);
  });

  it("gives a teammate who shares an echo actor's display name no alias that echo actor is registered under", async () => {
    const twins = [
      { accountId: "acc-bot", emailAddress: "bot@example.com", displayName: "Fleet Bot" },
      { accountId: "acc-mate", emailAddress: "mate@example.com", displayName: "Fleet Bot" },
    ];
    const { read, watch } = await world({
      users: twins,
      issues: [issue("PROJ-1", { changelog: [change("220", 10, statusChange(TODO, "To Do", DONE, "Done"), "acc-mate")], comments: [note("1", "hi", 5, "acc-mate")] })],
    });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots[0]!.transitions[0]).toMatchObject({ actor: "acc-mate", actorAliases: ["mate@example.com"] });
    expect(out.events[0]).toMatchObject({ actor: "acc-mate", actorAliases: ["mate@example.com"] });
    expect(JSON.stringify(out)).not.toContain("Fleet Bot");
  });

  it("reads a time written with another offset as the same instant in UTC", async () => {
    const offset = new Date(BASE + 5 * 60_000).toISOString().replace("Z", "+0200").replace(/T(\d\d)/, (_, hour: string) => `T${String((Number(hour) + 2) % 24).padStart(2, "0")}`);
    const { read, watch } = await world({
      issues: [issue("PROJ-1", { changelog: [{ id: "210", author: "acc-other", created: offset, items: labelChange("", "Ready") }] })],
    });
    expect((await read(watch("PROJ-1"))).snapshots[0]!.transitions[0]!.at).toBe(iso(5));
  });

  it("reports a label added or removed from the difference of the space-separated lists, only for the four registered, as registered", async () => {
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", {
          labels: ["Ready"],
          changelog: [
            change("301", 5, labelChange("bug", "bug spec ready urgent")),
            change("302", 6, labelChange("bug spec ready urgent", "bug ready in-progress")),
            change("303", 7, labelChange("bug", "bug urgent")),
          ],
        }),
      ],
    });
    const transitions = (await read(watch("PROJ-1"))).snapshots[0]!.transitions;
    expect(transitions.map((t) => [t.kind, t.label, t.at, t.id])).toEqual([
      ["labelled", "Spec", iso(5), "jira:changelog:301:labelled:spec"],
      ["labelled", "Ready", iso(5), "jira:changelog:301:labelled:ready"],
      ["unlabelled", "Spec", iso(6), "jira:changelog:302:unlabelled:spec"],
      ["labelled", "In-Progress", iso(6), "jira:changelog:302:labelled:in-progress"],
    ]);
  });

  it("reports one close, not two, for a move from one done status to another", async () => {
    const statuses = [...DEFAULT_STATUSES, { id: "10003", name: "Won't Do", category: "done" as const }];
    const { read, watch } = await world({
      statuses,
      issues: [
        issue("PROJ-1", {
          status: "10003",
          changelog: [change("221", 10, statusChange(PROGRESS, "In Progress", DONE, "Done")), change("222", 20, statusChange(DONE, "Done", "10003", "Won't Do"))],
        }),
      ],
    });
    expect((await read(watch("PROJ-1"))).snapshots[0]!.transitions.map((t) => [t.kind, t.id])).toEqual([["closed", "jira:changelog:221:closed"]]);
  });

  it("reports nothing for a status change inside one category, a change of another field, or a change before since", async () => {
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", {
          changelog: [
            change("401", -30, labelChange("", "Ready")),
            change("402", 5, statusChange(TODO, "To Do", PROGRESS, "In Progress")),
            change("403", 6, [{ field: "summary", from: null, fromString: "a", to: null, toString: "b" }]),
          ],
        }),
      ],
    });
    expect((await read(watch("PROJ-1"))).snapshots[0]!.transitions).toEqual([]);
  });

  it("keeps a change made at exactly since and one with no author, whose actor is null", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { changelog: [change("501", 0, labelChange("", "Spec"), null)] })] });
    expect((await read(watch("PROJ-1"))).snapshots[0]!.transitions).toMatchObject([{ kind: "labelled", label: "Spec", actor: null }]);
  });

  it("falls back to the status names when a status id is not on the site's list", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { changelog: [change("601", 5, statusChange("999", "In Progress", "998", "Done"))] })] });
    expect((await read(watch("PROJ-1"))).snapshots[0]!.transitions).toMatchObject([{ kind: "closed" }]);
  });

  it("fails the item, with no snapshot, when a status change names a status the site does not list", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { changelog: [change("602", 5, statusChange("999", "Mystery", "998", "Unknown"))] }), issue("PROJ-2")] });
    const out = await read(watch("PROJ-1", "PROJ-2"));
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-2"]);
    expect(out.failures).toEqual([{ ref: "PROJ-1", reason: "a status change names a status the site's status list does not hold" }]);
  });

  it("reads the whole changelog from its own pages when the issue's inline page holds only the newest 100", async () => {
    const histories = Array.from({ length: 130 }, (_, i) => change(String(700 + i), i < 125 ? -200 + i : 10 + i - 125, labelChange("", "Ready"), "acc-other"));
    const { read, watch, live } = await world({ issues: [issue("PROJ-1", { changelog: histories })] });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots[0]!.transitions.map((t) => t.id)).toEqual(Array.from({ length: 5 }, (_, i) => `jira:changelog:${825 + i}:labelled:ready`));
    expect(live.requests.filter((request) => request.url.includes("/changelog"))).toHaveLength(2);
  });

  it("fails the item when its changelog runs to more than ten pages", async () => {
    const histories = Array.from({ length: 25 }, (_, i) => change(String(900 + i), 5, labelChange("", "Ready")));
    const { read, watch } = await world({ issues: [issue("PROJ-1", { changelog: histories })], settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots).toEqual([]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]!.ref).toBe("PROJ-1");
  });
});

describe("the Jira adapter's events", () => {
  it("turns a watched item's comments at or after since into events, oldest first, never carrying the body", async () => {
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", {
          comments: [
            note("1001", "too old", -5),
            note("1002", "first line\nthe answer", 0),
            { id: "1003", author: OPERATOR, created: at(7), text: "later" },
            note("1004", "no author", 8, null),
          ],
        }),
      ],
    });
    const out = await read(watch("PROJ-1"));
    expect(out.failures).toEqual([]);
    expect(out.events).toEqual([
      { id: "jira:comment:1002", role: "tracker", ref: "PROJ-1", url: `https://${SITE}/browse/PROJ-1`, kind: "commented", actor: "acc-other", at: iso(0), lastLine: "the answer" },
      { id: "jira:comment:1003", role: "tracker", ref: "PROJ-1", url: `https://${SITE}/browse/PROJ-1`, kind: "commented", actor: OPERATOR, actorAliases: ["op@example.com"], at: iso(7), lastLine: "later" },
      { id: "jira:comment:1004", role: "tracker", ref: "PROJ-1", url: `https://${SITE}/browse/PROJ-1`, kind: "commented", actor: null, at: iso(8), lastLine: "no author" },
    ]);
  });

  it("reads no comments of an item that is read for its state only", async () => {
    const { read, live } = await world({ issues: [issue("PROJ-1", { comments: [note("1", "hello")] })] });
    const out = await read({ items: [{ role: "tracker", ref: "PROJ-1", url: null }] });
    expect(out.snapshots).toHaveLength(1);
    expect(out.events).toEqual([]);
    expect(live.requests.some((request) => request.url.includes("/comment"))).toBe(false);
  });

  it("reads nothing but state, and lists nothing, when stateOnly", async () => {
    const { read, watch, live } = await world({ issues: [issue("PROJ-1", { comments: [note("1", "hello")], updated: at(3) })] });
    const out = await read({ ...watch("PROJ-1"), stateOnly: true, scanPartition: true });
    expect(out.snapshots).toHaveLength(1);
    expect(out.events).toEqual([]);
    expect(out.updated).toEqual([]);
    expect(searches(live)).toEqual([]);
  });

  it("takes the last non-blank line of the rendered text: past trailing blanks, a quote-reply's answer below the marker, and hard breaks", async () => {
    const marker = "<kbd>🤖 unattendish agent</kbd>";
    const { read, watch } = await world({
      issues: [
        issue("PROJ-1", {
          comments: [
            { id: "1", author: "acc-other", created: at(1), body: doc(paragraph(text("a")), paragraph(text("b")), { type: "paragraph", content: [] }, paragraph(text("   "))) },
            { id: "2", author: "acc-other", created: at(2), body: doc({ type: "blockquote", content: [paragraph(text("park")), paragraph(text(marker))] }, paragraph(text("my answer"))) },
            { id: "3", author: "acc-other", created: at(3), body: doc(paragraph(text("above"), { type: "hardBreak" }, text("below"), { type: "hardBreak" })) },
            { id: "4", author: "acc-other", created: at(4), body: doc(paragraph(text("a park ends with the marker")), paragraph(text(`  ${marker}  `))) },
            { id: "5", author: "acc-other", created: at(5), body: doc(paragraph(text("hello "), { type: "mention", attrs: { id: "u1", text: "@Casey" } })) },
            { id: "6", author: "acc-other", created: at(6), body: doc({ type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("one"))] }, { type: "listItem", content: [paragraph(text("two"))] }] }) },
            { id: "7", author: "acc-other", created: at(7), body: doc() },
            { id: "8", author: "acc-other", created: at(8), body: doc(paragraph(text("x".repeat(600)))) },
          ],
        }),
      ],
    });
    const lines = Object.fromEntries((await read(watch("PROJ-1"))).events.map((event) => [event.id.replace("jira:comment:", ""), event.lastLine]));
    expect(lines).toEqual({ 1: "b", 2: "my answer", 3: "below", 4: marker, 5: "hello @Casey", 6: "two", 7: null, 8: "x".repeat(500) });
  });

  it("carries nothing written on the service: no title, no comment body beyond its last line, no display name", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { assignee: OPERATOR, comments: [note("1", "FIRST LINE OF THE BODY\nlast words")] })] });
    // `actorAliases` hold an email address, for matching registered echo actors; the application never sends them.
    const serialised = JSON.stringify(await read(watch("PROJ-1")), (key, value: unknown) => (key === "actorAliases" ? undefined : value));
    expect(serialised).toContain("last words");
    for (const secret of ["A title written on the service", "FIRST LINE OF THE BODY", "Olivia Operator", "Otto Other", "op@example.com"]) expect(serialised).not.toContain(secret);
  });
});

describe("the Jira adapter's partition scan", () => {
  const scanState = (): Partial<FakeJiraState> => ({
    issues: [
      issue("PROJ-1", { labels: ["spec"], assignee: OPERATOR }),
      issue("PROJ-2", { labels: ["Ready"], creator: OPERATOR }),
      issue("PROJ-3", { labels: ["spec"], assignee: "acc-other", creator: OPERATOR }),
      issue("PROJ-4", { labels: ["spec"], assignee: OPERATOR, status: DONE }),
      issue("PROJ-5", { labels: ["bug"], assignee: OPERATOR }),
      issue("PROJ-6", { labels: [], creator: OPERATOR }),
      issue("OTHER-1", { labels: ["spec"], assignee: OPERATOR }),
      issue("PROJ-7", { labels: ["spec", "ready"], assignee: OPERATOR, changelog: [change("1", 5, labelChange("spec", "spec ready"))] }),
    ],
  });

  it("lists open spec- and ready-labelled issues the operator holds or filed unassigned, with state and no events", async () => {
    const { read } = await world(scanState());
    const out = await read({ scanPartition: true });
    expect(out.failures).toEqual([]);
    expect(out.snapshots.map((s) => [s.ref, s.inPartition, s.open])).toEqual([["PROJ-1", true, true], ["PROJ-2", true, true], ["PROJ-7", true, true]]);
    expect(out.snapshots[2]).toMatchObject({ fleetLabels: ["Spec", "Ready"], transitions: [{ kind: "labelled", label: "Ready", actor: "acc-other" }] });
    expect(out.events).toEqual([]);
  });

  it("returns an item once when it is also among the items, and keeps that item's events", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { labels: ["spec"], assignee: OPERATOR, comments: [note("1", "hi")] })] });
    const out = await read({ ...watch("PROJ-1"), scanPartition: true });
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-1"]);
    expect(out.events).toHaveLength(1);
  });

  it("scans only when asked", async () => {
    const { read, live } = await world(scanState());
    expect((await read({ scanPartition: false })).snapshots).toEqual([]);
    expect(searches(live).some((query) => (query.get("jql") ?? "").includes("labels"))).toBe(false);
  });

  it("asks the service for the operator by the name it was registered under, quoted", async () => {
    const { read, live } = await world(scanState());
    await read({ scanPartition: true, operator: 'op"erator' });
    expect(searches(live).find((query) => (query.get("jql") ?? "").includes("labels"))!.get("jql")).toContain('assignee = "op\\"erator"');
  });

  it("marks a scanned item as in the partition by the service's own match, even when the operator is a name the answer does not show", async () => {
    const hidden = [{ accountId: OPERATOR, emailAddress: null, hiddenEmail: "op@example.com", displayName: "Olivia Operator" }, ...USERS.slice(1)];
    const { read } = await world({ users: hidden, issues: [issue("PROJ-1", { labels: ["spec"], assignee: OPERATOR })] });
    const out = await read({ scanPartition: true, operator: "op@example.com" });
    expect(out.snapshots.map((s) => [s.ref, s.inPartition])).toEqual([["PROJ-1", true]]);
  });

  it("reports a partition listing cut off after ten pages, with what it listed", async () => {
    const issues = Array.from({ length: 30 }, (_, i) => issue(`PROJ-${i + 1}`, { labels: ["spec"], assignee: OPERATOR, updated: at(-90 + i) }));
    const { read } = await world({ issues, settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read({ scanPartition: true });
    expect(out.snapshots).toHaveLength(20);
    expect(out.failures).toContainEqual({ ref: null, reason: "the partition listing runs to more than 10 pages of 100" });
  });
});

describe("the Jira adapter's updated listing", () => {
  it("lists the project's issues updated at or after since, by key and update time, cutting inside the minute the service rounds to", async () => {
    const { read, live } = await world({
      issues: [
        issue("PROJ-1", { updated: at(-90) }),
        issue("PROJ-2", { updated: at(0, 10) }),
        issue("PROJ-3", { updated: at(0, 40) }),
        issue("PROJ-4", { updated: at(12) }),
        issue("OTHER-1", { updated: at(12) }),
      ],
    });
    const out = await read({ since: iso(0, 30) });
    expect(out.updated).toEqual([
      { role: "tracker", ref: "PROJ-3", url: `https://${SITE}/browse/PROJ-3`, at: iso(0, 40) },
      { role: "tracker", ref: "PROJ-4", url: `https://${SITE}/browse/PROJ-4`, at: iso(12) },
    ]);
    const jql = searches(live)[0]!.get("jql")!;
    expect(jql).toMatch(/^project = "PROJ" AND updated >= "-\d+m" ORDER BY updated ASC$/);
  });

  it("asks for a relative time wide enough to cover since, whatever zone the searching user is set to", async () => {
    const { read, live } = await world({ issues: [] });
    await read({ since: iso(0) });
    const minutes = Number(/-(\d+)m/.exec(searches(live)[0]!.get("jql")!)![1]);
    expect(minutes).toBeGreaterThanOrEqual(60);
    expect(minutes).toBeLessThan(70);
  });

  it("pages through the listing by token", async () => {
    const issues = Array.from({ length: 7 }, (_, i) => issue(`PROJ-${i + 1}`, { updated: at(i + 1) }));
    const { read, live } = await world({ issues, settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read();
    expect(out.updated.map((u) => u.ref)).toEqual(issues.map((i) => i.key));
    expect(searches(live)).toHaveLength(4);
    expect(searches(live)[1]!.get("nextPageToken")).not.toBeNull();
  });

  describe("an updated listing cut off after ten pages", () => {
    const paged = { pageSize: 2, etag: false, alsoListed: [], failures: [] };
    const thirty = () => Array.from({ length: 30 }, (_, i) => issue(`PROJ-${i + 1}`, { updated: at(i + 1) }));

    it("returns what it listed and where it stopped, with no failure, and the next poll goes on from there", async () => {
      const { read } = await world({ issues: thirty(), settings: paged });
      const first = await read();
      expect(first.failures).toEqual([]);
      expect(first.updated).toHaveLength(20);
      expect(first.updated[0]!.ref).toBe("PROJ-1");
      expect(first.listingCutAt).toBe(iso(20));

      const second = await read({ since: first.listingCutAt });
      expect(second.failures).toEqual([]);
      expect(second.listingCutAt).toBeUndefined();
      expect(second.updated.map((u) => u.ref)).toEqual(Array.from({ length: 11 }, (_, i) => `PROJ-${20 + i}`));
    });

    it("is a failure with no ref where the last issue it listed does not move the cursor", async () => {
      const same = Array.from({ length: 25 }, (_, i) => issue(`PROJ-${i + 1}`, { updated: at(5) }));
      const { read } = await world({ issues: same, settings: paged });
      const out = await read({ since: iso(5) });
      expect(out.listingCutAt).toBeUndefined();
      expect(out.failures).toEqual([{ ref: null, reason: "the updated listing runs to more than 10 pages of 100" }]);
    });

    it("is a failure with no ref where the service did not list oldest first", async () => {
      const { read } = await world({ issues: thirty(), settings: { ...paged, unordered: true } });
      const out = await read();
      expect(out.listingCutAt).toBeUndefined();
      expect(out.updated).toHaveLength(20);
      expect(out.failures).toEqual([{ ref: null, reason: "the updated listing runs to more than 10 pages of 100" }]);
    });

    it("leaves listingCutAt unset where the listing fits", async () => {
      const { read } = await world({ issues: thirty().slice(0, 20), settings: paged });
      const out = await read();
      expect(out.updated).toHaveLength(20);
      expect(out.listingCutAt).toBeUndefined();
    });
  });

  it("reports a listing that fails with no ref, and still returns the items it read", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1")], settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/search/jql", status: 500 }] } });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots).toHaveLength(1);
    expect(out.failures).toEqual([{ ref: null, reason: "GET /rest/api/3/search/jql answered 500", kind: "unreachable" }]);
  });
});

describe("the Jira adapter's fleet boundary", () => {
  const issuePaths = (live: Mounted): string[] => live.requests.map((request) => new URL(request.url, "http://x").pathname).filter((path) => path.includes("/issue/"));

  it("refuses an old key that now answers an issue of another project, reading nothing more of it", async () => {
    const { read, watch, live } = await world({
      issues: [issue("OTHER-3", { formerKeys: ["PROJ-12"], labels: ["spec"], assignee: OPERATOR, comments: [note("1", "text")] }), issue("PROJ-2")],
    });
    const out = await read(watch("PROJ-12", "PROJ-2"));
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-2"]);
    expect(out.events).toEqual([]);
    expect(out.failures).toEqual([{ ref: "PROJ-12", reason: "moved outside the fleet", kind: "outside-fleet" }]);
    expect(issuePaths(live).filter((path) => path.includes("PROJ-12"))).toEqual(["/rest/api/3/issue/PROJ-12"]);
  });

  it("refuses a key of another project given in the items", async () => {
    const { read, watch } = await world({ issues: [issue("OTHER-3")] });
    const out = await read(watch("OTHER-3"));
    expect(out.snapshots).toEqual([]);
    expect(out.failures).toEqual([{ ref: "OTHER-3", reason: "moved outside the fleet", kind: "outside-fleet" }]);
  });

  it("reads an old key of another project that now answers an issue of the fleet's, under the ref it was named by", async () => {
    const { read, watch } = await world({ issues: [issue("proj-5", { formerKeys: ["OTHER-1"] })] });
    const out = await read(watch("OTHER-1"));
    expect(out.failures).toEqual([]);
    expect(out.snapshots).toMatchObject([{ ref: "OTHER-1", url: `https://${SITE}/browse/proj-5` }]);
  });

  it("refuses a scan hit and an updated hit that belong to another project, without reading them", async () => {
    const { read, live } = await world({
      issues: [issue("PROJ-1", { labels: ["spec"], assignee: OPERATOR, updated: at(5) }), issue("OTHER-9", { labels: ["spec"], assignee: OPERATOR, updated: at(5) })],
      settings: { pageSize: null, etag: false, alsoListed: ["OTHER-9"], failures: [] },
    });
    const out = await read({ scanPartition: true });
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-1"]);
    expect(out.updated.map((u) => u.ref)).toEqual(["PROJ-1"]);
    expect(out.failures).toEqual([
      { ref: "OTHER-9", reason: "listed outside the fleet", kind: "outside-fleet" },
      { ref: "OTHER-9", reason: "listed outside the fleet", kind: "outside-fleet" },
    ]);
    expect(issuePaths(live).some((path) => path.includes("OTHER-9"))).toBe(false);
  });
});

describe("the Jira adapter's failures", () => {
  it("reports an issue answered without its status as a failure with no snapshot, naming no text from the service", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { omit: ["status"], comments: [note("1", "x")] }), issue("PROJ-2")] });
    const out = await read(watch("PROJ-1", "PROJ-2"));
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-2"]);
    expect(out.events).toEqual([]);
    expect(out.failures).toEqual([{ ref: "PROJ-1", reason: "answer is not of the documented shape at fields.status" }]);
  });

  it.each(["labels", "assignee", "creator"])("reports an issue answered without its %s as a failure", async (field) => {
    const { read, watch } = await world({ issues: [issue("PROJ-1", { omit: [field] })] });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots).toEqual([]);
    expect(out.failures).toMatchObject([{ ref: "PROJ-1" }]);
  });

  it("reports a comment that is not an Atlassian Document as a failure of its item, with no event and no snapshot", async () => {
    const { read, watch } = await world({
      issues: [issue("PROJ-1", { comments: [{ id: "1", author: "acc-other", created: at(2), body: "just a string" }, note("2", "fine", 3)] })],
    });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.failures).toMatchObject([{ ref: "PROJ-1" }]);
  });

  it("reports an item that is not found as a failure and reads the rest", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-2")] });
    const out = await read(watch("PROJ-1", "PROJ-2"));
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-2"]);
    expect(out.failures).toEqual([{ ref: "PROJ-1", reason: "GET /rest/api/3/issue/PROJ-1 answered 404", kind: "not-found" }]);
  });

  it("rethrows a refused credential and a rate limit unchanged, ending the whole read", async () => {
    const refused = await world({ issues: [issue("PROJ-1")], settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/issue/PROJ-1", status: 401 }] } });
    await expect(refused.read(refused.watch("PROJ-1"))).rejects.toMatchObject({ name: "HttpError", kind: "auth" });
    await mounted?.close();
    const limited = await world({ issues: [issue("PROJ-1")], settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/issue/PROJ-1", status: 429, headers: { "retry-after": "120" } }] } });
    const error = await limited.read(limited.watch("PROJ-1")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ kind: "rate-limit", retryAfterMs: 120_000 });
  });

  it("rethrows a refused credential met while listing", async () => {
    const { read } = await world({ settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/search/jql", status: 401 }] } });
    await expect(read()).rejects.toMatchObject({ kind: "auth" });
  });

  it("reports a listing the token may not read (403) as a listing failure, not as a refused credential", async () => {
    const { read } = await world({ settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/search/jql", status: 403 }] } });
    const outcome = await read();
    expect(outcome.failures).toEqual([{ ref: null, reason: expect.any(String), kind: "forbidden" }]);
  });

  it("gives the kind forbidden to an item the token may not read (403), and unreachable to one met with a 5xx", async () => {
    const { read, watch } = await world({
      issues: [issue("PROJ-1"), issue("PROJ-2"), issue("PROJ-3")],
      settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/issue/PROJ-1", status: 403 }, { pathContains: "/issue/PROJ-2", status: 503 }] },
    });
    const out = await read(watch("PROJ-1", "PROJ-2", "PROJ-3"));
    expect(out.snapshots.map((s) => s.ref)).toEqual(["PROJ-3"]);
    expect(out.failures).toEqual([
      { ref: "PROJ-1", reason: expect.any(String), kind: "forbidden" },
      { ref: "PROJ-2", reason: expect.any(String), kind: "unreachable" },
    ]);
  });

  it("gives the kind unreachable to a listing met with a 5xx", async () => {
    const { read } = await world({ settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/search/jql", status: 500 }] } });
    expect((await read()).failures).toContainEqual({ ref: null, reason: expect.any(String), kind: "unreachable" });
  });

  it("ends the read when it is aborted, rather than reporting every item failed", async () => {
    const { read, watch } = await world({ issues: [issue("PROJ-1")] });
    const controller = new AbortController();
    controller.abort();
    await expect(read({ ...watch("PROJ-1"), signal: controller.signal })).rejects.toBeDefined();
  });

  it("reports a source that is not a Jira project as a failure of the listing", async () => {
    const { read } = await world({});
    const out = await read({ source: { role: "tracker", service: "linear", team: "ENG" } });
    expect(out.failures).toEqual([{ ref: null, reason: "the source is not a Jira project" }]);
  });
});

describe("the Jira adapter's pagination", () => {
  it("pages through a long comment list and reads every comment since", async () => {
    const comments = Array.from({ length: 5 }, (_, i) => note(String(i + 1), `comment ${i + 1}`, i + 1));
    const { read, watch, live } = await world({ issues: [issue("PROJ-1", { comments })], settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read(watch("PROJ-1"));
    expect(out.events.map((e) => e.lastLine)).toEqual(["comment 1", "comment 2", "comment 3", "comment 4", "comment 5"]);
    expect(live.requests.filter((request) => request.url.includes("/comment"))).toHaveLength(3);
  });

  it("stops reading comments at the first page that reaches one older than since", async () => {
    const comments = [note("1", "old", -30), note("2", "old", -20), note("3", "old", -10), note("4", "new", 5), note("5", "new", 6)];
    const { read, watch, live } = await world({ issues: [issue("PROJ-1", { comments })], settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read(watch("PROJ-1"));
    expect(out.events.map((e) => e.lastLine)).toEqual(["new", "new"]);
    expect(live.requests.filter((request) => request.url.includes("/comment"))).toHaveLength(2);
  });

  it("fails the item when its comments run to more than ten pages", async () => {
    const comments = Array.from({ length: 25 }, (_, i) => note(String(i + 1), "c", 1 + i / 100));
    const { read, watch } = await world({ issues: [issue("PROJ-1", { comments })], settings: { pageSize: 2, etag: false, alsoListed: [], failures: [] } });
    const out = await read(watch("PROJ-1"));
    expect(out.snapshots).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.failures).toEqual([{ ref: "PROJ-1", reason: "the comments on PROJ-1 run to more than 10 pages of 100" }]);
  });
});

describe("the Jira adapter's requests", () => {
  it("sends nothing but GETs on the REST v3 API, with the credential", async () => {
    const { read, watch, live } = await world({ issues: [issue("PROJ-1", { labels: ["spec"], assignee: OPERATOR, comments: [note("1", "x")], changelog: [change("1", 5, statusChange(TODO, "To Do", DONE, "Done"))] })] });
    await read({ ...watch("PROJ-1"), scanPartition: true });
    expect(live.requests.length).toBeGreaterThan(3);
    expect(live.requests.every((request) => request.method === "GET" && request.hasAuthorization && request.url.startsWith("/rest/api/3/"))).toBe(true);
  });

  it("repeats a read conditionally where the service answers an ETag, and still returns the same snapshot", async () => {
    const statuses: number[] = [];
    const wrapped: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      statuses.push(response.status);
      return response;
    };
    const fake = createFakeJira({ users: USERS, issues: [issue("PROJ-1", { labels: ["spec"] })], settings: { pageSize: null, etag: true, alsoListed: [], failures: [] } });
    mounted = await listen(fake);
    const credential: ResolvedCredential = { prefix: `${SITE}/PROJ`, service: "jira", auth: "token", baseUrl: mounted.url, host: "127.0.0.1" };
    const session = new HttpClient({ fetch: wrapped, sleep: async () => undefined }).session(credential, "me@example.com:token");
    const request = (): ReadRequest => ({
      source: { role: "tracker", service: "jira", site: SITE, project: "PROJ" },
      http: session,
      items: [{ role: "tracker", ref: "PROJ-1", url: null }],
      watchedRefs: new Set(["PROJ-1"]),
      labels: LABELS,
      operator: OPERATOR,
      since: iso(0),
      scanPartition: false,
      stateOnly: true,
      signal: new AbortController().signal,
    });
    const first = await createJiraAdapter().read(request());
    expect(statuses).toEqual([200]);
    const second = await createJiraAdapter().read(request());
    expect(statuses).toEqual([200, 304]);
    expect(second).toEqual(first);
  });
});

describe("the fake Jira service, for the drive harness", () => {
  it("loads its state over /__admin/state, reads it back, and serves what was loaded", async () => {
    const fake = createFakeJira();
    mounted = await listen(fake);
    const state = { users: USERS, issues: [issue("PROJ-9", { labels: ["ready"], assignee: OPERATOR })] };
    await fetch(`${mounted.url}/__admin/state`, { method: "POST", body: JSON.stringify(state) });
    const back = (await (await fetch(`${mounted.url}/__admin/state`)).json()) as FakeJiraState;
    expect(back.issues).toEqual(state.issues);
    expect(back.statuses.map((status) => status.id)).toEqual([TODO, PROGRESS, DONE]);
    const credential: ResolvedCredential = { prefix: `${SITE}/PROJ`, service: "jira", auth: "token", baseUrl: `${mounted.url}/jira-prefix`, host: "127.0.0.1" };
    const session = new HttpClient({ sleep: async () => undefined }).session(credential, "me@example.com:token");
    const out = await createJiraAdapter().read({
      source: { role: "tracker", service: "jira", site: SITE, project: "PROJ" },
      http: session,
      items: [],
      watchedRefs: new Set(),
      labels: LABELS,
      operator: OPERATOR,
      since: iso(0),
      scanPartition: true,
      stateOnly: false,
      signal: new AbortController().signal,
    });
    expect(out.snapshots.map((s) => [s.ref, s.fleetLabels])).toEqual([["PROJ-9", ["Ready"]]]);
    const logged = (await (await fetch(`${mounted.url}/__admin/requests`)).json()) as { method: string; url: string }[];
    expect(logged.map((request) => request.method)).toEqual(["GET", "GET", "GET"]);
    expect(logged[0]!.url.startsWith("/jira-prefix/rest/api/3/")).toBe(true);
  });

  it("answers a write with 405 and a query it cannot parse with 400", async () => {
    mounted = await listen(createFakeJira({ issues: [issue("PROJ-1")] }));
    const headers = { authorization: "Basic x" };
    expect((await fetch(`${mounted.url}/rest/api/3/issue/PROJ-1`, { method: "PUT", headers, body: "{}" })).status).toBe(405);
    expect((await fetch(`${mounted.url}/rest/api/3/search/jql?jql=${encodeURIComponent("nonsense ((")}`, { headers })).status).toBe(400);
    expect((await fetch(`${mounted.url}/rest/api/3/issue/PROJ-1`)).status).toBe(401);
  });
});
