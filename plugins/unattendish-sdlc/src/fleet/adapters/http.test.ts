import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError, type ResolvedCredential } from "../application/ports";
import { expiryOf, graphqlWrites, HttpClient } from "./http";

const TOKEN = "ghp_secretsecretsecret";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server | undefined;
afterEach(() => server?.close());

const serve = async (handler: (request: Seen, response: ServerResponse) => void) => {
  const seen: Seen[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString() };
      seen.push(entry);
      handler(entry, response);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const credential = (service: ResolvedCredential["service"] = "github"): ResolvedCredential => ({
    key: "github.com/org",
    label: "github.com/org",
    accountId: "account",
    accountLabel: "github.com/org",
    kind: "fine-grained",
    service,
    auth: "token",
    baseUrl: `http://127.0.0.1:${port}/api`,
    host: "127.0.0.1",
  });
  return { seen, port, credential };
};

const client = (extra: { fetch?: typeof fetch } = {}) => new HttpClient({ sleep: async () => undefined, ...extra });
const json = (response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

describe("HttpClient", () => {
  it("sends the token to the credential's host as a bearer, with the service's accept header", async () => {
    const { seen, credential } = await serve((_, response) => json(response, { ok: true }));
    const session = client().session(credential(), TOKEN);
    await session.request({ method: "GET", path: "/issues/1", query: { state: "all" } });
    expect(seen[0]!.url).toBe("/api/issues/1?state=all");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.headers.accept).toBe("application/vnd.github+json");
  });

  it("sends a Linear key as is and a Jira email:token as Basic", async () => {
    const { seen, credential } = await serve((_, response) => json(response, {}));
    await client().session(credential("linear"), "lin_api_x").request({ method: "GET", path: "/" });
    await client().session(credential("jira"), "me@example.com:tok").request({ method: "GET", path: "/" });
    expect(seen[0]!.headers.authorization).toBe("lin_api_x");
    expect(seen[1]!.headers.authorization).toBe(`Basic ${Buffer.from("me@example.com:tok").toString("base64")}`);
  });

  it("refuses an absolute URL on another host before any request leaves", async () => {
    const { seen, credential } = await serve((_, response) => json(response, {}));
    const session = client().session(credential(), TOKEN);
    await expect(session.request({ method: "GET", path: "https://example.net/x" })).rejects.toMatchObject({ kind: "outside-host" });
    expect(seen).toHaveLength(0);
  });

  it("does not follow a redirect to another host, and does not send the token there", async () => {
    const { seen, credential } = await serve((_, response) => {
      response.writeHead(302, { location: "http://localhost:1/x" });
      response.end();
    });
    const session = client().session(credential(), TOKEN);
    await expect(session.request({ method: "GET", path: "/a" })).rejects.toMatchObject({ kind: "outside-host" });
    expect(seen).toHaveLength(1);
  });

  describe("plain http off loopback", () => {
    const remote: ResolvedCredential = { key: "gitlab.example.com", label: "gitlab.example.com", accountId: "account", accountLabel: "gitlab.example.com", kind: "fine-grained", service: "gitlab", auth: "token", baseUrl: "https://gitlab.example.com/api/v4", host: "gitlab.example.com" };
    const reply = (status: number, headers: Record<string, string>) => async () => new Response("[]", { status, headers });

    it("refuses an absolute http URL on the credential's host before any request leaves", async () => {
      const fetched: string[] = [];
      const http = client({ fetch: async (url) => (fetched.push(String(url)), new Response("{}")) });
      await expect(http.session(remote, TOKEN).request({ method: "GET", path: "http://gitlab.example.com/api/v4/x" })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual([]);
    });

    it("does not follow a redirect to plain http on the credential's host, and does not resend the token", async () => {
      const fetched: string[] = [];
      const http = client({ fetch: async (url) => (fetched.push(String(url)), new Response(null, { status: 302, headers: { location: "http://gitlab.example.com/api/v4/y" } })) });
      await expect(http.session(remote, TOKEN).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual(["https://gitlab.example.com/api/v4/x"]);
    });

    it("refuses a next link to plain http on the credential's host", async () => {
      const http = client({ fetch: reply(200, { link: '<http://gitlab.example.com/api/v4/x?page=2>; rel="next"' }) });
      await expect(http.session(remote, TOKEN).paginate({ path: "/x" }, { maxPages: 5 })).rejects.toMatchObject({ kind: "outside-host" });
    });

    it("follows a redirect to https on the credential's host", async () => {
      let calls = 0;
      const http = client({ fetch: async () => (calls += 1) === 1 ? new Response(null, { status: 301, headers: { location: "/api/v4/y" } }) : new Response("{}") });
      await expect(http.session(remote, TOKEN).request({ method: "GET", path: "/x" })).resolves.toMatchObject({ status: 200 });
    });
  });

  describe("a host that only looks like the credential's", () => {
    const github: ResolvedCredential = { key: "github.com/org", label: "github.com/org", accountId: "account", accountLabel: "github.com/org", kind: "fine-grained", service: "github", auth: "token", baseUrl: "https://api.github.com", host: "api.github.com" };
    const fetching = (answer: (url: string) => Response) => {
      const fetched: string[] = [];
      return { fetched, fetch: (async (url: URL | string) => (fetched.push(String(url)), answer(String(url)))) as typeof fetch };
    };
    const lookalikes = ["https://evil-api.github.com/x", "https://api.github.com.evil.test/x", "https://xapi.github.com/x", "https://api.github.com@evil.test/x", "https://api.github.com:8443/x"];

    it.each(lookalikes)("refuses %s as an absolute path before any request leaves", async (target) => {
      const { fetched, fetch } = fetching(() => new Response("{}"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: target })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual([]);
    });

    it.each(lookalikes)("does not follow a redirect to %s, and does not resend the token there", async (target) => {
      const { fetched, fetch } = fetching(() => new Response(null, { status: 302, headers: { location: target } }));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual(["https://api.github.com/x"]);
    });

    it.each(lookalikes)("refuses a next link to %s", async (target) => {
      const { fetched, fetch } = fetching(() => new Response("[1]", { headers: { link: `<${target}?page=2>; rel="next"` } }));
      await expect(client({ fetch }).session(github, TOKEN).paginate({ path: "/x" }, { maxPages: 5 })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual(["https://api.github.com/x"]);
    });

    it("follows an absolute link on the credential's own host and port", async () => {
      const { fetched, fetch } = fetching((url) => new Response(url.endsWith("/x") ? "[1]" : "[2]", { headers: url.endsWith("/x") ? { link: '<https://api.github.com/x?page=2>; rel="next"' } : {} }));
      expect(await client({ fetch }).session(github, TOKEN).paginate({ path: "/x" }, { maxPages: 5 })).toEqual({ items: [1, 2], truncated: false });
      expect(fetched).toEqual(["https://api.github.com/x", "https://api.github.com/x?page=2"]);
    });

    it("keeps a credential's own port: a link to the host without it, or to another port, is refused", async () => {
      const enterprise: ResolvedCredential = { ...github, baseUrl: "https://ghe.example.com:8443/api/v3", host: "ghe.example.com" };
      const { fetched, fetch } = fetching(() => new Response("{}"));
      const session = client({ fetch }).session(enterprise, TOKEN);
      await expect(session.request({ method: "GET", path: "https://ghe.example.com/api/v3/x" })).rejects.toMatchObject({ kind: "outside-host" });
      await expect(session.request({ method: "GET", path: "https://ghe.example.com:9443/api/v3/x" })).rejects.toMatchObject({ kind: "outside-host" });
      await expect(session.request({ method: "GET", path: "https://ghe.example.com:8443/api/v3/x" })).resolves.toMatchObject({ status: 200 });
      expect(fetched).toEqual(["https://ghe.example.com:8443/api/v3/x"]);
    });
  });

  describe("stayUnder", () => {
    const github: ResolvedCredential = { key: "github.com/org", label: "github.com/org", accountId: "account", accountLabel: "github.com/org", kind: "fine-grained", service: "github", auth: "token", baseUrl: "https://ghe.example.com/api/v3", host: "ghe.example.com" };
    const under = "/repos/Org/Repo/";
    const moved = (location: string, status = 301) => async (url: URL | string) =>
      String(url).includes("/repos/Org/Repo/") && String(url).includes("/old") ? new Response(null, { status, headers: { location } }) : new Response("{}");
    const recording = (answer: (url: URL | string) => Promise<Response>) => {
      const fetched: string[] = [];
      return { fetched, fetch: (async (url: URL | string) => (fetched.push(String(url)), answer(url))) as typeof fetch };
    };

    it("refuses a redirect to another repository's path, and does not follow it", async () => {
      for (const location of ["/api/v3/repositories/42/issues/9", "https://ghe.example.com/api/v3/repos/org/other/issues/9", "/api/v3/repos/Org/Repo2/issues/9", "/api/v3/repos/Org/Repo"]) {
        const { fetched, fetch } = recording(moved(location));
        const error = await client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old", query: { access_token: TOKEN }, stayUnder: under }).catch((e: unknown) => e as Error);
        expect(error).toMatchObject({ kind: "outside-host" });
        expect((error as Error).message).not.toMatch(/access_token|secret/);
        expect(fetched).toHaveLength(1);
      }
    });

    it("follows a redirect that stays under it, without regard to case", async () => {
      const { fetched, fetch } = recording(moved("/api/v3/repos/org/repo/issues/9"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old", stayUnder: under })).resolves.toMatchObject({ status: 200 });
      expect(fetched).toEqual(["https://ghe.example.com/api/v3/repos/Org/Repo/issues/old", "https://ghe.example.com/api/v3/repos/org/repo/issues/9"]);
    });

    it("reads the prefix after the credential's base path", async () => {
      const { fetched, fetch } = recording(moved("/repos/Org/Repo/issues/9"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old", stayUnder: under })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toHaveLength(1);
    });

    it("refuses a dot-dot path that climbs out of it", async () => {
      const { fetched, fetch } = recording(moved("/api/v3/repos/Org/Repo/../Other/issues/9"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old", stayUnder: under })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toHaveLength(1);
    });

    it("refuses a request whose own path is outside it", async () => {
      const { fetched, fetch } = recording(async () => new Response("{}"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Other/issues/1", stayUnder: under })).rejects.toMatchObject({ kind: "outside-host" });
      expect(fetched).toEqual([]);
    });

    it("sends the same request unrestricted where no prefix is given", async () => {
      const { fetch } = recording(moved("/api/v3/repositories/42/issues/9"));
      await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old" })).resolves.toMatchObject({ status: 200 });
    });

    describe("a next link", () => {
      const gitlab: ResolvedCredential = { key: "gitlab.com/org", label: "gitlab.com/org", accountId: "account", accountLabel: "gitlab.com/org", kind: "fine-grained", service: "gitlab", auth: "token", baseUrl: "https://ghe.example.com/api/v4", host: "ghe.example.com" };
      const page = (link: string) => async (url: URL | string) => new Response("[1]", { headers: String(url).includes("page=2") ? {} : { link: `<${link}>; rel="next"` } });
      const pagesOf = (credential: ResolvedCredential, link: string, stay = under, path = "/repos/Org/Repo/issues") => {
        const run = recording(page(link));
        const result = client({ fetch: run.fetch }).session(credential, TOKEN).paginate({ path, stayUnder: stay }, { maxPages: 5 });
        return { run, result };
      };

      it("follows one under the repository's path, and one under /repositories/{id}/ after the base path", async () => {
        for (const link of ["https://ghe.example.com/api/v3/repos/Org/Repo/issues?page=2", "https://ghe.example.com/api/v3/repositories/42/issues?page=2", "https://ghe.example.com/api/v3/Repositories/42/issues?page=2"]) {
          const { run, result } = pagesOf(github, link);
          expect(await result).toEqual({ items: [1, 1], truncated: false });
          expect(run.fetched[1]).toBe(link);
        }
      });

      it("follows one under /repositories/{id}/ on a request made from the link itself", async () => {
        const { fetched, fetch } = recording(async () => new Response("[1]"));
        await client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "https://ghe.example.com/api/v3/repositories/42/issues?page=2", stayUnder: under });
        expect(fetched).toEqual(["https://ghe.example.com/api/v3/repositories/42/issues?page=2"]);
      });

      it("refuses one to another path, and reads no further page", async () => {
        for (const link of [
          "https://ghe.example.com/api/v3/repos/Org/Other/issues?page=2",
          "https://ghe.example.com/api/v3/repositories/abc/issues?page=2",
          "https://ghe.example.com/api/v3/repositories/42?page=2",
          "https://ghe.example.com/api/v3/repositories/42/../../repos/Org/Other/issues?page=2",
          "https://ghe.example.com/api/v3/user/repositories/42/issues?page=2",
          "https://ghe.example.com/repositories/42/issues?page=2",
        ]) {
          const { run, result } = pagesOf(github, link);
          await expect(result).rejects.toMatchObject({ kind: "outside-host" });
          expect(run.fetched).toHaveLength(1);
        }
      });

      it("refuses one to another host or another port, even under /repositories/{id}/", async () => {
        for (const link of ["https://other.example.com/api/v3/repositories/42/issues?page=2", "https://ghe.example.com:8443/api/v3/repositories/42/issues?page=2", "http://ghe.example.com/api/v3/repositories/42/issues?page=2"]) {
          const { run, result } = pagesOf(github, link);
          await expect(result).rejects.toMatchObject({ kind: "outside-host" });
          expect(run.fetched).toHaveLength(1);
        }
      });

      it("takes the /repositories/{id}/ form from GitHub only", async () => {
        const { run, result } = pagesOf(gitlab, "https://ghe.example.com/api/v4/repositories/42/issues?page=2", "/projects/org%2Frepo/", "/projects/org%2Frepo/issues");
        await expect(result).rejects.toMatchObject({ kind: "outside-host" });
        expect(run.fetched).toHaveLength(1);
      });

      it("is the only request that may: a redirect to /repositories/{id}/ is still refused", async () => {
        const { fetched, fetch } = recording(async (url: URL | string) => (String(url).includes("/repositories/") ? new Response("[1]") : new Response(null, { status: 301, headers: { location: "/api/v3/repositories/42/issues/old" } })));
        await expect(client({ fetch }).session(github, TOKEN).request({ method: "GET", path: "/repos/Org/Repo/issues/old", stayUnder: under })).rejects.toMatchObject({ kind: "outside-host" });
        expect(fetched).toHaveLength(1);
        const viaLink = recording(async (url: URL | string) => (String(url).endsWith("/old") ? new Response(null, { status: 301, headers: { location: "/api/v3/repositories/43/issues/9" } }) : new Response("[1]")));
        await expect(client({ fetch: viaLink.fetch }).session(github, TOKEN).request({ method: "GET", path: "https://ghe.example.com/api/v3/repositories/42/old", stayUnder: under })).rejects.toMatchObject({ kind: "outside-host" });
        expect(viaLink.fetched).toHaveLength(1);
      });
    });
  });

  it("follows a redirect on the same host", async () => {
    const { seen, credential } = await serve((request, response) => {
      if (request.url === "/api/old") {
        response.writeHead(301, { location: "/api/new" });
        response.end();
      } else json(response, { moved: true });
    });
    const answer = await client().session(credential(), TOKEN).request({ method: "GET", path: "/old" });
    expect(answer.json).toEqual({ moved: true });
    expect(seen.map((s) => s.url)).toEqual(["/api/old", "/api/new"]);
  });

  describe("only reads", () => {
    it("refuses a POST that is not a GraphQL query, and any other method", async () => {
      const { seen, credential } = await serve((_, response) => json(response, {}));
      const session = client().session(credential("linear"), "k");
      await expect(session.request({ method: "POST", path: "/" })).rejects.toMatchObject({ kind: "forbidden-write" });
      await expect(session.request({ method: "DELETE" as "GET", path: "/" })).rejects.toMatchObject({ kind: "forbidden-write" });
      expect(seen).toHaveLength(0);
    });

    it("sends a GraphQL query and refuses a mutation", async () => {
      const { seen, credential } = await serve((_, response) => json(response, { data: {} }));
      const session = client().session(credential("linear"), "k");
      await session.request({ method: "POST", path: "/", graphql: { query: "query Q($id: String!) { issue(id: $id) { id } }", variables: { id: "x" } } });
      expect(JSON.parse(seen[0]!.body)).toEqual({ query: "query Q($id: String!) { issue(id: $id) { id } }", variables: { id: "x" } });
      await expect(session.request({ method: "POST", path: "/", graphql: { query: "mutation { issueDelete(id: \"x\") { success } }" } })).rejects.toMatchObject({ kind: "forbidden-write" });
      expect(seen).toHaveLength(1);
    });

    it("tells a mutation from a string or comment that says the word", () => {
      expect(graphqlWrites("mutation M { a }")).toBe(true);
      expect(graphqlWrites("query { a } mutation { b }")).toBe(true);
      expect(graphqlWrites("subscription { a }")).toBe(true);
      expect(graphqlWrites('query { issues(filter: {title: {contains: "mutation"}}) { id } }')).toBe(false);
      expect(graphqlWrites("# mutation\nquery { a }")).toBe(false);
    });
  });

  describe("conditional requests", () => {
    it("sends If-None-Match for a repeat GET and answers a 304 with the cached body, not counted for GitHub", async () => {
      const { seen, credential } = await serve((request, response) => {
        if (request.headers["if-none-match"] === '"v1"') {
          response.writeHead(304);
          response.end();
        } else json(response, { n: 1 }, 200, { etag: '"v1"' });
      });
      const session = client().session(credential(), TOKEN);
      const first = await session.request({ method: "GET", path: "/x" });
      const second = await session.request({ method: "GET", path: "/x" });
      expect(first.notModified).toBe(false);
      expect(second).toMatchObject({ notModified: true, status: 304, json: { n: 1 } });
      expect(seen).toHaveLength(2);
      expect(session.drainRequests().map((r) => r.counted)).toEqual([true, false]);
    });

    it("counts a 304 for a service other than GitHub", async () => {
      const { credential } = await serve((request, response) => {
        if (request.headers["if-none-match"] === '"v1"') {
          response.writeHead(304);
          response.end();
        } else json(response, { n: 1 }, 200, { etag: '"v1"' });
      });
      const session = client().session({ ...credential("gitlab"), key: "gitlab.com/g", label: "gitlab.com/g" }, TOKEN);
      await session.request({ method: "GET", path: "/x" });
      await session.request({ method: "GET", path: "/x" });
      expect(session.drainRequests().map((r) => r.counted)).toEqual([true, true]);
    });

    it("keeps one credential's cache from answering another's", async () => {
      const { seen, credential } = await serve((_, response) => json(response, { n: 1 }, 200, { etag: '"v1"' }));
      const http = client();
      await http.session(credential(), "a").request({ method: "GET", path: "/x" });
      await http.session({ ...credential(), key: "github.com/other", label: "github.com/other" }, "b").request({ method: "GET", path: "/x" });
      expect(seen[1]!.headers["if-none-match"]).toBeUndefined();
    });
  });

  describe("errors and retries", () => {
    it("retries a 5xx and a dropped connection, then answers", async () => {
      let calls = 0;
      const { credential } = await serve((_, response) => {
        calls += 1;
        if (calls === 1) response.destroy();
        else if (calls === 2) json(response, {}, 503);
        else json(response, { ok: calls });
      });
      const answer = await client().session(credential(), TOKEN).request({ method: "GET", path: "/x" });
      expect(answer.json).toEqual({ ok: 3 });
    });

    it("treats a service that takes the request and never answers as no answer, after one request and no retry", async () => {
      const { seen, credential } = await serve(() => undefined);
      const session = new HttpClient({ sleep: async () => undefined, timeoutMs: 40 }).session(credential(), TOKEN);
      await expect(session.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "network" });
      expect(seen).toHaveLength(1);
    });

    it("gives up on a persistent 5xx as a server error", async () => {
      const { seen, credential } = await serve((_, response) => json(response, {}, 500));
      await expect(client().session(credential(), TOKEN).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "server", status: 500 });
      expect(seen).toHaveLength(3);
    });

    it("sorts a 401, a 403 that is no rate limit, a 404 and a 422", async () => {
      const kinds: Record<number, string> = { 401: "auth", 403: "forbidden", 404: "not-found", 422: "client" };
      for (const [status, kind] of Object.entries(kinds)) {
        const { credential } = await serve((_, response) => json(response, {}, Number(status)));
        await expect(client().session(credential(), TOKEN).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ kind, status: Number(status) });
        server?.close();
      }
    });

    it("calls a 403 without a rate-limit header forbidden, and with x-ratelimit-remaining 0 or a retry-after a rate limit", async () => {
      const one = async (headers: Record<string, string>) => {
        const { credential } = await serve((_, response) => json(response, {}, 403, headers));
        const error = await client().session(credential(), TOKEN).request({ method: "GET", path: "/x" }).catch((e: unknown) => e);
        server?.close();
        return error;
      };
      expect(await one({})).toMatchObject({ kind: "forbidden", status: 403 });
      expect(await one({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" })).toMatchObject({ kind: "rate-limit" });
      expect(await one({ "retry-after": "600" })).toMatchObject({ kind: "rate-limit" });
    });

    it("waits out a short Retry-After and surfaces a long one as a rate limit", async () => {
      let calls = 0;
      const { credential } = await serve((_, response) => {
        calls += 1;
        if (calls === 1) json(response, {}, 429, { "retry-after": "1" });
        else json(response, { ok: true });
      });
      expect((await client().session(credential(), TOKEN).request({ method: "GET", path: "/x" })).json).toEqual({ ok: true });
      server?.close();
      const second = await serve((_, response) => json(response, {}, 403, { "x-ratelimit-remaining": "0", "retry-after": "600" }));
      const error = await client().session(second.credential(), TOKEN).request({ method: "GET", path: "/x" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ kind: "rate-limit", retryAfterMs: 600_000 });
    });

    it("never puts the token, a header or the query string in an error", async () => {
      const { credential } = await serve((_, response) => json(response, { message: `bad ${TOKEN}` }, 500));
      const error = await client().session(credential(), TOKEN).request({ method: "GET", path: "/x", query: { access_token: TOKEN } }).catch((e: unknown) => e as Error);
      expect(String((error as Error).message)).not.toContain(TOKEN);
      expect(String((error as Error).message)).not.toContain("access_token");
      const refused = await client({
        fetch: async () => {
          throw new TypeError(`fetch failed: https://x/?access_token=${TOKEN}`, { cause: new Error(`Bearer ${TOKEN}`) });
        },
      })
        .session(credential(), TOKEN)
        .request({ method: "GET", path: "/x", query: { access_token: TOKEN } })
        .catch((e: unknown) => e as Error);
      expect((refused as Error).message).not.toContain(TOKEN);
      expect((refused as Error).message).toBe("GET /api/x failed: no answer");
    });
  });

  describe("a GraphQL query answered outside 2xx", () => {
    const QUERY = { query: "query { viewer { id } }" };
    const KEY = "lin_api_secretsecretsecret";
    const post = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
      const { credential } = await serve((_, response) => (typeof body === "string" ? (response.writeHead(status, headers), response.end(body)) : json(response, body, status, headers)));
      return client().session(credential("linear"), KEY).request({ method: "POST", path: "", graphql: QUERY }).catch((e: unknown) => e as HttpError);
    };

    it("carries each error's extensions type and code, and no message or other field", async () => {
      const error = await post(400, {
        errors: [
          { message: `Bad key ${KEY} for Jane Doe`, path: ["viewer"], locations: [{ line: 1 }], extensions: { type: "authentication error", code: "AUTHENTICATION_ERROR", userPresentableMessage: "Your key is revoked" } },
          { message: "Rate limited", extensions: { code: "RATELIMITED" } },
          { message: "no extensions" },
        ],
      });
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ kind: "client", status: 400, graphql: [{ type: "authentication error", code: "AUTHENTICATION_ERROR" }, { type: null, code: "RATELIMITED" }] });
      const shown = JSON.stringify([(error as HttpError).graphql, (error as HttpError).message]);
      for (const text of [KEY, "Bad key", "Jane Doe", "revoked", "viewer", "Rate limited"]) expect(shown).not.toContain(text);
    });

    it("cuts a long value to 64 characters, takes only strings and keeps a token out", async () => {
      const error = (await post(400, { errors: [{ extensions: { type: "x".repeat(200), code: 12 } }, { extensions: { type: `t-${KEY}`, code: { nested: true } } }] })) as HttpError;
      expect(error.graphql).toEqual([{ type: "x".repeat(64), code: null }, { type: expect.not.stringContaining(KEY), code: null }]);
    });

    it("also rides on a rate limit", async () => {
      const error = await post(429, { errors: [{ message: "slow down", extensions: { code: "RATELIMITED" } }] }, { "retry-after": "600" });
      expect(error).toMatchObject({ kind: "rate-limit", graphql: [{ type: null, code: "RATELIMITED" }] });
    });

    it("is absent where the body is not JSON, names no errors, or names none with a type or code", async () => {
      for (const body of ["<html>bad gateway</html>", {}, { errors: "no" }, { errors: [{ message: "m" }] }, { errors: [] }]) {
        const error = await post(400, body);
        expect(error).toMatchObject({ kind: "client" });
        expect((error as HttpError).graphql).toBeUndefined();
      }
    });

    it("is not read for a GET, nor attached to an answer that is 2xx", async () => {
      const { credential } = await serve((_, response) => json(response, { errors: [{ extensions: { code: "X" } }] }, 400));
      const error = await client().session(credential(), TOKEN).request({ method: "GET", path: "/x" }).catch((e: unknown) => e as HttpError);
      expect(error).toMatchObject({ kind: "client" });
      expect((error as HttpError).graphql).toBeUndefined();
      server?.close();
      const ok = await serve((_, response) => json(response, { errors: [{ extensions: { code: "X" } }], data: null }));
      await expect(client().session(ok.credential("linear"), KEY).request({ method: "POST", path: "", graphql: QUERY })).resolves.toMatchObject({ status: 200 });
    });
  });

  describe("accounting", () => {
    it("records each request without its query and drains them", async () => {
      const { credential } = await serve((_, response) => json(response, []));
      const session = client().session(credential(), TOKEN);
      await session.request({ method: "GET", path: "/a", query: { q: "secret" } });
      const records = session.drainRequests();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ method: "GET", path: "/api/a", status: 200, counted: true });
      expect(JSON.stringify(records)).not.toContain("secret");
      expect(session.drainRequests()).toEqual([]);
    });

    it("keeps a token that is part of the path out of the records and the errors", async () => {
      const { credential } = await serve((_, response) => json(response, {}, 500));
      const session = client().session({ ...credential(), baseUrl: `${credential().baseUrl}/${TOKEN}` }, TOKEN);
      const error = await session.request({ method: "GET", path: "/x" }).catch((e: unknown) => e as Error);
      expect((error as Error).message).not.toContain(TOKEN);
      expect(JSON.stringify(session.drainRequests())).not.toContain(TOKEN);
    });

    it("reads a GitHub token's expiry from its header", async () => {
      const { credential } = await serve((_, response) => json(response, {}, 200, { "github-authentication-token-expiration": "2026-11-12 00:00:00 UTC" }));
      const session = client().session(credential(), TOKEN);
      expect(session.expiresAt()).toBeNull();
      await session.request({ method: "GET", path: "/x" });
      expect(session.expiresAt()).toBe("2026-11-12T00:00:00.000Z");
    });

    it("reads the expiry header with an offset as well as in UTC, and nothing from a value it cannot read", () => {
      const header = (value: string) => (name: string) => (name === "github-authentication-token-expiration" ? value : null);
      expect(expiryOf(header("2025-09-05 17:55:53 +0500"))).toBe("2025-09-05T12:55:53.000Z");
      expect(expiryOf(header("2026-11-12 00:00:00 UTC"))).toBe("2026-11-12T00:00:00.000Z");
      expect(expiryOf(header("next Tuesday"))).toBeNull();
      expect(expiryOf(() => null)).toBeNull();
    });
  });

  describe("paginate", () => {
    it("follows Link rel=next on the same host and reports a truncated list", async () => {
      const { port, credential } = await serve((request, response) => {
        const page = Number(new URL(request.url!, "http://x").searchParams.get("page") ?? "1");
        const next = `<http://127.0.0.1:${port}/api/list?page=${page + 1}>; rel="next"`;
        json(response, [page], 200, page < 5 ? { link: next } : {});
      });
      const session = client().session(credential(), TOKEN);
      expect(await session.paginate({ path: "/list" }, { maxPages: 10 })).toEqual({ items: [1, 2, 3, 4, 5], truncated: false });
      expect(await session.paginate({ path: "/list" }, { maxPages: 2 })).toEqual({ items: [1, 2], truncated: true });
    });

    it("reads every page again when each answers 304 without its Link header", async () => {
      const { port, credential, seen } = await serve((request, response) => {
        const page = Number(new URL(request.url!, "http://x").searchParams.get("page") ?? "1");
        const etag = `"p${page}"`;
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, { etag });
          response.end();
          return;
        }
        const next = `<http://127.0.0.1:${port}/api/list?page=${page + 1}>; rel="next"`;
        json(response, [page], 200, { etag, ...(page < 3 ? { link: next } : {}) });
      });
      const session = client().session(credential(), TOKEN);
      expect(await session.paginate({ path: "/list" }, { maxPages: 10 })).toEqual({ items: [1, 2, 3], truncated: false });
      expect(await session.paginate({ path: "/list" }, { maxPages: 10 })).toEqual({ items: [1, 2, 3], truncated: false });
      expect(seen).toHaveLength(6);
    });

    describe("a page that came with no next link", () => {
      /** A list of `pages` pages that answers 304 to any page whose etag it is shown, as an append-only list can for a full last page. */
      const growing = async () => {
        const state = { pages: 3 };
        const served = await serve((request, response) => {
          const page = Number(new URL(request.url!, "http://x").searchParams.get("page") ?? "1");
          const etag = `"p${page}"`;
          if (request.headers["if-none-match"] === etag) {
            response.writeHead(304, { etag });
            response.end();
            return;
          }
          const next = `<http://127.0.0.1:${served.port}/api/list?page=${page + 1}>; rel="next"`;
          json(response, [page], 200, { etag, ...(page < state.pages ? { link: next } : {}) });
        });
        return { ...served, state };
      };

      it("is read fresh, so a page added after it is found", async () => {
        const { credential, state, seen } = await growing();
        const session = client().session(credential(), TOKEN);
        expect(await session.paginate({ path: "/list" }, { maxPages: 10 })).toEqual({ items: [1, 2, 3], truncated: false });
        state.pages = 4;
        seen.length = 0;
        expect(await session.paginate({ path: "/list" }, { maxPages: 10 })).toEqual({ items: [1, 2, 3, 4], truncated: false });
        expect(seen.map((entry) => [entry.url, entry.headers["if-none-match"]])).toEqual([
          ["/api/list", '"p1"'],
          ["/api/list?page=2", '"p2"'],
          ["/api/list?page=3", undefined],
          ["/api/list?page=4", undefined],
        ]);
      });

      it("is read fresh when a request for a list page is made on its own", async () => {
        const { credential, seen } = await growing();
        const session = client().session(credential(), TOKEN);
        await session.request({ method: "GET", path: "/list", query: { page: 3 }, list: true });
        await session.request({ method: "GET", path: "/list", query: { page: 3 }, list: true });
        expect(seen.map((entry) => entry.headers["if-none-match"])).toEqual([undefined, undefined]);
      });

      it("stays conditional when it is an item read, not a page of a list", async () => {
        const { credential, seen } = await growing();
        const session = client().session(credential(), TOKEN);
        await session.request({ method: "GET", path: "/list", query: { page: 3 } });
        const second = await session.request({ method: "GET", path: "/list", query: { page: 3 } });
        expect(second.notModified).toBe(true);
        expect(seen.map((entry) => entry.headers["if-none-match"])).toEqual([undefined, '"p3"']);
      });
    });

    it("refuses a next link on another host", async () => {
      const { credential } = await serve((_, response) => json(response, [1], 200, { link: '<https://example.net/x?page=2>; rel="next"' }));
      await expect(client().session(credential(), TOKEN).paginate({ path: "/list" }, { maxPages: 5 })).rejects.toMatchObject({ kind: "outside-host" });
    });
  });
});
