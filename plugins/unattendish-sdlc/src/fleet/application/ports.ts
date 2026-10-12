// What the Fleet use cases need from the outside, phrased in the context's
// words. Adapters implement these; the use cases name no vendor package.
import type {
  Change,
  ChangeKind,
  Disposition,
  FleetLabels,
  ManifestRead,
  NotWatched,
  OutsideLink,
  ReadOutcome,
  Registration,
  RepoRef,
  ServiceKind,
  Source,
  SourceCursor,
  SourceRole,
  TrackerSpec,
  UnreadableRow,
  WatchedItem,
} from "../domain/model";

// ---- HTTP ----

/**
 * `auth` is a 401: the service does not accept the credential. `forbidden` is a
 * 403 that is not a rate limit: the credential is accepted but may not read
 * this one thing.
 */
export type HttpErrorKind = "auth" | "forbidden" | "rate-limit" | "not-found" | "client" | "server" | "network" | "forbidden-write" | "outside-host";

/**
 * A request that did not return a usable answer. `message` never carries a
 * token, a header or a query string: only the method, the path, the status
 * and the kind.
 */
export class HttpError extends Error {
  constructor(
    readonly kind: HttpErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Milliseconds the service asked to wait, from Retry-After or its rate-limit headers. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface HttpRequest {
  readonly method: "GET" | "POST";
  /** A path under the session's base URL, or an absolute URL on the session's host (a pagination link). */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly headers?: Readonly<Record<string, string>>;
  /** A GraphQL document and variables. Only a POST carries one, and only a query (never a mutation) is sent. */
  readonly graphql?: { readonly query: string; readonly variables?: Readonly<Record<string, unknown>> };
}

export interface HttpResponse {
  readonly status: number;
  /** The parsed JSON body; for a 304 answered from the session's cache, the cached body. */
  readonly json: unknown;
  /** True when the service answered 304 and `json` is the cached body. */
  readonly notModified: boolean;
  /** A response header by name, case-insensitive. */
  readonly header: (name: string) => string | null;
}

export interface RequestRecord {
  readonly method: string;
  /** The path without its query string. */
  readonly path: string;
  readonly status: number | null;
  /** Whether the service counted it against its rate limit. */
  readonly counted: boolean;
  readonly at: string;
}

/**
 * The HTTP layer bound to one credential. It sends the token only to the
 * credential's host, sends only reads, retries what is safe to retry,
 * answers a repeat GET with a conditional request where the service supports
 * one, and keeps an account of every request.
 */
export interface HttpSession {
  readonly service: ServiceKind;
  /** The credential's base URL: the REST root, or the GraphQL endpoint for Linear. */
  readonly baseUrl: string;
  request(request: HttpRequest, options?: { readonly signal?: AbortSignal }): Promise<HttpResponse>;
  /**
   * GET a list and follow `Link: rel="next"` (GitHub, GitLab) for at most
   * `maxPages` pages. `truncated` is true when more pages were left.
   */
  paginate(request: Omit<HttpRequest, "method" | "graphql">, options: { readonly maxPages: number; readonly signal?: AbortSignal }): Promise<{ readonly items: unknown[]; readonly truncated: boolean }>;
  /** The requests made since the last call, then cleared. */
  drainRequests(): RequestRecord[];
  /** When the credential expires, ISO 8601 UTC, where a response (or the adapter, from the service's token endpoint) reported it. */
  expiresAt(): string | null;
  noteExpiresAt(iso: string): void;
}

// ---- service adapters ----

export interface ReadRequest {
  readonly source: Source;
  readonly http: HttpSession;
  /** The items to read one by one: the watched set for this source, and the labelled partition items the cursor holds that a listing might no longer show. */
  readonly items: readonly WatchedItem[];
  /** Of `items`, the ones whose comments and reviews matter. The rest are read for their state and labels only. */
  readonly watchedRefs: ReadonlySet<string>;
  readonly labels: FleetLabels;
  readonly operator: string;
  /** Events on or after this time are read (ISO 8601 UTC). */
  readonly since: string;
  /** Also list the operator's partition: items carrying the spec or ready label, assigned to the operator or filed by them and assigned to nobody. */
  readonly scanPartition: boolean;
  /** Read the state of `items` and nothing else: no events, no listing of updates. */
  readonly stateOnly: boolean;
  readonly signal: AbortSignal;
}

/**
 * One service behind one interface. An adapter reads and normalises; it
 * decides nothing about waking. A read that fails, or lacks a field a change
 * depends on, becomes a `ReadFailure` and no snapshot or event.
 */
export interface ServiceAdapter {
  readonly service: ServiceKind;
  read(request: ReadRequest): Promise<ReadOutcome>;
}

// ---- credentials ----

export interface ResolvedCredential {
  /** The prefix the credential was chosen for, as written. */
  readonly prefix: string;
  readonly service: ServiceKind;
  readonly auth: "token" | "gh" | "glab";
  readonly baseUrl: string;
  /** The one host the token may be sent to. */
  readonly host: string;
}

/** A source and the credential chosen for it. */
export interface ResolvedSource {
  readonly credential: ResolvedCredential;
  readonly source: Source;
}

export type CredentialLookup =
  | { readonly found: true; readonly credential: ResolvedCredential }
  | { readonly found: false; readonly prefix: string };

export interface Credentials {
  /** The credential for a fleet's forge: the longest chosen prefix matching its repository. Its service is `github` or `gitlab`, else the lookup finds none. */
  forForge(repo: RepoRef): CredentialLookup;
  /** The credential for a fleet's tracker, chosen separately: the forge's own for `forge-issues`, else the longest prefix matching the Linear team or Jira project. */
  forTracker(tracker: TrackerSpec, repo: RepoRef): CredentialLookup;
  /** The token for a credential: the pasted one, or what `gh` or `glab` prints. Never logged. Rejects when none can be had. */
  token(credential: ResolvedCredential): Promise<string>;
  /** Every token configured, so text can be scrubbed of them. */
  secrets(): string[];
}

export interface Http {
  session(credential: ResolvedCredential, token: string): HttpSession;
}

// ---- the manifest file ----

export interface ManifestFiles {
  /** Reads and parses the file; `missing` when it does not exist yet. */
  read(path: string): Promise<ManifestRead>;
}

// ---- threads ----

export interface ThreadDirectory {
  /** `gone` for a thread bb no longer lists or has deleted. */
  state(threadId: string): Promise<"live" | "archived" | "gone">;
}

export type DeliveryResult =
  | { readonly delivered: "sent" }
  | { readonly delivered: "queued"; readonly queuedMessageId: string }
  | { readonly delivered: "refused"; readonly reason: string };

export interface ManagerChannel {
  /** Sends the wake as a plain message that waits behind a running turn and never steers it. */
  send(threadId: string, text: string): Promise<DeliveryResult>;
  /** Replaces the text of a wake still waiting in bb's queue. `gone` when it already dispatched or was deleted. */
  amend(threadId: string, queuedMessageId: string, text: string): Promise<"amended" | "gone" | { readonly refused: string }>;
}

// ---- clock ----

export interface Clock {
  now(): Date;
}

// ---- the store: registrations, cursors, the ledger ----

export interface StoredFleet {
  readonly registration: Registration;
  /** ISO 8601 UTC of the last poll that ran, whether or not its cursors advanced. */
  readonly lastPolledAt: string | null;
  /** Why the fleet is not (fully) watched, as of the last poll or registration. Empty while watched. */
  readonly notWatched: readonly NotWatched[];
  /** Set while a credential is refused: when the outage began, and the prefix. */
  readonly refused: { readonly since: string; readonly prefix: string; readonly announced: boolean } | null;
  readonly unreadableRows: readonly UnreadableRow[];
  readonly outsideLinks: readonly OutsideLink[];
  /** The tokens' expiry dates reported by the services, by credential prefix. */
  readonly expiries: Readonly<Record<string, string | null>>;
  /** When no manager held the fleet, the time the first change was held; null otherwise. */
  readonly heldSince: string | null;
}

export type WakeKind = "changes" | "not-watched";

export interface StoredWake {
  readonly id: number;
  readonly repo: string;
  readonly kind: WakeKind;
  readonly threadId: string;
  /** The queued message that carries it, while it waits in bb's queue. */
  readonly queuedMessageId: string | null;
  readonly queuedAt: string;
  readonly dispatchedAt: string | null;
  /** The earliest time its changes run from (ISO 8601 UTC). */
  readonly since: string;
  readonly catchUpMs: number | null;
  readonly heldSince: string | null;
  /** The "not watched since" line the wake carries, kept so it is worded again whenever the queued wake is amended. */
  readonly notWatched: { readonly since: string; readonly prefix: string } | null;
}

export interface LedgerRow {
  readonly key: string;
  readonly role: SourceRole;
  readonly ref: string;
  readonly url: string;
  readonly kind: ChangeKind | "updated";
  readonly label: string | null;
  readonly actor: string | null;
  /** When it happened on the service. */
  readonly at: string;
  /** When the plugin saw it. */
  readonly seenAt: string;
  readonly disposition: Disposition["kind"];
  /** The echo rule, or the hold reason. */
  readonly rule: string | null;
  readonly wakeId: number | null;
}

export type LedgerEntry =
  | { readonly type: "change"; readonly row: LedgerRow }
  | { readonly type: "wake"; readonly wake: StoredWake }
  | { readonly type: "poll"; readonly poll: PollRecord }
  | { readonly type: "failed read"; readonly at: string; readonly role: SourceRole; readonly ref: string | null; readonly reason: string };

export interface PollRecord {
  readonly at: string;
  readonly role: SourceRole;
  readonly requests: readonly { readonly method: string; readonly path: string; readonly status: number | null; readonly counted: boolean }[];
  readonly counted: number;
  readonly ok: boolean;
}

export interface LedgerQuery {
  /** A reference (`#163`) or an item URL. */
  readonly item?: string;
  readonly done?: "woke" | "echo" | "out-of-scope" | "held" | "failed read";
  readonly limit?: number;
}

/** What a poll commits once it is settled: the cursors, and what it saw. Applied in one transaction. */
export interface PollCommit {
  readonly repo: string;
  readonly at: string;
  readonly cursors: readonly { readonly role: SourceRole; readonly cursor: SourceCursor }[];
}

export interface Store {
  getFleet(repo: string): StoredFleet | null;
  listFleets(): StoredFleet[];
  /** Registers or re-registers; keeps the cursors, the ledger and the poll state of a repository already held. */
  saveRegistration(registration: Registration, notWatched: readonly NotWatched[]): void;
  /** Deletes the registration and the cursors; the ledger (changes, failed reads, polls, wakes) stays until retention ages it out. Says whether a fleet was registered. */
  removeFleet(repo: string): boolean;
  setIntervalMs(repo: string, intervalMs: number | null): void;
  /** Records the state of the last poll: its time, why the fleet is not watched, what the manifest could not give. */
  savePollState(
    repo: string,
    state: Pick<StoredFleet, "lastPolledAt" | "notWatched" | "unreadableRows" | "outsideLinks" | "expiries" | "heldSince"> & { readonly refused?: StoredFleet["refused"] | undefined },
  ): void;
  markRefusedAnnounced(repo: string): void;

  getCursor(repo: string, role: SourceRole): SourceCursor | null;
  /** Commits cursors. Never called before bb accepted the wake carrying their changes. */
  commit(commit: PollCommit): void;

  /** The ledger's disposition for each key already recorded, for the keys given. */
  dispositions(repo: string, keys: readonly string[]): Map<string, Disposition["kind"]>;
  /** Inserts a change seen for the first time, or updates the disposition of a held one. Keyed by (repo, key). */
  recordChange(repo: string, row: Omit<LedgerRow, "wakeId">): void;
  /** Rows recorded as held for no manager, oldest first. */
  heldChanges(repo: string): Change[];
  recordFailedRead(repo: string, entry: { readonly at: string; readonly role: SourceRole; readonly ref: string | null; readonly reason: string }): void;
  recordPoll(repo: string, poll: PollRecord): void;
  requestsSince(repo: string, since: string): number;

  /** `dispatchedAt` is set for a wake bb sent at once, and left out for one waiting in bb's queue. */
  createWake(repo: string, wake: Omit<StoredWake, "id" | "repo" | "dispatchedAt"> & { readonly dispatchedAt?: string | null }): StoredWake;
  /** The latest wake, of either kind, still waiting in bb's queue, if any. */
  openWake(repo: string): StoredWake | null;
  markWoke(repo: string, wakeId: number, keys: readonly string[]): void;
  /** Keys of the changes a wake carries. */
  wakeChanges(repo: string, wakeId: number): Change[];
  setWakeQueuedMessage(repo: string, wakeId: number, queuedMessageId: string | null): void;
  /** Records what an amendment made of a queued wake: its kind, and the lines it now carries. */
  updateWake(repo: string, wakeId: number, update: Pick<StoredWake, "kind" | "heldSince" | "notWatched">): void;
  markDispatched(queuedMessageId: string, at: string): void;

  ledger(repo: string, query: LedgerQuery): LedgerEntry[];
  /** Deletes ledger rows older than the cutoff. */
  prune(before: string): void;
}
