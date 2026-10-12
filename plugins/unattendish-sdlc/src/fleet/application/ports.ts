// What the Fleet use cases need from the outside, phrased in the context's
// words. Adapters implement these; the use cases name no vendor package.
import type { ActionRecord } from "../domain/actions";
import type {
  Change,
  ChangeKind,
  Disposition,
  FleetLabels,
  ManifestRead,
  NotWatched,
  OutsideLink,
  ReadOutcome,
  RefusedWhy,
  Registration,
  RepoRef,
  ServiceKind,
  Source,
  SourceCursor,
  SourceRole,
  TrackerSpec,
  UnreadableRow,
  WatchedItem,
  WrittenSection,
} from "../domain/model";
import type { CredentialDraft, InboxNewSignal } from "./views";

// ---- HTTP ----

/**
 * `auth` is a 401: the service does not accept the credential. `forbidden` is a
 * 403 that is not a rate limit: the credential is accepted but may not read
 * this thing; where it may read nothing a source needs, poll after poll, the
 * fleet is not watched.
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
    /**
     * For a GraphQL query answered with a status outside 2xx whose body is JSON: the `extensions.type` and
     * `extensions.code` of each entry of its `errors`, each a string cut to 64 characters or null. Never a message
     * or any other field of the body.
     */
    readonly graphql?: readonly { readonly type: string | null; readonly code: string | null }[],
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
  /**
   * A path prefix, such as `/repos/{owner}/{repo}/`, that the request, a redirect it meets and a pagination link must
   * stay under. It is read after the credential's base path and compared without regard to case. A GitHub pagination
   * link may also be under `/repositories/{digits}/`, the form GitHub writes its links in. A target outside it throws an
   * `HttpError` of kind `outside-host`, whose message names no query and no token.
   */
  readonly stayUnder?: string;
  /**
   * The request reads one page of a list. A page whose last answer carried no `Link` to a next page is requested
   * without a conditional header: a list that grew by a page since then can answer 304 for that unchanged last page,
   * and the new page after it would never be found.
   */
  readonly list?: boolean;
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
  /**
   * Read the state of `items`, with the transitions since `since` that gave it, and nothing else: no events, no
   * listing of updates. The transitions let the baseline be the state before them, so they are still reported.
   */
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
  /** The same read, with every section the plugin does not read by column as written, for the Fleet tab. */
  readSections(path: string): Promise<{ readonly read: ManifestRead; readonly written: readonly WrittenSection[] }>;
}

// ---- threads ----

/** What bb says of a thread: gone or archived, or live and at work or idle (since when, where bb says). */
export type ThreadStanding =
  | { readonly state: "gone" | "archived" }
  | { readonly state: "live"; readonly busy: boolean; /** ISO 8601 UTC. */ readonly since: string | null };

export interface ThreadDirectory {
  /** `gone` for a thread bb no longer lists or has deleted. */
  state(threadId: string): Promise<"live" | "archived" | "gone">;
  standing(threadId: string): Promise<ThreadStanding>;
}

