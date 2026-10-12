// The one HTTP layer every service adapter reads through, on plain `fetch`.
// It is where three of the plugin's rules are kept: a token goes only to its
// credential's host, only reads are sent, and no error text carries a token,
// a header or a query string.
import { HttpError, type Http, type HttpRequest, type HttpResponse, type HttpSession, type RequestRecord, type ResolvedCredential } from "../application/ports";
import type { ServiceKind } from "../domain/model";
import { redact } from "../domain/redact";
import { isLoopbackHost } from "../domain/accounts";

const USER_AGENT = "bb-plugin-unattendish-sdlc";
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_RETRIES = 2;
/** A Retry-After longer than this is surfaced as a rate limit instead of waited for inside a poll. */
const MAX_WAIT_MS = 10_000;
const CACHE_ENTRIES = 500;

export interface HttpOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** Waits between retries; tests pass one that returns at once. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long one request may wait for an answer; 30 seconds by default. */
  readonly timeoutMs?: number;
}

interface CacheEntry {
  readonly etag: string;
  readonly json: unknown;
  /** The `Link` header the body came with: a 304 need not repeat it, and the next page is found through it. */
  readonly link: string | null;
}

/** Whether a GraphQL document would write: a `mutation` or `subscription` operation. */
export const graphqlWrites = (document: string): boolean => {
  const bare = document.replace(/#[^\n]*/g, " ").replace(/"""[\s\S]*?"""/g, " ").replace(/"(?:\\.|[^"\\])*"/g, " ");
  return /(^|[\s}])(mutation|subscription)\b/.test(bare);
};

const authorization = (service: ServiceKind, token: string): string => {
  switch (service) {
    case "linear":
      // A personal API key is sent as is; an OAuth token is a Bearer.
      return token.startsWith("lin_oauth") ? `Bearer ${token}` : token;
    case "jira":
      // `email:api-token` is Basic, which is how a Jira Cloud API token is used.
      return token.includes(":") ? `Basic ${Buffer.from(token).toString("base64")}` : `Bearer ${token}`;
    default:
      return `Bearer ${token}`;
  }
};

const defaultHeaders = (service: ServiceKind): Record<string, string> => {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json" };
  if (service === "github") {
    headers.accept = "application/vnd.github+json";
    headers["x-github-api-version"] = "2022-11-28";
  }
  return headers;
};

/** The method and path of a request, which is all an error may say about it. */
const describe = (method: string, url: URL, token: string): string => `${method} ${redact(url.pathname, [token])}`;

const retryAfter = (header: (name: string) => string | null, now: Date): number | null => {
  const seconds = header("retry-after");
  if (seconds !== null && /^\d+$/.test(seconds)) return Number(seconds) * 1000;
  const reset = header("x-ratelimit-reset") ?? header("ratelimit-reset");
  if (reset !== null && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now.getTime());
  return null;
};

/**
 * When the token expires, from GitHub's `github-authentication-token-expiration`, sent for tokens that expire, as
 * `2026-11-12 00:00:00 UTC` or with an offset, `2026-11-12 05:00:00 +0500`. Null where it is absent or unreadable.
 */
