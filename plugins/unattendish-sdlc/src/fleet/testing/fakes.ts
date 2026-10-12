// Fakes for the ports the use cases need, for tests that run on fakes alone.
import { longestMatch, parsePrefix, repoSubject, trackerSubject, type Prefix } from "../domain/identity";
import { parseManifest, writtenSections } from "../domain/manifest";
import type { ManifestRead, RepoRef, ReadOutcome, ServiceKind, TrackerSpec, WrittenSection } from "../domain/model";
import type { InboxNewSignal } from "../application/views";
import type {
  Clock,
  CostReader,
  CredentialAdmin,
  CredentialAdminEntry,
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
  async state(threadId: string): Promise<"live" | "archived" | "gone"> {
    return this.states.get(threadId) ?? "gone";
  }
  async standing(threadId: string): Promise<ThreadStanding> {
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
  boardChanged(): void {
    this.boardChanges += 1;
  }
  inboxNew(signal: InboxNewSignal): void {
    this.inboxNews.push(signal);
  }
}

/** The credential settings as a list; it validates only that a prefix is given and not twice, which is as far as the use cases ask. */
export class FakeCredentialAdmin implements CredentialAdmin {
  readonly entries: CredentialAdminEntry[] = [];
  problems: string[] = [];
  async list() {
    return { entries: this.entries.map((entry) => ({ ...entry })), problems: [...this.problems] };
  }
  async save(draft: Parameters<CredentialAdmin["save"]>[0]) {
    if (draft.prefix.trim() === "") return { ok: false as const, reason: "the prefix is empty" };
    const was = draft.was ?? draft.prefix;
    const at = this.entries.findIndex((entry) => entry.prefix === was);
    if (draft.was === undefined && at !== -1) return { ok: false as const, reason: "that prefix is already given" };
    const entry: CredentialAdminEntry = { prefix: draft.prefix, auth: draft.auth, service: draft.service ?? null, baseUrl: draft.baseUrl ?? null, hasToken: draft.token !== undefined || (at !== -1 && this.entries[at]!.hasToken), problem: null };
    if (at === -1) this.entries.push(entry);
    else this.entries[at] = entry;
    return { ok: true as const };
  }
  async remove(prefix: string) {
    const at = this.entries.findIndex((entry) => entry.prefix === prefix);
    if (at === -1) return { ok: false as const, reason: "no such credential" };
    this.entries.splice(at, 1);
    return { ok: true as const };
  }
}

/** bb's queue as the manager sees it: idle sends at once, busy queues, refusing refuses. */
export class FakeChannel implements ManagerChannel {
  mode: "idle" | "busy" | "refuse" = "idle";
  /** What a refused send or amendment says. */
  refusal = "HTTP 500";
  readonly sent: { threadId: string; text: string; id: string | null }[] = [];
  readonly queue = new Map<string, { threadId: string; text: string }>();
  private next = 1;
  async send(threadId: string, text: string): Promise<DeliveryResult> {
    if (this.mode === "refuse") return { delivered: "refused", reason: this.refusal };
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
    if (this.mode === "refuse") return { refused: this.refusal };
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