/** Where a thread's code lives, as far as bb knows it. */
export interface ThreadRepositories {
  /** The git remote URL of the thread's project; null where bb offers none, and for a thread bb does not know. */
  remoteOf(threadId: string): Promise<string | null>;
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

// ---- what the dashboard reads and says ----

/** What a manager thread's tree has cost: the total from Thread Usage, or null where it is not installed or its answer cannot be read. */
export interface CostReader {
  costOf(threadId: string): Promise<{ readonly amount: number; readonly currency: string } | null>;
}

/** Tells every open bb window that something the pages show changed, or that an Inbox row is new. */
export interface DashboardEvents {
  boardChanged(): void;
  inboxNew(signal: InboxNewSignal): void;
}

export interface CredentialAdminEntry {
  readonly prefix: string;
  readonly auth: "token" | "gh" | "glab";
  readonly service: string | null;
  readonly baseUrl: string | null;
  /** A pasted token is stored for the prefix. */
  readonly hasToken: boolean;
  /** Why the entry cannot be used; null when it can. */
  readonly problem: string | null;
}

/** Edits the `credentials` and `tokens` settings by the rules their form validates with. Never returns a token. */
export interface CredentialAdmin {
  list(): Promise<{ readonly entries: readonly CredentialAdminEntry[]; readonly problems: readonly string[] }>;
  save(draft: CredentialDraft): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  remove(prefix: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

// ---- clock ----

export interface Clock {
  now(): Date;
}

// ---- the store: registrations, cursors, the ledger ----

/**
 * What the polls found of one source's reads: kept per source, and left as it was by a poll that did not read the
 * source (rate limited, skipped, no token), so another source reading does not end it.
 */
export interface SourceOutage {
  /** How many polls in a row found the source unreadable; `UNREADABLE_POLLS` of them make the fleet not watched. */
  readonly unreadablePolls: number;
  /** When the first of those polls ran (ISO 8601 UTC), which the fleet is not watched since; null while none did. */
  readonly unreadableSince: string | null;
  /** Set while the source's credential counts as refused: when the fleet stopped being watched, the prefix, why, and whether a wake has said so. */
  readonly refused: { readonly since: string; readonly prefix: string; readonly announced: boolean; readonly why: RefusedWhy } | null;
}

/**
 * The outages a store keeps when a poll saves `next` over `stored`: `next`, with each source's `announced` taken from
 * `stored` while its refusal's `since` and `prefix` stay the same, and false for any other refusal.
 */
export const keptAnnounced = (
  stored: StoredFleet["outages"],
  next: StoredFleet["outages"],
): Partial<Record<SourceRole, SourceOutage>> => {
  const kept: Partial<Record<SourceRole, SourceOutage>> = {};
  for (const role of ["forge", "tracker"] as const) {
    const outage = next[role];
    if (outage === undefined) continue;
    const before = stored[role]?.refused ?? null;
    const refused = outage.refused;
    const announced = refused !== null && before !== null && before.since === refused.since && before.prefix === refused.prefix ? before.announced : (refused?.announced ?? false);
    kept[role] = { unreadablePolls: outage.unreadablePolls, unreadableSince: outage.unreadableSince, refused: refused === null ? null : { since: refused.since, prefix: refused.prefix, announced, why: refused.why } };
  }
  return kept;
};

export interface StoredFleet {
  readonly registration: Registration;
  /** ISO 8601 UTC of the last poll that ran, whether or not its cursors advanced. */
  readonly lastPolledAt: string | null;
  /** Why the fleet is not (fully) watched, as of the last poll or registration. Empty while watched. */
  readonly notWatched: readonly NotWatched[];
  /** Each source's outage, by its role; a source absent here reads, or has never been found unreadable. */
  readonly outages: Readonly<Partial<Record<SourceRole, SourceOutage>>>;
  /** The catch-up a wake bb refused carried, owed to the next wake bb accepts; null when none is owed. */
  readonly pendingCatchUpMs: number | null;
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
  readonly notWatched: { readonly since: string; readonly prefix: string; readonly why: RefusedWhy } | null;
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
  /**
   * Records the state of the last poll: its time, why the fleet is not watched, what the manifest could not give, and
   * each source's outage, which replaces those stored. A source's refusal keeps the `announced` stored for it while
   * its `since` and `prefix` stay the same.
   */
  savePollState(
    repo: string,
    state: Pick<StoredFleet, "lastPolledAt" | "notWatched" | "unreadableRows" | "outsideLinks" | "expiries" | "heldSince" | "outages" | "pendingCatchUpMs">,
  ): void;
  /** Marks the refusal of the source in `role` as said by a wake; nothing while that source's credential is not refused. */
  markRefusedAnnounced(repo: string, role: SourceRole): void;

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
  updateWake(repo: string, wakeId: number, update: Pick<StoredWake, "kind" | "catchUpMs" | "heldSince" | "notWatched">): void;
  markDispatched(queuedMessageId: string, at: string): void;

  ledger(repo: string, query: LedgerQuery): LedgerEntry[];
  /** The latest wakes of a repository, newest first. */
  recentWakes(repo: string, limit: number): StoredWake[];
  /** Deletes ledger rows, and Inbox rows not seen since, older than the cutoff. */
  prune(before: string): void;

  // ---- actions the dashboard sent ----

  /** Records an action as sent. */
  saveAction(action: ActionRecord): void;
  /** Every action kept for a repository, oldest first. */
  actions(repo: string): ActionRecord[];
  /** Marks sent actions done at `at`; one already done stays as it was. */
  markActionsDone(repo: string, ids: readonly string[], at: string): void;
  /** Drops the actions still sent on a repository: the manager they were sent to no longer holds it. */
  dropSentActions(repo: string): void;
  /** Deletes done actions finished before the cutoff, and every action of a repository no fleet is registered for. */
  pruneActions(doneBefore: string): void;

  // ---- Inbox rows seen ----

  /** The ids of the Inbox rows ever recorded for a repository (not per manager). */
  inboxSeen(repo: string): Set<string>;
  /** Records Inbox rows as seen at `at`, those already recorded kept and their time moved. */
  touchInboxSeen(repo: string, ids: readonly string[], at: string): void;
  /** Whether the repository's Inbox has been read once since it was registered, so that a new row is news. */
  inboxBaselined(repo: string): boolean;
  setInboxBaselined(repo: string): void;
}
