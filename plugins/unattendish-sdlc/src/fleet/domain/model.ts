// The Fleet context's words as types. Nothing here imports anything: the
// domain names no framework, driver or service client.

export const CONTRACT_VERSION = 1;

/** The services the plugin can read. */
export type ServiceKind = "github" | "gitlab" | "linear" | "jira";

/** A fleet reads at most two sources: its forge, and its tracker where that is a separate service. */
export type SourceRole = "forge" | "tracker";

/** A repository as the manifest's first line spells it: `host/path`. The host is lower case. */
export interface RepoRef {
  readonly host: string;
  readonly path: string;
}

/** What `--tracker` names: the forge's own issues, a Linear team, or a Jira project. */
export type TrackerSpec =
  | { readonly kind: "forge-issues" }
  | { readonly kind: "linear"; readonly team: string }
  | { readonly kind: "jira"; readonly site: string; readonly project: string };

/** Where one source reads from. The fleet's forge is always a source; its tracker is one only when separate. */
export type Source =
  | { readonly role: "forge"; readonly service: "github" | "gitlab"; readonly host: string; readonly path: string }
  | { readonly role: "tracker"; readonly service: "linear"; readonly team: string }
  | { readonly role: "tracker"; readonly service: "jira"; readonly site: string; readonly project: string };

/** The four labels a fleet registers, spelled as the service spells them. */
export interface FleetLabels {
  readonly spec: string;
  readonly ready: string;
  readonly inProgress: string;
  readonly needsInput: string;
}

/** The plugin's record that a manager thread holds a repository, with what it registered. */
export interface Registration {
  readonly repo: RepoRef;
  readonly managerThreadId: string;
  readonly tracker: TrackerSpec;
  readonly manifestPath: string;
  readonly operator: string;
  readonly labels: FleetLabels;
  readonly marker: string;
  readonly echoActors: readonly string[];
  readonly contract: number;
  /** Null while the default applies. */
  readonly intervalMs: number | null;
  /** ISO 8601 UTC. */
  readonly registeredAt: string;
}

/** Why a fleet is not (fully) watched: `code` is the contract's, `text` says it for a person, naming the prefix or path. */
export type NotWatchedCode = "manifest-missing" | "manifest-unreadable" | "no-credential" | "credential-refused";
export interface NotWatched {
  readonly code: NotWatchedCode;
  readonly text: string;
  /** The half a credential reason is about; absent for a manifest reason. */
  readonly role?: SourceRole;
}

/**
 * How every read of a source failed: forbidden with a 403 (`forbidden`), with no answer (`unreachable`), with a 404
 * (`not-found`, which is also how a service may answer for a private repository the token cannot see), or by finding
 * what it read outside the fleet's repository, project or team (`outside-fleet`).
 */
export type UnreadableWhy = "forbidden" | "unreachable" | "not-found" | "outside-fleet";

/**
 * Why a source's credential counts as refused: the service answered 401 (`refused`), every read failed as
 * `UnreadableWhy` says, or a listing of what changed failed for any reason but being cut off at its page limit,
 * whatever else read (`listing-failed`).
 */
export type RefusedWhy = "refused" | "listing-failed" | UnreadableWhy;

// ---- the manifest, as the plugin reads it ----

export type WaitsFor = "answer" | "grant" | "ready" | "other";
export type Stage = "building" | "asking" | "waiting on you" | "under review" | "at the bar" | "round open" | "brainstorming";

export interface InboxRow {
  readonly ref: string;
  readonly what: string;
  readonly waitsFor: WaitsFor;
  readonly since: string;
  readonly link: string;
  /** 1-based line of the row in the manifest file; absent on a row built by hand. */
  readonly line?: number;
}
export interface InFlightRow {
  readonly ref: string;
  readonly work: string;
  readonly stage: Stage;
  readonly since: string;
  readonly builder: string;
  readonly link: string;
  /** 1-based line of the row in the manifest file; absent on a row built by hand. */
  readonly line?: number;
}
export interface BlockedRow {
  readonly ref: string;
  readonly blockedOn: readonly string[];
  readonly link: string;
  /** 1-based line of the row in the manifest file; absent on a row built by hand. */
  readonly line?: number;
}
export interface LandedRow {
  readonly ref: string;
  readonly spec: string;
  readonly merged: string;
  readonly link: string;
  /** 1-based line of the row in the manifest file; absent on a row built by hand. */
  readonly line?: number;
}

