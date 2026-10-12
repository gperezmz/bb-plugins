// The one HTTP layer every service adapter reads through, on plain `fetch`.
// It is where three of the plugin's rules are kept: a token goes only to its
// credential's host, only reads are sent, and no error text carries a token,
// a header or a query string.
import { HttpError, type Http, type HttpRequest, type HttpResponse, type HttpSession, type RequestRecord, type ResolvedCredential } from "../application/ports";
import type { ServiceKind } from "../domain/model";

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
}

interface CacheEntry {
  readonly etag: string;
  readonly json: unknown;
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
const describe = (method: string, url: URL): string => `${method} ${url.pathname}`;

const retryAfter = (header: (name: string) => string | null, now: Date): number | null => {
  const seconds = header("retry-after");
  if (seconds !== null && /^\d+$/.test(seconds)) return Number(seconds) * 1000;
  const reset = header("x-ratelimit-reset") ?? header("ratelimit-reset");
  if (reset !== null && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now.getTime());
  return null;
};

const expiryOf = (header: (name: string) => string | null): string | null => {
  // GitHub: "2026-11-12 00:00:00 UTC", sent for tokens that expire.
  const raw = header("github-authentication-token-expiration");
  if (raw === null) return null;
  const parsed = new Date(raw.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
  /** Conditional-request bodies, by credential and URL. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  session(credential: ResolvedCredential, token: string): HttpSession {
    return new Session(credential, token, this.fetchImpl, this.now, this.sleep, this.cache);
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
    if (/^https?:\/\//i.test(request.path)) {
      url = new URL(request.path);
    } else {
      url = new URL(base.toString());
      const joined = `${base.pathname.replace(/\/+$/, "")}/${request.path.replace(/^\/+/, "")}`;
      url.pathname = request.path === "" ? base.pathname : joined;
    }
    if (url.hostname !== this.credential.host) throw new HttpError("outside-host", `${request.method} ${url.pathname} is not on the credential's host`);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new HttpError("outside-host", `${request.method} ${url.pathname} is not https`);
    for (const [name, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    return url;
  }

  async request(request: HttpRequest, options: { readonly signal?: AbortSignal } = {}): Promise<HttpResponse> {
    if (request.method === "POST") {
      if (request.graphql === undefined) throw new HttpError("forbidden-write", `POST ${request.path} is not a GraphQL query`);
      if (graphqlWrites(request.graphql.query)) throw new HttpError("forbidden-write", `POST ${request.path} would write`);
    } else if (request.method !== "GET") {
      throw new HttpError("forbidden-write", `${String(request.method)} ${request.path} is not a read`);
    }
    let url = this.url(request);
    const cacheKey = `${this.credential.prefix} ${request.method} ${url.toString()}`;
    const cached = request.method === "GET" ? this.cache.get(cacheKey) : undefined;
    const headers: Record<string, string> = { ...defaultHeaders(this.service), ...request.headers, authorization: authorization(this.service, this.token) };
    if (cached !== undefined) headers["if-none-match"] = cached.etag;
    let body: string | undefined;
    if (request.graphql !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify({ query: request.graphql.query, variables: request.graphql.variables ?? {} });
    }

    for (let attempt = 0, redirects = 0; ; attempt += 1) {
      const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(options.signal === undefined ? [] : [options.signal])]);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: request.method, headers, body, redirect: "manual", signal });
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        this.record(request.method, url, null, true);
        if (attempt < MAX_RETRIES) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        throw new HttpError("network", `${describe(request.method, url)} failed: no answer`);
      }
      const header = (name: string) => response.headers.get(name);
      this.record(request.method, url, response.status, !(this.service === "github" && response.status === 304));
      const expires = expiryOf(header);
      if (expires !== null) this.expiry = expires;

      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = header("location");
        if (location === null || request.method !== "GET" || redirects >= MAX_REDIRECTS) throw new HttpError("client", `${describe(request.method, url)} redirected`, response.status);
        const target = new URL(location, url);
        if (target.hostname !== this.credential.host) throw new HttpError("outside-host", `${describe(request.method, url)} redirected off the credential's host`, response.status);
        url = target;
        redirects += 1;
        continue;
      }
      if (response.status === 304 && cached !== undefined) return { status: 304, json: cached.json, notModified: true, header };
      if (response.status >= 200 && response.status < 300) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new HttpError("server", `${describe(request.method, url)} answered a body that is not JSON`, response.status);
        }
        const etag = header("etag");
        if (request.method === "GET" && etag !== null) this.remember(cacheKey, { etag, json });
        return { status: response.status, json, notModified: false, header };
      }

      const wait = retryAfter(header, this.now());
      const limited = response.status === 429 || (response.status === 403 && (header("x-ratelimit-remaining") === "0" || header("retry-after") !== null));
      if (limited) {
        if (wait !== null && wait <= MAX_WAIT_MS && attempt < MAX_RETRIES) {
          await this.sleep(wait);
          continue;
        }
        throw new HttpError("rate-limit", `${describe(request.method, url)} was rate limited`, response.status, wait);
      }
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      const kind = response.status === 401 || response.status === 403 ? "auth" : response.status === 404 ? "not-found" : response.status >= 500 ? "server" : "client";
      throw new HttpError(kind, `${describe(request.method, url)} answered ${response.status}`, response.status);
    }
  }

  async paginate(
    request: Omit<HttpRequest, "method" | "graphql">,
    options: { readonly maxPages: number; readonly signal?: AbortSignal },
  ): Promise<{ readonly items: unknown[]; readonly truncated: boolean }> {
    const items: unknown[] = [];
    let next: HttpRequest | null = { ...request, method: "GET" };
    for (let page = 0; next !== null; page += 1) {
      if (page >= options.maxPages) return { items, truncated: true };
      const response: HttpResponse = await this.request(next, options);
      if (!Array.isArray(response.json)) throw new HttpError("server", `GET ${next.path} answered a body that is not a list`, response.status);
      items.push(...response.json);
      const link = nextLink(response.header("link"));
      next = link === null ? null : { method: "GET", path: link };
    }
    return { items, truncated: false };
  }

  private record(method: string, url: URL, status: number | null, counted: boolean): void {
    this.requests.push({ method, path: url.pathname, status, counted, at: this.now().toISOString() });
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

const isLoopback = (hostname: string): boolean => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
