// Fakes for the ports the use cases need, for tests that run on fakes alone.
import { longestMatch, parsePrefix, repoSubject, trackerSubject, type Prefix } from "../domain/identity";
import { parseManifest, writtenSections } from "../domain/manifest";
import type { ManifestRead, RepoRef, ReadOutcome, ServiceKind, TrackerSpec, WrittenSection } from "../domain/model";
import type { FleetNeedsSignal, InboxNewSignal } from "../application/views";
import type { LoginStatus } from "../application/accounts";
import type { Half } from "../domain/accounts";
import {
  CredentialUnavailable,
  type CliLogins,
  type Identified,
  type ProbeTarget,
  type ServiceProbe,
} from "../application/ports";
import type {
  Clock,
  CostReader,
  Credentials,
  CredentialLookup,
  DeliveryResult,
  Http,
  HttpSession,
  ManagerChannel,
  ManifestFiles,
  DashboardEvents,
  ReadRequest,
  RequestRecord,
  ResolvedCredential,
  ServiceAdapter,
  ThreadDirectory,
  ThreadRepositories,
  ThreadStanding,
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
  /** Of a live thread: at work or idle, and since when. A live thread not listed is idle since an unknown time. */
  readonly activity = new Map<string, { busy: boolean; since: string | null }>();
  /** Threads whose standing bb fails to answer for, as a timeout or a 5xx would. */
  readonly unanswered = new Set<string>();
  async state(threadId: string): Promise<"live" | "archived" | "gone"> {
    return this.states.get(threadId) ?? "gone";
  }
  async standing(threadId: string): Promise<ThreadStanding> {
    if (this.unanswered.has(threadId)) throw new Error("bb did not answer");
    const state = await this.state(threadId);
    return state === "live" ? { state, ...(this.activity.get(threadId) ?? { busy: false, since: null }) } : { state };
  }
}

/** The git remote of the project each thread belongs to. */
export class FakeRepositories implements ThreadRepositories {
  readonly remotes = new Map<string, string>();
  async remoteOf(threadId: string): Promise<string | null> {
    return this.remotes.get(threadId) ?? null;
  }
}

/** What Thread Usage would say of each thread's tree; a thread not listed has no cost. */
export class FakeCost implements CostReader {
  readonly costs = new Map<string, { amount: number; currency: string }>();
  readonly asked: string[] = [];
  async costOf(threadId: string): Promise<{ amount: number; currency: string } | null> {
    this.asked.push(threadId);
    return this.costs.get(threadId) ?? null;
  }
}

/** What reached the open bb windows. */
export class FakeEvents implements DashboardEvents {
  boardChanges = 0;
  readonly inboxNews: InboxNewSignal[] = [];
  readonly needs: FleetNeedsSignal[] = [];
  boardChanged(): void {
    this.boardChanges += 1;
  }
  inboxNew(signal: InboxNewSignal): void {
    this.inboxNews.push(signal);
  }
  fleetNeeds(signal: FleetNeedsSignal): void {
    this.needs.push(signal);
  }
}