/** A row the plugin cannot read by the contract: skipped, and named in the fleet's status. */
export interface UnreadableRow {
  /** The section's heading, such as `In flight`. */
  readonly section: string;
  /** 1-based line of the row in the file. */
  readonly line: number;
  readonly reason: string;
}

export interface Manifest {
  /** The first line's `host/path`. */
  readonly repo: string;
  readonly inbox: readonly InboxRow[];
  readonly inFlight: readonly InFlightRow[];
  readonly blocked: readonly BlockedRow[];
  readonly landed: readonly LandedRow[];
  readonly unreadable: readonly UnreadableRow[];
}

/** A section the plugin does not read by column: its heading as written and its Markdown as written. */
export interface WrittenSection {
  readonly heading: string;
  readonly markdown: string;
}

/** What reading the manifest file gave. */
export type ManifestRead =
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly reason: string }
  | { readonly status: "ok"; readonly manifest: Manifest };

// ---- what is watched ----

/**
 * An item whose changes can wake the manager. `ref` is the reference the
 * service uses for it and is unique in its source: `#163` (a GitHub issue or
 * pull request, a GitLab issue), `!45` (a GitLab merge request), `ENG-212`,
 * `PROJ-12`.
 */
export interface WatchedItem {
  readonly role: SourceRole;
  readonly ref: string;
  /** The URL the manifest gave, or null when only a Ref named it. */
  readonly url: string | null;
}

/** A manifest link or reference the plugin never fetches, because it lies outside the fleet's repository and tracker. */
export interface OutsideLink {
  readonly text: string;
  readonly section: string;
  readonly line: number;
}

export interface WatchedSet {
  readonly items: readonly WatchedItem[];
  readonly outside: readonly OutsideLink[];
}

/** `forge:#163`: the key an item is stored under, unique within a fleet. */
export type ItemId = string;
export const itemId = (role: SourceRole, ref: string): ItemId => `${role}:${ref}`;

// ---- what a source read says ----

/** A transition the service's own timeline reports, which gives a state or label change its actor, time and id. */
export interface Transition {
  readonly kind: "closed" | "reopened" | "merged" | "labelled" | "unlabelled";
  /** The label, as registered, for `labelled` and `unlabelled`. */
  readonly label?: string;
  readonly actor: string | null;
  /** ISO 8601 UTC. */
  readonly at: string;
  /** The service's id for the event, which keeps the change's key stable. */
  readonly id: string;
  /** Other names the service knows the actor by (an email, a handle), compared to the registered echo actors and never sent. */
  readonly actorAliases?: readonly string[];
}

/** One item as a source read it now. */
export interface ItemSnapshot {
  readonly role: SourceRole;
  readonly ref: string;
  /** The item's URL on the service, from the service. */
  readonly url: string;
  readonly open: boolean;
  readonly merged: boolean;
  /** Which of the four registered labels the item carries, as registered. */
  readonly fleetLabels: readonly string[];
  /** Assigned to the operator, or filed by them and assigned to nobody. */
  readonly inPartition: boolean;
  readonly transitions: readonly Transition[];
  /**
   * Where the service keeps the reviewers' states on the item rather than as events of their own (GitLab): the state
   * each reviewer's review is in now. A change of one is a review, keyed as a change with no transition id is.
   */
  readonly reviewers?: readonly { readonly actor: string; readonly state: "approved" | "changes requested" | "commented" }[];
}

export type ActivityKind = "commented" | "reviewed: approved" | "reviewed: changes requested" | "reviewed: commented";

/** A comment or review on a watched item. Never carries the text written on the service beyond `lastLine`. */
export interface ActivityEvent {
  /** The service's id for it, such as `github:issuecomment:1234`; stable across polls. */
  readonly id: string;
  readonly role: SourceRole;
  readonly ref: string;
  readonly url: string;
  readonly kind: ActivityKind;
  readonly actor: string | null;
  readonly at: string;
  /** The last non-blank line of the body, cut to 500 characters, for the marker test. Null where the body is empty. */
  readonly lastLine: string | null;
  /** Other names the service knows the actor by, as for `Transition`. */
  readonly actorAliases?: readonly string[];
}

