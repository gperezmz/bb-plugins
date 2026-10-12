import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { createFakeGithub } from "../../../test/fakes/github";
import { createFakeGitlab } from "../../../test/fakes/gitlab";
import { createFakeJira } from "../../../test/fakes/jira";
import { createFakeLinear } from "../../../test/fakes/linear";
import { listen, type FakeService, type Mounted } from "../../../test/fakes/listen";
import type { ProbeTarget } from "../application/ports";
import type { Half } from "../domain/accounts";
import { HttpClient } from "./http";
import { HttpServiceProbe } from "./probe";

const mounted: Mounted[] = [];
afterEach(async () => {
  await Promise.all(mounted.splice(0).map((one) => one.close()));
});

const probe = new HttpServiceProbe(new HttpClient({ sleep: async () => undefined, timeoutMs: 2_000 }));

/** Mounts `fake` and names it as a probe target, the API root under `prefix`. */
const mount = async (fake: FakeService, service: ProbeTarget["service"], prefix: string): Promise<{ server: Mounted; target: ProbeTarget }> => {
  const server = await listen(fake);
  mounted.push(server);
  return { server, target: { service, baseUrl: `${server.url}${prefix}`, host: "127.0.0.1" } };
};

const repoHalf = (path: string): Half => ({ role: "forge", subject: { kind: "repo", host: "127.0.0.1", path: path.split("/") }, service: null, place: "127.0.0.1", scope: path, owner: path.split("/")[0]!, what: path });
const linearHalf = (team: string): Half => ({ role: "tracker", subject: { kind: "linear", team }, service: "linear", place: "linear.app", scope: team, owner: null, what: `team ${team}` });
const jiraHalf = (project: string): Half => ({ role: "tracker", subject: { kind: "jira", site: "acme.atlassian.net", project }, service: "jira", place: "acme.atlassian.net", scope: project, owner: null, what: project });

const paths = (server: Mounted): string[] => server.requests.map((request) => `${request.method} ${request.url.split("?")[0]}`);

describe("HttpServiceProbe: GitHub", () => {
  const repos = { "acme/api": { issues: [], comments: [], reviewComments: [], reviews: [], events: [], checkRuns: [], statuses: [] } };

  it("names the login the token belongs to, from GET /user on the target alone", async () => {
    const { server, target } = await mount(createFakeGithub({ repos, logins: { "tok-yuser": "yuser" } }), "github", "/api/v3");
    expect(await probe.identify(target, "tok-yuser")).toMatchObject({ ok: true, login: "yuser", name: "yuser" });
    expect(paths(server)).toEqual(["GET /api/v3/user"]);
  });

  it("tells a classic token, which answers X-OAuth-Scopes, from a fine-grained one", async () => {
    const { target } = await mount(createFakeGithub({ logins: { classic: "yuser", fine: "yuser" }, tokens: { classic: { classic: true } } }), "github", "/api/v3");
    expect(await probe.identify(target, "classic")).toMatchObject({ ok: true, classic: true });
    expect(await probe.identify(target, "fine")).toMatchObject({ ok: true, classic: false });
  });

  it("reads the expiry from the token-expiration header, and none where it is absent", async () => {
    const { target } = await mount(createFakeGithub({ logins: { expiring: "yuser", forever: "yuser" }, tokens: { expiring: { expiration: "2026-11-12 00:00:00 UTC" } } }), "github", "/api/v3");
    expect(await probe.identify(target, "expiring")).toMatchObject({ ok: true, expiresAt: "2026-11-12T00:00:00.000Z" });
    expect(await probe.identify(target, "forever")).toMatchObject({ ok: true, expiresAt: null });
  });

  it("answers refused for a token the service rejects with 401", async () => {
    const { target } = await mount(createFakeGithub({ logins: { good: "yuser" } }), "github", "/api/v3");
    expect(await probe.identify(target, "bad")).toMatchObject({ ok: false, why: "refused" });
  });

  it("answers readable for a repository the token reaches, not-found for one it does not, forbidden for a 403", async () => {
    const { server, target } = await mount(createFakeGithub({ repos, faults: [{ pathIncludes: "/repos/acme/locked", status: 403 }] }), "github", "/api/v3");
    expect(await probe.canRead(target, "tok", repoHalf("acme/api"))).toBe("readable");
    expect(await probe.canRead(target, "tok", repoHalf("acme/missing"))).toBe("not-found");
    expect(await probe.canRead(target, "tok", repoHalf("acme/locked"))).toBe("forbidden");
    expect(paths(server)).toEqual(["GET /api/v3/repos/acme/api", "GET /api/v3/repos/acme/missing", "GET /api/v3/repos/acme/locked"]);
  });
});