export const expiryOf = (header: (name: string) => string | null): string | null => {
  const raw = header("github-authentication-token-expiration");
  if (raw === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})$/.exec(raw.trim());
  if (match === null) return null;
  const zone = match[3] === "UTC" || match[3] === "Z" ? "Z" : `${match[3]!.slice(0, 3)}:${match[3]!.slice(-2)}`;
  const parsed = new Date(`${match[1]}T${match[2]}${zone}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const GRAPHQL_FIELD_LIMIT = 64;
const GRAPHQL_ERRORS_LIMIT = 20;

/**
 * The `extensions.type` and `extensions.code` of each entry of a GraphQL error body's `errors`, and nothing else of
 * it: a message is text written on the service. A string is cut to 64 characters and has the token removed; an entry
 * with neither is left out. Undefined where the body is not JSON or names none.
 */
const graphqlErrorsOf = async (response: Response, token: string): Promise<{ type: string | null; code: string | null }[] | undefined> => {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return undefined;
  }
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return undefined;
  const field = (extensions: unknown, name: string): string | null => {
    const value = (extensions as Record<string, unknown> | null)?.[name];
    return typeof value === "string" ? redact(value, [token]).slice(0, GRAPHQL_FIELD_LIMIT) : null;
  };
  const found = errors
    .map((entry) => {
      const extensions = typeof entry === "object" && entry !== null ? (entry as { extensions?: unknown }).extensions : null;
      return { type: field(extensions, "type"), code: field(extensions, "code") };
    })
    .filter((entry) => entry.type !== null || entry.code !== null)
    .slice(0, GRAPHQL_ERRORS_LIMIT);
  return found.length === 0 ? undefined : found;
};

const nextLink = (link: string | null): string | null => {
  if (link === null) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match !== null) return match[1] ?? null;
  }
  return null;
};

export class HttpClient implements Http {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  /** Conditional-request bodies, by credential and URL. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  session(credential: ResolvedCredential, token: string): HttpSession {
    return new Session(credential, token, this.fetchImpl, this.now, this.sleep, this.cache, this.timeoutMs);
  }
}

class Session implements HttpSession {
  readonly service: ServiceKind;
  readonly baseUrl: string;
  private requests: RequestRecord[] = [];
  private expiry: string | null = null;

  constructor(
    private readonly credential: ResolvedCredential,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => Date,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly cache: Map<string, CacheEntry>,
    private readonly timeoutMs: number,
  ) {
    this.service = credential.service;
    this.baseUrl = credential.baseUrl;
  }

  drainRequests(): RequestRecord[] {
    const drained = this.requests;
    this.requests = [];
    return drained;
  }

  expiresAt(): string | null {
    return this.expiry;
  }

  noteExpiresAt(iso: string): void {
    this.expiry = iso;
  }

  private url(request: HttpRequest): URL {
    const base = new URL(this.baseUrl);
    let url: URL;
    const nextLink = /^https?:\/\//i.test(request.path);
    if (nextLink) {
      url = new URL(request.path);
    } else {
      url = new URL(base.toString());
      const joined = `${base.pathname.replace(/\/+$/, "")}/${request.path.replace(/^\/+/, "")}`;
      url.pathname = request.path === "" ? base.pathname : joined;
    }
    this.checkTarget(request.method, url, request.stayUnder, nextLink);
    for (const [name, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    return url;
  }

  /**
   * Refuses a URL off the credential's host and port, or plain http anywhere but loopback; the token goes to no other.
   * Where `stayUnder` is given, also refuses a path outside that prefix (after the credential's base path). A GitHub
   * pagination link (`nextLink`: a request whose path is an absolute URL, never a redirect) may instead be under
   * `/repositories/{id}/` after the base path, the form GitHub writes its `Link` headers in.
   */
  private checkTarget(method: string, url: URL, stayUnder?: string, nextLink = false): void {
    if (url.hostname !== this.credential.host || url.port !== new URL(this.baseUrl).port) throw new HttpError("outside-host", `${method} ${url.pathname} is not on the credential's host`);
    if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) throw new HttpError("outside-host", `${method} ${url.pathname} is not https`);
    if (stayUnder === undefined) return;
    const basePath = new URL(this.baseUrl).pathname.replace(/\/+$/, "");
    const prefix = `${basePath}/${stayUnder.replace(/^\/+/, "").replace(/\/*$/, "/")}`.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (path.startsWith(prefix)) return;
    if (nextLink && this.service === "github" && path.startsWith(`${basePath.toLowerCase()}/repositories/`) && /^\d+\//.test(path.slice(basePath.length + "/repositories/".length))) return;
    throw new HttpError("outside-host", `${describe(method, url, this.token)} is outside the repository the request is for`);
  }

  async request(request: HttpRequest, options: { readonly signal?: AbortSignal } = {}): Promise<HttpResponse> {
    if (request.method === "POST") {
      if (request.graphql === undefined) throw new HttpError("forbidden-write", `POST ${request.path} is not a GraphQL query`);
      if (graphqlWrites(request.graphql.query)) throw new HttpError("forbidden-write", `POST ${request.path} would write`);
    } else if (request.method !== "GET") {
      throw new HttpError("forbidden-write", `${String(request.method)} ${request.path} is not a read`);
    }
    let url = this.url(request);
    const cacheKey = `${this.credential.key} ${request.method} ${url.toString()}`;
    const cached = request.method === "GET" ? this.cache.get(cacheKey) : undefined;
    const headers: Record<string, string> = { ...defaultHeaders(this.service), ...request.headers, authorization: authorization(this.service, this.token) };
    // A page of a list that came with no next link is read fresh (see `HttpRequest.list`); an item read stays conditional.
    const conditional = cached !== undefined && !(request.list === true && cached.link === null);
    if (conditional) headers["if-none-match"] = cached.etag;
    let body: string | undefined;
    if (request.graphql !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify({ query: request.graphql.query, variables: request.graphql.variables ?? {} });
    }

    for (let attempt = 0, redirects = 0; ; attempt += 1) {
      const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(options.signal === undefined ? [] : [options.signal])]);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: request.method, headers, body, redirect: "manual", signal });
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        this.record(request.method, url, null, true);
        // A service that took the request and never answered will not answer a second one in time: no retry.
        const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
        if (!timedOut && attempt < MAX_RETRIES) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        throw new HttpError("network", `${describe(request.method, url, this.token)} failed: no answer`);
      }
      const header = (name: string) => response.headers.get(name);
      this.record(request.method, url, response.status, !(this.service === "github" && response.status === 304));
      const expires = expiryOf(header);
      if (expires !== null) this.expiry = expires;

      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = header("location");
        if (location === null || request.method !== "GET" || redirects >= MAX_REDIRECTS) throw new HttpError("client", `${describe(request.method, url, this.token)} redirected`, response.status);
        const target = new URL(location, url);
        this.checkTarget(request.method, target, request.stayUnder);
        url = target;
        redirects += 1;
        continue;
      }
      if (response.status === 304 && conditional) {
        const kept = (name: string) => (name.toLowerCase() === "link" ? (header(name) ?? cached.link) : header(name));
        return { status: 304, json: cached.json, notModified: true, header: kept };
      }
      if (response.status >= 200 && response.status < 300) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new HttpError("server", `${describe(request.method, url, this.token)} answered a body that is not JSON`, response.status);
        }
        const etag = header("etag");
        if (request.method === "GET" && etag !== null) this.remember(cacheKey, { etag, json, link: header("link") });
        return { status: response.status, json, notModified: false, header };
      }

      const graphql = request.graphql === undefined ? undefined : await graphqlErrorsOf(response, this.token);
      const wait = retryAfter(header, this.now());
      const limited = response.status === 429 || (response.status === 403 && (header("x-ratelimit-remaining") === "0" || header("retry-after") !== null));
      if (limited) {
        if (wait !== null && wait <= MAX_WAIT_MS && attempt < MAX_RETRIES) {
          await this.sleep(wait);
          continue;
        }
        throw new HttpError("rate-limit", `${describe(request.method, url, this.token)} was rate limited`, response.status, wait, graphql);
      }
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      const kind = response.status === 401 ? "auth" : response.status === 403 ? "forbidden" : response.status === 404 ? "not-found" : response.status >= 500 ? "server" : "client";
      throw new HttpError(kind, `${describe(request.method, url, this.token)} answered ${response.status}`, response.status, null, graphql);
    }
  }

  async paginate(
    request: Omit<HttpRequest, "method" | "graphql">,
    options: { readonly maxPages: number; readonly signal?: AbortSignal },
  ): Promise<{ readonly items: unknown[]; readonly truncated: boolean }> {
    const items: unknown[] = [];
    let next: HttpRequest | null = { ...request, method: "GET", list: true };
    for (let page = 0; next !== null; page += 1) {
      if (page >= options.maxPages) return { items, truncated: true };
      const response: HttpResponse = await this.request(next, options);
      if (!Array.isArray(response.json)) throw new HttpError("server", `GET ${next.path} answered a body that is not a list`, response.status);
      items.push(...response.json);
      const link = nextLink(response.header("link"));
      next = link === null ? null : { method: "GET", path: link, list: true, ...(request.stayUnder === undefined ? {} : { stayUnder: request.stayUnder }) };
    }
    return { items, truncated: false };
  }

  private record(method: string, url: URL, status: number | null, counted: boolean): void {
    this.requests.push({ method, path: redact(url.pathname, [this.token]), status, counted, at: this.now().toISOString() });
  }

  private remember(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size > CACHE_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
  }
}