/** An item the service listed as updated since the cursor and that the source did not read further. */
export interface UpdatedItem {
  readonly role: SourceRole;
  readonly ref: string;
  readonly url: string;
  readonly at: string;
}

/** A read that failed, or that lacked a field a change depends on. `ref` is null for a listing. */
export interface ReadFailure {
  readonly ref: string | null;
  readonly reason: string;
  /**
   * Why the read failed, where that matters. `not-found` (a 404: the item does not exist, or the token cannot see it)
   * and `outside-fleet` (it moved out of the fleet's repository, project or team) are terminal: no read of that item
   * will succeed, so one item failing so does not hold the source's cursor back. `forbidden` is a 403 that is no rate
   * limit; `unreachable` is no answer, or a 5xx. An item read that fails with no kind counts toward none. The fleet
   * is not watched when, in `UNREADABLE_POLLS` polls in a row, every read of a source, a listing among them for
   * `not-found` and `outside-fleet`, fails with one of the four kinds, or a listing fails, of any kind or none.
   */
  readonly kind?: "not-found" | "outside-fleet" | "forbidden" | "unreachable";
}

export interface ReadOutcome {
  readonly snapshots: readonly ItemSnapshot[];
  readonly events: readonly ActivityEvent[];
  readonly updated: readonly UpdatedItem[];
  readonly failures: readonly ReadFailure[];
  /**
   * Set when the listing of updated items, read oldest first, was cut off at its page limit: the `updated` time of
   * the last item it listed. Everything older was listed, so the cursor may move to it; the rest is listed next poll.
   */
  readonly listingCutAt?: string;
  /**
   * Set when the listing of updated items was cut off at its page limit without getting past the cursor: every item it
   * listed is at or before it, so the cursor cannot move to where it stopped. The cut-off is no failure and the cursor
   * moves as it does after a listing that fit; the rows of the issues past the page limit are not recorded.
   */
  readonly listingSkipped?: ListingSkipped;
}

/** A listing of updated items cut off at its page limit before it got past the cursor. */
export interface ListingSkipped {
  /** The start of the window the listing covered (ISO 8601 UTC). */
  readonly from: string;
  /** The end of the window: when the listing ran. */
  readonly to: string;
  /** The `updated` time of the last item the listing reached. */
  readonly reached: string;
}

/** The state a source keeps for one item between polls. */
export interface ItemState {
  readonly open: boolean;
  readonly merged: boolean;
  readonly fleetLabels: readonly string[];
  readonly inPartition: boolean;
  /** The reviewers' states as last read, by actor, for a service that keeps them on the item. */
  readonly reviewers?: Readonly<Record<string, "approved" | "changes requested" | "commented">>;
}

/** A source's cursor: where its event reads resume, and what it knew of each item. Persisted only once a wake carrying its changes is accepted. */
export interface SourceCursor {
  /** ISO 8601 UTC: events on or after this time are read. */
  readonly since: string;
  readonly items: Readonly<Record<ItemId, ItemState>>;
}

// ---- changes ----

export type ChangeKind =
  | ActivityKind
  | "labelled"
  | "unlabelled"
  | "closed"
  | "reopened"
  | "merged";

export interface Change {
  /** Unique within a fleet and stable across polls, so a change read twice is one change. */
  readonly key: string;
  readonly role: SourceRole;
  readonly ref: string;
  readonly url: string;
  readonly kind: ChangeKind;
  /** The label, for `labelled` and `unlabelled`. */
  readonly label: string | null;
  readonly actor: string | null;
  readonly at: string;
  readonly lastLine: string | null;
  /** Other names the service knows the actor by; compared to the registered echo actors and never sent or stored. */
  readonly actorAliases?: readonly string[];
}

/** What became of a change. */
export type Disposition =
  | { readonly kind: "wake" }
  | { readonly kind: "echo"; readonly rule: "marker" | "label" | "echo actor" }
  | { readonly kind: "out-of-scope" }
  | { readonly kind: "held"; readonly reason: "no manager" };
