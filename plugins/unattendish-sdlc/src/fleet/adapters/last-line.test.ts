// The four service adapters turn one comment body into one `lastLine`.
import { afterEach, describe, expect, it } from "vitest";
import { createFakeGithub } from "../../../test/fakes/github";
import { createFakeGitlab } from "../../../test/fakes/gitlab";
import { createFakeJira, jiraTime } from "../../../test/fakes/jira";
import { createFakeLinear } from "../../../test/fakes/linear";
import { listen, type FakeService, type Mounted } from "../../../test/fakes/listen";
import type { ReadRequest, ResolvedCredential, ServiceAdapter } from "../application/ports";
import type { ReadOutcome, WatchedItem } from "../domain/model";
import { createGithubAdapter } from "./github";
import { createGitlabAdapter } from "./gitlab";
import { HttpClient } from "./http";
import { createJiraAdapter } from "./jira";
import { createLinearAdapter } from "./linear";

const SINCE = "2026-10-10T00:00:00Z";
const AFTER = "2026-10-11T00:00:00Z";
const LABELS = { spec: "spec", ready: "ready", inProgress: "in progress", needsInput: "needs input" };
const MARKER = "> <kbd>🤖 unattendish agent</kbd>";

const mounts: Mounted[] = [];
afterEach(async () => {
  await Promise.all(mounts.splice(0).map((mounted) => mounted.close()));
});

/** A service, and a read of one watched item carrying a single comment with the given body. */
interface Service {
  readonly name: string;
  readonly read: (body: string) => Promise<ReadOutcome>;
}

const session = async (fake: FakeService, credential: Omit<ResolvedCredential, "baseUrl" | "host">, path: string, secret: string) => {
  const mounted = await listen(fake);
  mounts.push(mounted);
  return new HttpClient({ sleep: async () => undefined }).session({ ...credential, baseUrl: `${mounted.url}${path}`, host: "127.0.0.1" }, secret);
};

const request = (adapter: ServiceAdapter, over: Pick<ReadRequest, "source" | "http" | "operator"> & { ref: string; role: WatchedItem["role"] }): Promise<ReadOutcome> =>
  adapter.read({
    source: over.source,
    http: over.http,
    items: [{ role: over.role, ref: over.ref, url: null }],
    watchedRefs: new Set([over.ref]),
    labels: LABELS,
    operator: over.operator,
    since: SINCE,
    scanPartition: false,
    stateOnly: false,
    signal: new AbortController().signal,
  });

const services: Service[] = [
  {
    name: "GitHub",
    read: async (body) => {
      const issue = { number: 1, state: "open" as const, labels: [], assignees: [], creator: "someone", createdAt: SINCE, updatedAt: AFTER };
      const comment = { id: 1, issue: 1, user: "pat", body, createdAt: AFTER, updatedAt: AFTER };
      const fake = createFakeGithub({ repos: { "org/repo": { issues: [issue], comments: [comment], reviewComments: [], reviews: [], events: [], checkRuns: [], statuses: [] } } });
      const http = await session(fake, { key: "github.com/org", label: "github.com/org", accountId: "account", accountLabel: "github.com/org", kind: "fine-grained", service: "github", auth: "token" }, "/api/v3", "ghp_secret");
      return request(createGithubAdapter(), { source: { role: "forge", service: "github", host: "127.0.0.1", path: "org/repo" }, http, operator: "olivia", ref: "#1", role: "forge" });
    },
  },
  {
    name: "GitLab",
    read: async (body) => {
      const item = { iid: 1, state: "opened" as const, author: "olga", updated_at: AFTER, notes: [{ id: 1, author: "pat", body, created_at: AFTER }] };
      const fake = createFakeGitlab({ projects: { "org/repo": { issues: [item], mergeRequests: [] } } });
      const http = await session(fake, { key: "gitlab.com/org", label: "gitlab.com/org", accountId: "account", accountLabel: "gitlab.com/org", kind: "fine-grained", service: "gitlab", auth: "token" }, "/api/v4", "glpat-secretsecretsecret");
      return request(createGitlabAdapter(), { source: { role: "forge", service: "gitlab", host: "gitlab.com", path: "org/repo" }, http, operator: "olga", ref: "#1", role: "forge" });
    },
  },
  {
    name: "Linear",
    read: async (body) => {
      const users = [{ id: "u-dana", email: "dana@acme.test", displayName: "dana" }];
      const issue = {
        identifier: "ENG-1",
        state: "started",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: AFTER,
        labels: [],
        assignee: "u-dana",
        creator: "u-dana",
        history: [],
        comments: [{ id: "c1", createdAt: AFTER, user: "u-dana", body }],
      };
      const http = await session(createFakeLinear({ users, issues: [issue] }), { key: "linear:ENG", label: "linear:ENG", accountId: "account", accountLabel: "linear:ENG", kind: "fine-grained", service: "linear", auth: "token" }, "/graphql", "lin_api_secretsecret");
      return request(createLinearAdapter(), { source: { role: "tracker", service: "linear", team: "ENG" }, http, operator: "dana@acme.test", ref: "ENG-1", role: "tracker" });
    },
  },
  {
    name: "Jira",
    read: async (body) => {
      const users = [{ accountId: "acc-other", emailAddress: null, displayName: "Otto Other" }];
      const created = jiraTime(new Date(AFTER));
      // One paragraph holding the body as written: the adapter, not the fake, finds the lines in it.
      const adf = { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] };
      const issue = { id: "100", key: "PROJ-1", status: "10000", labels: [], assignee: null, creator: "acc-other", updated: created, summary: "A title", comments: [{ id: "1", author: "acc-other", created, body: adf }] };
      const fake = createFakeJira({ users, issues: [issue] });
      const http = await session(fake, { key: "example.atlassian.net/PROJ", label: "example.atlassian.net/PROJ", accountId: "account", accountLabel: "example.atlassian.net/PROJ", kind: "fine-grained", service: "jira", auth: "token" }, "", "me@example.com:token");
      return request(createJiraAdapter(), { source: { role: "tracker", service: "jira", site: "example.atlassian.net", project: "PROJ" }, http, operator: "acc-operator", ref: "PROJ-1", role: "tracker" });
    },
  },
];

const bodies: [string, string, string | null][] = [
  ["trailing blank lines", "first\nsecond  \n\n  \n\n", "second"],
  ["a bare carriage return", "first\rsecond\r\r", "second"],
  ["CRLF line ends", "first\r\nsecond\r\n\r\n", "second"],
  ["a quote-reply with the marker above the answer", `${MARKER}\r\n\r\nGo with option B\n`, "Go with option B"],
  ["the marker as the last line", `Verdict: ship\n\n${MARKER}\n`, MARKER],
  ["a surrogate pair at the cut", `${"y".repeat(499)}😀😀\n`, `${"y".repeat(499)}😀`],
  ["a line of exactly 500 code points", `top\n${"z".repeat(500)}`, "z".repeat(500)],
];

describe.each(services)("the $name adapter's lastLine", ({ read }) => {
  it.each(bodies)("is the domain's for %s", async (_what, body, expected) => {
    const { events, failures } = await read(body);
    expect(failures).toEqual([]);
    expect(events.map((event) => event.lastLine)).toEqual([expected]);
  });
});