describe("HttpServiceProbe: GitLab", () => {
  const projects = { "group/infra": { issues: [], mergeRequests: [] } };

  it("names the username, and the expiry from /personal_access_tokens/self as the start of that day in UTC", async () => {
    const { server, target } = await mount(createFakeGitlab({ projects, logins: { "glpat-yuser": "yuser" }, token: { expires_at: "2026-12-01" } }), "gitlab", "/api/v4");
    expect(await probe.identify(target, "glpat-yuser")).toEqual({ ok: true, login: "yuser", name: "yuser", expiresAt: "2026-12-01T00:00:00.000Z", classic: false });
    expect(paths(server)).toEqual(["GET /api/v4/user", "GET /api/v4/personal_access_tokens/self"]);
  });

  it("reports no expiry for a token the self endpoint does not know, and for one that does not expire", async () => {
    const other = await mount(createFakeGitlab({ projects, token: null }), "gitlab", "/api/v4");
    expect(await probe.identify(other.target, "tok")).toMatchObject({ ok: true, login: "operator", expiresAt: null });
    const forever = await mount(createFakeGitlab({ projects, token: { expires_at: null } }), "gitlab", "/api/v4");
    expect(await probe.identify(forever.target, "tok")).toMatchObject({ ok: true, expiresAt: null });
  });

  it("answers refused for a 401", async () => {
    const { server, target } = await mount(createFakeGitlab({ projects, logins: { good: "yuser" } }), "gitlab", "/api/v4");
    expect(await probe.identify(target, "bad")).toMatchObject({ ok: false, why: "refused" });
    expect(paths(server)).toEqual(["GET /api/v4/user"]);
  });

  it("answers readable, not-found and forbidden for a project by its URL-encoded path", async () => {
    const { server, target } = await mount(createFakeGitlab({ projects, faults: [{ match: "group/locked", status: 403 }] }), "gitlab", "/api/v4");
    expect(await probe.canRead(target, "tok", repoHalf("group/infra"))).toBe("readable");
    expect(await probe.canRead(target, "tok", repoHalf("group/missing"))).toBe("not-found");
    expect(await probe.canRead(target, "tok", repoHalf("group/locked"))).toBe("forbidden");
    expect(paths(server)).toEqual(["GET /api/v4/projects/group%2Finfra", "GET /api/v4/projects/group%2Fmissing", "GET /api/v4/projects/group%2Flocked"]);
  });
});

describe("HttpServiceProbe: Linear", () => {
  const issue = { identifier: "ENG-1", state: "started", labels: [], assignee: null, creator: null, updatedAt: "2026-10-10T00:00:00Z", history: [], comments: [] };

  it("names the viewer's id as the login and their email as the name", async () => {
    const users = [{ id: "u-1", email: "yuser@acme.example", displayName: "Y User" }];
    const { server, target } = await mount(createFakeLinear({ users, logins: { "lin_api_y": "u-1" } }), "linear", "/graphql");
    expect(await probe.identify(target, "lin_api_y")).toEqual({ ok: true, login: "u-1", name: "yuser@acme.example", expiresAt: null, classic: false });
    expect(paths(server)).toEqual(["POST /graphql"]);
  });

  it("answers refused for a key the service rejects with 401", async () => {
    const { target } = await mount(createFakeLinear({ logins: { good: "u-1" } }), "linear", "/graphql");
    expect(await probe.identify(target, "bad")).toMatchObject({ ok: false, why: "refused" });
  });

  it("answers readable for a team the key reaches and not-found for one the workspace holds none of", async () => {
    const { target } = await mount(createFakeLinear({ issues: [issue as never] }), "linear", "/graphql");
    expect(await probe.canRead(target, "tok", linearHalf("ENG"))).toBe("readable");
    expect(await probe.canRead(target, "tok", linearHalf("OPS"))).toBe("not-found");
  });
});

