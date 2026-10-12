// Fakes for the ports the use cases need, for tests that run on fakes alone.
import { longestMatch, parsePrefix, repoSubject, trackerSubject, type Prefix } from "../domain/identity";
import { parseManifest } from "../domain/manifest";
import type { ManifestRead, RepoRef, ReadOutcome, ServiceKind, TrackerSpec } from "../domain/model";
import type {
  Clock,
  Credentials,
  CredentialLookup,
  DeliveryResult,
  Http,
  HttpSession,
  ManagerChannel,
  ManifestFiles,
  ReadRequest,
  RequestRecord,
  ResolvedCredential,
  ServiceAdapter,
  ThreadDirectory,
} from "../application/ports";

export class FakeClock implements Clock {
  constructor(private current = new Date("2026-10-12T10:00:00.000Z")) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeThreads implements ThreadDirectory {
  readonly states = new Map<string, "live" | "archived" | "gone">();
  async state(threadId: string): Promise<"live" | "archived" | "gone"> {
    return this.states.get(threadId) ?? "gone";
  }
}

/** bb's queue as the manager sees it: idle sends at once, busy queues, refusing refuses. */
export class FakeChannel implements ManagerChannel {
  mode: "idle" | "busy" | "refuse" = "idle";
  readonly sent: { threadId: string; text: string; id: string | null }[] = [];
  readonly queue = new Map<string, { threadId: string; text: string }>();
  private next = 1;
  async send(threadId: string, text: string): Promise<DeliveryResult> {
    if (this.mode === "refuse") return { delivered: "refused", reason: "HTTP 500" };
    if (this.mode === "idle") {
      this.sent.push({ threadId, text, id: null });
      return { delivered: "sent" };
    }
    const id = `q${this.next++}`;
    this.queue.set(id, { threadId, text });
    this.sent.push({ threadId, text, id });
    return { delivered: "queued", queuedMessageId: id };
  }
  async amend(threadId: string, queuedMessageId: string, text: string): Promise<"amended" | "gone" | { readonly refused: string }> {
    if (this.mode === "refuse") return { refused: "HTTP 500" };
    const row = this.queue.get(queuedMessageId);
    if (row === undefined || row.threadId !== threadId) return "gone";
    this.queue.set(queuedMessageId, { threadId, text });
    return "amended";
  }
  /** The manager's turn ends and the queued message dispatches. */
  dispatch(queuedMessageId: string): void {
    this.queue.delete(queuedMessageId);
  }
}

export class FakeManifests implements ManifestFiles {
  readonly files = new Map<string, string>();
  async read(path: string): Promise<ManifestRead> {
    const text = this.files.get(path);
    return text === undefined ? { status: "missing" } : parseManifest(text);
  }
}

export interface FakeCredentialEntry {
  readonly prefix: string;
  readonly service: ServiceKind;
  readonly token?: string;
  readonly auth?: "token" | "gh" | "glab";
}

export class FakeCredentials implements Credentials {
  private entries: { prefix: Prefix; text: string; service: ServiceKind; token: string; auth: "token" | "gh" | "glab" }[] = [];
  constructor(entries: readonly FakeCredentialEntry[] = []) {
    this.set(entries);
  }
  set(entries: readonly FakeCredentialEntry[]): void {
    this.entries = entries.map((e) => ({ prefix: parsePrefix(e.prefix)!, text: e.prefix, service: e.service, token: e.token ?? `token-for-${e.prefix}`, auth: e.auth ?? "token" }));
  }
  private resolve(entry: (typeof this.entries)[number]): ResolvedCredential {
    return { prefix: entry.text, service: entry.service, auth: entry.auth, baseUrl: "http://127.0.0.1:1", host: "127.0.0.1" };
  }
  private lookup(subject: Parameters<typeof longestMatch>[1], fallback: string): CredentialLookup {
    const found = longestMatch(this.entries, subject);
    return found === null ? { found: false, prefix: fallback } : { found: true, credential: this.resolve(found) };
  }
  forForge(repo: RepoRef): CredentialLookup {
    const found = this.lookup(repoSubject(repo), `${repo.host}/${repo.path}`);
    return found.found && found.credential.service !== "github" && found.credential.service !== "gitlab" ? { found: false, prefix: found.credential.prefix } : found;
  }
  forTracker(tracker: TrackerSpec, repo: RepoRef): CredentialLookup {
    return tracker.kind === "forge-issues" ? this.forForge(repo) : this.lookup(trackerSubject(tracker, repo), tracker.kind);
  }
  async token(credential: ResolvedCredential): Promise<string> {
    const entry = this.entries.find((e) => e.text === credential.prefix);
    if (entry === undefined) throw new Error(`no token for ${credential.prefix}`);
    return entry.token;
  }
  secrets(): string[] {
    return this.entries.map((e) => e.token);
  }
}

/** A session that records what the adapter asks of it and answers nothing: the fake adapter does not use it. */
export class FakeHttp implements Http {
  requestsPerRead: RequestRecord[] = [];
  expiresAt: string | null = null;
  session(credential: ResolvedCredential): HttpSession {
    const records = () => this.requestsPerRead;
    const expiry = () => this.expiresAt;
    return {
      service: credential.service,
      baseUrl: credential.baseUrl,
      request: async () => {
        throw new Error("FakeHttp answers nothing");
      },
      paginate: async () => {
        throw new Error("FakeHttp answers nothing");
      },
      drainRequests: () => records().splice(0),
      expiresAt: expiry,
      noteExpiresAt: () => undefined,
    };
  }
}

/** An adapter that answers each read with the next outcome queued, or throws what was queued. */
export class FakeAdapter implements ServiceAdapter {
  readonly reads: ReadRequest[] = [];
  private readonly script: (ReadOutcome | Error | ((request: ReadRequest) => ReadOutcome | Promise<ReadOutcome>))[] = [];
  constructor(readonly service: ServiceKind) {}
  queue(next: ReadOutcome | Error | ((request: ReadRequest) => ReadOutcome | Promise<ReadOutcome>)): void {
    this.script.push(next);
  }
  async read(request: ReadRequest): Promise<ReadOutcome> {
    this.reads.push(request);
    const next = this.script.shift() ?? { snapshots: [], events: [], updated: [], failures: [] };
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(request) : next;
  }
}
