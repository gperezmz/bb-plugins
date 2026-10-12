// Asks a service whose a token is, and whether it reads a fleet's repository,
// team or project, before the token is stored. Every request goes through the
// HTTP layer bound to the account's own API root, so a token reaches no other
// host. Sources:
//  - GitHub: GET /user (/en/rest/users/users#get-the-authenticated-user) answers
//    `login` for a classic token and, checked against a real token for this
//    build, for a fine-grained one with no account permissions. A classic token's
//    answers carry `X-OAuth-Scopes`; a fine-grained token's do not. The expiry
//    comes in `github-authentication-token-expiration`. GET /repos/{owner}/{repo}
//    answers 404 for a repository the token cannot see.
//  - GitLab: GET /user (/api/users/#retrieve-the-current-user) answers
//    `username` for a `read_api` token; GET /personal_access_tokens/self answers
//    `expires_at`, for a personal access token only. GET /projects/:id takes the
//    URL-encoded path.
//  - Linear: `viewer { id name email }`; `teams(filter: {key: {eq}})` lists the
//    team where the key reaches it. A bad key answers 401.
//  - Jira Cloud: GET /rest/api/3/myself answers `accountId`, `emailAddress`
//    (null where the user hides it) and `displayName`; GET
//    /rest/api/3/project/{key} answers 404 for a project the account cannot browse.
import { HttpError, type Http, type HttpSession, type Identified, type ProbeTarget, type ServiceProbe } from "../application/ports";
import type { Half } from "../domain/accounts";

/** The probe's session: bound to the target alone, under a key no fleet's read shares. */
const sessionOf = (http: Http, target: ProbeTarget, token: string): HttpSession =>
  http.session({ key: `probe ${target.baseUrl}`, label: target.host, accountId: "", accountLabel: target.host, service: target.service, auth: "token", kind: "classic", baseUrl: target.baseUrl, host: target.host }, token);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

const failed = (error: unknown): Identified => {
  if (error instanceof HttpError && error.kind === "auth") return { ok: false, why: "refused", reason: "the service rejected the token" };
  if (error instanceof HttpError && (error.kind === "network" || error.kind === "server" || error.kind === "rate-limit")) return { ok: false, why: "unreachable", reason: `the service did not answer (${error.message})` };
  if (error instanceof HttpError) return { ok: false, why: "refused", reason: `the service would not say whose the token is (${error.message})` };
  return { ok: false, why: "unreachable", reason: "the service's answer could not be read" };
};

const readFailure = (error: unknown): "not-found" | "forbidden" | "unreachable" => {
  if (error instanceof HttpError && error.kind === "not-found") return "not-found";
  if (error instanceof HttpError && (error.kind === "forbidden" || error.kind === "auth")) return "forbidden";
  return "unreachable";
};

export class HttpServiceProbe implements ServiceProbe {
  constructor(private readonly http: Http) {}

  async identify(target: ProbeTarget, token: string): Promise<Identified> {
    const http = sessionOf(this.http, target, token);
    try {
      switch (target.service) {
        case "github": {
          const answer = await http.request({ method: "GET", path: "/user" });
          const login = text((answer.json as { login?: unknown } | null)?.login);
          if (login === null) return { ok: false, why: "unreachable", reason: "GitHub's answer named no login" };
          return { ok: true, login, name: login, expiresAt: http.expiresAt(), classic: answer.header("x-oauth-scopes") !== null };
        }
        case "gitlab": {
          const answer = await http.request({ method: "GET", path: "/user" });
          const login = text((answer.json as { username?: unknown } | null)?.username);
          if (login === null) return { ok: false, why: "unreachable", reason: "GitLab's answer named no user" };
          let expiresAt: string | null = null;
          try {
            const self = await http.request({ method: "GET", path: "/personal_access_tokens/self" });
            const at = text((self.json as { expires_at?: unknown } | null)?.expires_at);
            // GitLab gives a date; the token stops working at the start of that day, UTC.
            expiresAt = at === null ? null : new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at).toISOString();
          } catch {
            // Another kind of token answers 400 here; its expiry is not known.
          }
          return { ok: true, login, name: login, expiresAt, classic: false };
        }
        case "linear": {
          const answer = await http.request({ method: "POST", path: "", graphql: { query: "query Viewer { viewer { id name email } }" } });
          const viewer = (answer.json as { data?: { viewer?: { id?: unknown; name?: unknown; email?: unknown } } } | null)?.data?.viewer;
          const id = text(viewer?.id);
          if (id === null) return { ok: false, why: "refused", reason: "Linear did not say whose the key is" };
          return { ok: true, login: id, name: text(viewer?.email) ?? text(viewer?.name) ?? id, expiresAt: null, classic: false };
        }
        case "jira": {
          const answer = await http.request({ method: "GET", path: "/rest/api/3/myself" });
          const me = answer.json as { accountId?: unknown; emailAddress?: unknown; displayName?: unknown } | null;
          const id = text(me?.accountId);
          if (id === null) return { ok: false, why: "refused", reason: "Jira did not say whose the token is" };
          const email = text(me?.emailAddress) ?? (token.includes(":") ? token.slice(0, token.indexOf(":")) : null);
          return { ok: true, login: id, name: email ?? text(me?.displayName) ?? id, expiresAt: null, classic: false };
        }
      }
    } catch (error) {
      return failed(error);
    }
  }

  async canRead(target: ProbeTarget, token: string, half: Half): Promise<"readable" | "not-found" | "forbidden" | "unreachable"> {
    const http = sessionOf(this.http, target, token);
    try {
      switch (target.service) {
        case "github": {
          const path = half.subject.kind === "repo" ? half.subject.path.map(encodeURIComponent).join("/") : "";
          await http.request({ method: "GET", path: `/repos/${path}` });
          return "readable";
        }
        case "gitlab": {
          const path = half.subject.kind === "repo" ? half.subject.path.join("/") : "";
          await http.request({ method: "GET", path: `/projects/${encodeURIComponent(path)}` });
          return "readable";
        }
        case "linear": {
          const team = half.subject.kind === "linear" ? half.subject.team : "";
          const answer = await http.request({ method: "POST", path: "", graphql: { query: "query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }", variables: { key: team } } });
          const nodes = (answer.json as { data?: { teams?: { nodes?: unknown[] } } } | null)?.data?.teams?.nodes;
          return Array.isArray(nodes) && nodes.length > 0 ? "readable" : "not-found";
        }
        case "jira": {
          const project = half.subject.kind === "jira" ? half.subject.project : "";
          await http.request({ method: "GET", path: `/rest/api/3/project/${encodeURIComponent(project)}` });
          return "readable";
        }
      }
    } catch (error) {
      return readFailure(error);
    }
  }
}