describe("HttpServiceProbe: Jira", () => {
  it("names the account id as the login and the email as the name", async () => {
    const users = [{ accountId: "acc-1", emailAddress: "ops@acme.com", displayName: "Ops" }];
    const { server, target } = await mount(createFakeJira({ users, logins: { "ops@acme.com:api-token": "acc-1" } }), "jira", "");
    expect(await probe.identify(target, "ops@acme.com:api-token")).toEqual({ ok: true, login: "acc-1", name: "ops@acme.com", expiresAt: null, classic: false });
    expect(paths(server)).toEqual(["GET /rest/api/3/myself"]);
  });

  it("falls back to the email in the token where Jira hides it", async () => {
    const users = [{ accountId: "acc-1", emailAddress: null, displayName: "Ops" }];
    const { target } = await mount(createFakeJira({ users, logins: { "ops@acme.com:t": "acc-1" } }), "jira", "");
    expect(await probe.identify(target, "ops@acme.com:t")).toMatchObject({ ok: true, name: "ops@acme.com" });
  });

  it("answers refused for a token the service rejects with 401", async () => {
    const { target } = await mount(createFakeJira({ logins: { "a:good": "acc-1" } }), "jira", "");
    expect(await probe.identify(target, "a:bad")).toMatchObject({ ok: false, why: "refused" });
  });

  it("answers readable for a project the site holds, not-found for one it does not, forbidden for a 403", async () => {
    const { server, target } = await mount(createFakeJira({ projects: ["OPS"], settings: { pageSize: null, etag: false, alsoListed: [], failures: [{ pathContains: "/project/LOCKED", status: 403 }] } }), "jira", "");
    expect(await probe.canRead(target, "a:t", jiraHalf("OPS"))).toBe("readable");
    expect(await probe.canRead(target, "a:t", jiraHalf("NOPE"))).toBe("not-found");
    expect(await probe.canRead(target, "a:t", jiraHalf("LOCKED"))).toBe("forbidden");
    expect(paths(server)).toEqual(["GET /rest/api/3/project/OPS", "GET /rest/api/3/project/NOPE", "GET /rest/api/3/project/LOCKED"]);
  });
});

describe("HttpServiceProbe: no answer", () => {
  /** A loopback port nothing listens on. */
  const closedPort = (): Promise<number> =>
    new Promise((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });

  it("answers unreachable for identify and canRead where nothing answers, for every service", async () => {
    const port = await closedPort();
    const base = `http://127.0.0.1:${port}`;
    const targets: [ProbeTarget, Half][] = [
      [{ service: "github", baseUrl: `${base}/api/v3`, host: "127.0.0.1" }, repoHalf("acme/api")],
      [{ service: "gitlab", baseUrl: `${base}/api/v4`, host: "127.0.0.1" }, repoHalf("group/infra")],
      [{ service: "linear", baseUrl: `${base}/graphql`, host: "127.0.0.1" }, linearHalf("ENG")],
      [{ service: "jira", baseUrl: base, host: "127.0.0.1" }, jiraHalf("OPS")],
    ];
    for (const [target, half] of targets) {
      expect(await probe.identify(target, "tok")).toMatchObject({ ok: false, why: "unreachable" });
      expect(await probe.canRead(target, "tok", half)).toBe("unreachable");
    }
  });
});

describe("HttpServiceProbe: where a token goes", () => {
  it("sends every request to the target's host and port, and the other mounted services see none", async () => {
    const github = await mount(createFakeGithub({ repos: { "acme/api": { issues: [], comments: [], reviewComments: [], reviews: [], events: [], checkRuns: [], statuses: [] } } }), "github", "/api/v3");
    const gitlab = await mount(createFakeGitlab({ projects: { "group/infra": { issues: [], mergeRequests: [] } } }), "gitlab", "/api/v4");
    const linear = await mount(createFakeLinear({}), "linear", "/graphql");
    const jira = await mount(createFakeJira({ projects: ["OPS"] }), "jira", "");

    await probe.identify(github.target, "t");
    await probe.canRead(github.target, "t", repoHalf("acme/api"));
    expect([github.server.requests.length, gitlab.server.requests.length, linear.server.requests.length, jira.server.requests.length]).toEqual([2, 0, 0, 0]);

    await probe.identify(gitlab.target, "t");
    await probe.canRead(gitlab.target, "t", repoHalf("group/infra"));
    await probe.identify(linear.target, "t");
    await probe.canRead(linear.target, "t", linearHalf("ENG"));
    await probe.identify(jira.target, "a:t");
    await probe.canRead(jira.target, "a:t", jiraHalf("OPS"));
    expect([github.server.requests.length, gitlab.server.requests.length, linear.server.requests.length, jira.server.requests.length]).toEqual([2, 3, 2, 2]);
  });

  it("does not follow a redirect to another host", async () => {
    const elsewhere = await listen({ handle: () => false, setState: () => undefined, getState: () => null });
    mounted.push(elsewhere);
    const redirector: FakeService = {
      handle(_request, _body, response) {
        response.writeHead(302, { location: `${elsewhere.url}/user` });
        response.end();
        return true;
      },
      setState: () => undefined,
      getState: () => null,
    };
    const { target } = await mount(redirector, "github", "/api/v3");
    const answer = await probe.identify(target, "secret-token");
    expect(answer.ok).toBe(false);
    expect(elsewhere.requests).toEqual([]);
  });
});