/** bb's queue as the manager sees it: idle sends at once, busy queues, refusing refuses. */
export class FakeChannel implements ManagerChannel {
  mode: "idle" | "busy" | "refuse" = "idle";
  /** What a refused send or amendment says. */
  refusal = "HTTP 500";
  /** The status alone of a refusal, which is all a log may carry. */
  refusalStatus = "HTTP 500";
  readonly sent: { threadId: string; text: string; id: string | null }[] = [];
  readonly queue = new Map<string, { threadId: string; text: string }>();
  private next = 1;
  async send(threadId: string, text: string): Promise<DeliveryResult> {
    if (this.mode === "refuse") return { delivered: "refused", status: this.refusalStatus, reason: this.refusal };
    if (this.mode === "idle") {
      this.sent.push({ threadId, text, id: null });
      return { delivered: "sent" };
    }
    const id = `q${this.next++}`;
    this.queue.set(id, { threadId, text });
    this.sent.push({ threadId, text, id });
    return { delivered: "queued", queuedMessageId: id };
  }
  async amend(threadId: string, queuedMessageId: string, text: string): Promise<"amended" | "gone" | { readonly refused: string; readonly status: string }> {
    if (this.mode === "refuse") return { refused: this.refusal, status: this.refusalStatus };
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
  async readSections(path: string): Promise<{ read: ManifestRead; written: readonly WrittenSection[] }> {
    const text = this.files.get(path);
    const read = await this.read(path);
    return { read, written: text !== undefined && read.status === "ok" ? writtenSections(text) : [] };
  }
}

export interface FakeCredentialEntry {
  readonly prefix: string;
  readonly service: ServiceKind;
  readonly token?: string;
  readonly auth?: "token" | "gh" | "glab";
}

/**
 * Credentials chosen by prefix, the longest that matches, as a stand-in for accounts and assignments: each entry is a
 * credential whose key, label and account are its prefix. A miss needs `No credential is chosen for <what>`.
 */
export class FakeCredentials implements Credentials {
  private entries: { prefix: Prefix; text: string; service: ServiceKind; token: string; auth: "token" | "gh" | "glab" }[] = [];
  /** By prefix: why no token can be had, for a credential found that cannot give one. */
  readonly unavailable = new Map<string, string>();
  constructor(entries: readonly FakeCredentialEntry[] = []) {
    this.set(entries);
  }
  set(entries: readonly FakeCredentialEntry[]): void {
    this.entries = entries.map((e) => ({ prefix: parsePrefix(e.prefix)!, text: e.prefix, service: e.service, token: e.token ?? `token-for-${e.prefix}`, auth: e.auth ?? "token" }));
  }
  private resolve(entry: (typeof this.entries)[number]): ResolvedCredential {
    return {
      key: entry.text,
      label: entry.text,
      accountId: `account:${entry.text}`,
      accountLabel: entry.text,
      service: entry.service,
      auth: entry.auth,
      kind: entry.auth === "token" ? "fine-grained" : entry.auth,
      baseUrl: "http://127.0.0.1:1",
      host: "127.0.0.1",
    };
  }
  private lookup(subject: Parameters<typeof longestMatch>[1], what: string): CredentialLookup {
    const found = longestMatch(this.entries, subject);
    return found === null ? { found: false, account: null, need: `No credential is chosen for ${what}` } : { found: true, credential: this.resolve(found) };
  }
  forForge(repo: RepoRef): CredentialLookup {
    const found = this.lookup(repoSubject(repo), `${repo.host}/${repo.path}`);
    return found.found && found.credential.service !== "github" && found.credential.service !== "gitlab" ? { found: false, account: null, need: `No credential is chosen for ${repo.host}/${repo.path}` } : found;
  }
  forTracker(tracker: TrackerSpec, repo: RepoRef): CredentialLookup {
    return tracker.kind === "forge-issues" ? this.forForge(repo) : this.lookup(trackerSubject(tracker, repo), `the tracker ${tracker.kind === "linear" ? `linear:${tracker.team}` : `jira:${tracker.site}/${tracker.project}`}`);
  }
  async token(credential: ResolvedCredential): Promise<string> {
    const why = this.unavailable.get(credential.key);
    if (why !== undefined) throw new CredentialUnavailable(why);
    const entry = this.entries.find((e) => e.text === credential.key);
    if (entry === undefined) throw new Error(`no token for ${credential.label}`);
    return entry.token;
  }
  secrets(): string[] {
    return this.entries.map((e) => e.token);
  }
}

/** A service that knows whose each token is, and what each token can read by the half's `what`. */
export class FakeProbe implements ServiceProbe {
  /** By token: whose it is, or how the service answers. */
  readonly owners = new Map<string, Identified>();
  /** By token, then by the half's `what`: how a read fails; a pair not listed reads. */
  readonly unreadable = new Map<string, Map<string, "not-found" | "forbidden" | "unreachable">>();
  readonly identified: { target: ProbeTarget; token: string }[] = [];
  readonly reads: { target: ProbeTarget; token: string; what: string }[] = [];
  async identify(target: ProbeTarget, token: string): Promise<Identified> {
    this.identified.push({ target, token });
    return this.owners.get(token) ?? { ok: false, why: "refused", reason: "the service rejected the token" };
  }
  async canRead(target: ProbeTarget, token: string, half: Half): Promise<"readable" | "not-found" | "forbidden" | "unreachable"> {
    this.reads.push({ target, token, what: half.what });
    return this.unreadable.get(token)?.get(half.what) ?? "readable";
  }
}

/** The operator's `gh` and `glab` logins: by tool and host, each login's token. */
export class FakeLogins implements CliLogins {
  readonly tokens = new Map<string, string>();
  readonly asked: string[] = [];
  set(tool: "gh" | "glab", host: string, login: string, token: string): void {
    this.tokens.set(`${tool} ${host} ${login}`, token);
  }
  async logins(tool: "gh" | "glab", host: string): Promise<string[]> {
    return [...this.tokens.keys()].filter((key) => key.startsWith(`${tool} ${host} `)).map((key) => key.split(" ")[2]!);
  }
  async token(tool: "gh" | "glab", host: string, login: string): Promise<string> {
    this.asked.push(`${tool} ${host} ${login}`);
    const token = this.tokens.get(`${tool} ${host} ${login}`);
    if (token === undefined) throw new CredentialUnavailable(`${tool} gave no token for ${login} on ${host}`);
    return token;
  }
}

export class FakeLoginStatus implements LoginStatus {
  readonly problems = new Map<string, string>();
  readonly forgotten: string[] = [];
  loginProblem(accountId: string): string | null {
    return this.problems.get(accountId) ?? null;
  }
  forget(accountId: string): void {
    this.forgotten.push(accountId);
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
