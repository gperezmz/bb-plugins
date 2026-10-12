// What the Fleets dashboard reads and does, as plain JSON-safe values. The
// plugin's pages (the Fleets page, the Fleet chip, the Fleet tab, the settings
// section) are written against `DashboardApi` alone; the RPC contract in the
// adapters region is this interface over the wire. Every time is ISO 8601 UTC,
// and every view carries `generatedAt` so a page ages rows by the server's clock.
import type { AccountVia, CredentialKind } from "../domain/accounts";
import type { NotWatchedCode, ServiceKind, SourceRole, Stage, WaitsFor } from "../domain/model";

// ---- actions ----

/** The three actions the dashboard sends a manager: Answer…, Grant… and Build it. */
export type ActionKind = "answer" | "grant" | "build";

/** What the operator may do on an Inbox row that has no action in flight. Null for a row waiting for `other`. */
export interface ActionOffer {
  readonly kind: ActionKind;
  /** The button's label: `Answer…`, `Grant…` or `Build it`. */
  readonly label: string;
  /** A `grant` row whose Link names a previous manager's message: the page also offers Re-grant, one click that sends the row's What. */
  readonly regrant: boolean;
}

/** An action the plugin has sent and keeps until a poll sees its result, then shows as done for a while. */
export interface ActionRecordView {
  readonly id: string;
  readonly fleet: string;
  readonly kind: ActionKind;
  readonly ref: string;
  readonly what: string;
  readonly state: "sent" | "done";
  readonly sentAt: string;
  /** The poll that saw the result; null while `sent`. */
  readonly doneAt: string | null;
}

// ---- manifest rows ----

/** The message a row with no Ref points at: `this thread, message 3, <time>` or `thread thr_x, message 3, <time>`. */
export interface MessageLinkView {
  /** Null for the manager's own thread. */
  readonly threadId: string | null;
  readonly message: number;
  readonly at: string;
}

/** Where a row's Link goes: the item's or pull request's URL, or a message in a bb thread. */
export type LinkView =
  | { readonly kind: "url"; readonly url: string; readonly text: string }
  | { readonly kind: "message"; readonly message: MessageLinkView };

export interface InboxRowView {
  /** Stable for a row across polls; the key an action names it by and a toast announces it by. */
  readonly id: string;
  readonly fleet: string;
  readonly managerThreadId: string;
  readonly ref: string;
  readonly what: string;
  readonly waitsFor: WaitsFor;
  readonly since: string;
  readonly link: LinkView;
  /** What the operator may do now; null when `waitsFor` is `other`, or while an action is in flight on the row. */
  readonly offer: ActionOffer | null;
  /** The latest action sent on the row, `sent` or `done`; null when none was. */
  readonly action: ActionRecordView | null;
}

/** An Inbox row the plugin cannot read by the contract. It counts as waiting on the operator. */
export interface UnreadableInboxRowView {
  readonly fleet: string;
  readonly managerThreadId: string;
  readonly line: number;
  /** Names the column, as the manifest reader's reason does. */
  readonly reason: string;
}

export interface InFlightRowView {
  readonly ref: string;
  readonly work: string;
  readonly stage: Stage;
  /** When the row took its current Stage. */
  readonly since: string;
  /** Null when the row's Builder is `—`. */
  readonly builderThreadId: string | null;
  readonly link: LinkView;
}

export interface BlockedRowView {
  readonly ref: string;
  readonly blockedOn: readonly string[];
  readonly link: LinkView;
}

export interface LandedRowView {
  readonly fleet: string;
  readonly ref: string;
  readonly spec: string;
  readonly merged: string;
  /** The pull request that merged. */
  readonly link: LinkView;
}

/** A row the plugin cannot read, in the section the manifest keeps it in. */
export interface UnreadableRowView {
  readonly section: string;
  readonly line: number;
  readonly reason: string;
}

/** A section the plugin does not read by column (Backlog, Set aside, Standing orders, any other), kept as written. */
export interface WrittenSectionView {
  readonly heading: string;
  readonly markdown: string;
}

// ---- a fleet ----

/** Where a not-fully-watched reason is fixed: Connect… for the half that needs an account, or the Fleet tab for the manifest. */
export type FixView =
  | { readonly kind: "connect"; readonly role: SourceRole }
  | { readonly kind: "fleet-tab" }
  | { readonly kind: "none" };

export interface ReasonView {
  /** The contract's `notWatched` codes, or `unreadable-rows` for manifest rows the plugin cannot read. */
  readonly code: NotWatchedCode | "unreadable-rows";
  readonly text: string;
  readonly fix: FixView;
}

/** An account as a page names it. */
export interface AccountRefView {
  readonly id: string;
  /** `GitHub · yuser`. */
  readonly label: string;
}

/**
 * One half of a fleet (its forge, or its tracker where that is a service of its own): the account it reads as, and
 * what it needs while it cannot be read. A watched half offers Change account…, one that is not offers Connect….
 */
export interface HalfView {
  readonly role: SourceRole;
  /** What the half reads: `acme/api`, `team ENG`, `OPS`. */
  readonly what: string;
  /** The account it reads as, or would once it has a credential; null where no assignment covers it. */
  readonly account: AccountRefView | null;
  /** The credential's label, `GitHub · yuser for acme`, while it has one. */
  readonly credential: string | null;
  /** Whether the credential can write: a classic token, or a `gh` or `glab` login. */
  readonly canWrite: boolean;
  /** What the half needs, in a sentence; null while it reads. */
  readonly needs: string | null;
}

/** A credential a fleet uses. The token itself never appears. */
export interface FleetCredentialView {
  readonly role: SourceRole;
  /** `GitHub · yuser for acme`. */
  readonly label: string;
  readonly account: AccountRefView;
  readonly kind: CredentialKind;
  readonly auth: AccountVia;
  /** Where the service reported the credential's expiry; null when it did not. */
  readonly expiresAt: string | null;
  readonly canWrite: boolean;
  /** True for the gh or glab login, which the fleet's agents act through too. */
  readonly sharesAgentRateLimit: boolean;
}

export interface ManagerView {
  /** `none`: the manager thread is archived or gone. */
  readonly state: "working" | "idle" | "none";
  /** Since when it has been in that state; null for `none` or when bb does not say. */
  readonly since: string | null;
}

/** The cost of the manager's thread tree, from Thread Usage. Absent without Thread Usage or when its answer cannot be read. */
export interface CostView {
  readonly amount: number;
  readonly currency: string;
  /** The period the amount covers: `since this manager started`. */
  readonly period: string;
}

export interface FleetCardView {
  /** `host/path`, as the manifest's first line spells it. */
  readonly repo: string;
  readonly tracker: string;
  readonly managerThreadId: string;
  readonly manager: ManagerView;
  /** Rows in the Inbox, unreadable ones among them. */
  readonly waiting: number;
  readonly inFlight: number;
  /** Landed rows merged on today's date (the server's local day). */
  readonly landedToday: number;
  readonly cost: CostView | null;
  readonly lastPolledAt: string | null;
  readonly intervalMs: number;
  /** Every reason the fleet is not fully watched. */
  readonly reasons: readonly ReasonView[];
  /** The forge, then the tracker where it is a service of its own. */
  readonly halves: readonly HalfView[];
  /** Credentials expiring within 7 days, and those sharing the agents' rate limit, for the card to warn of. */
  readonly warnings: readonly CredentialWarningView[];
}

/** An expiring credential carries what Renew needs: the credential, its account and the half it serves. */
export type CredentialWarningView =
  | { readonly kind: "expires"; readonly label: string; readonly credentialId: string; readonly accountId: string; readonly role: SourceRole; readonly expiresAt: string; readonly daysLeft: number }
  | { readonly kind: "shares-rate-limit"; readonly label: string };

/** A fleet half that cannot be read, listed at the top of Waits on you with Connect…. */
export interface NeedsAccountView {
  readonly fleet: string;
  readonly managerThreadId: string;
  readonly role: SourceRole;
  readonly text: string;
}

// ---- the Fleets page ----

export interface FleetsView {
  readonly generatedAt: string;
  /** Every Inbox row of every fleet, unreadable ones included, sent ones too, and every fleet half that needs an account: the header's count. */
  readonly waiting: number;
  /** Fleet halves that cannot be read for want of an account or a credential that reads them, listed first. */
  readonly needsAccount: readonly NeedsAccountView[];
  readonly fleets: readonly FleetCardView[];
  /** The rows the page lists, oldest wait first. */
  readonly inbox: readonly InboxRowView[];
  readonly unreadableInbox: readonly UnreadableInboxRowView[];
  /** Actions that finished and whose row has left the Inbox, for the last hour. */
  readonly recentActions: readonly ActionRecordView[];
  /** Specs landed in any fleet in the last 7 days, newest first. */
  readonly landed: readonly LandedRowView[];
}

// ---- the Fleet tab ----

export interface WatchedItemView {
  readonly ref: string;
  readonly url: string | null;
  /** Why the item is watched: `named in In flight`, `named in Inbox`, `blocked on #170`, or `carries the spec label`. */
  readonly why: readonly string[];
}

export type ManifestView =
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly reason: string }
  | {
      readonly status: "ok";
      readonly inbox: readonly InboxRowView[];
      readonly unreadableInbox: readonly UnreadableInboxRowView[];
      readonly inFlight: readonly InFlightRowView[];
      readonly blocked: readonly BlockedRowView[];
      /** The last 7 days. */
      readonly landed: readonly LandedRowView[];
      readonly unreadable: readonly UnreadableRowView[];
      /** Every other section, in the file's order. */
      readonly written: readonly WrittenSectionView[];
    };

export interface FleetDetailView {
  readonly generatedAt: string;
  readonly card: FleetCardView;
  readonly manifest: ManifestView;
  readonly watched: readonly WatchedItemView[];
  readonly credentials: readonly FleetCredentialView[];
  readonly requestsThisHour: number;
  readonly recentActions: readonly ActionRecordView[];
}

/** What a thread is to the Fleet tab and the chip. */
export type ThreadFleetView =
  | { readonly kind: "manager"; readonly card: FleetCardView }
  | {
      readonly kind: "none";
      /** The manager holding this thread's repository, where a fleet does. */
      readonly holder: { readonly repo: string; readonly managerThreadId: string } | null;
    };

// ---- the ledger ----

export interface LedgerFilter {
  /** A reference such as `#163`. */
  readonly item?: string;
  /** What was done with the change. */
  readonly done?: "woke" | "echo" | "out-of-scope" | "held" | "failed read";
  /** At most 250. */
  readonly limit?: number;
}

export interface LedgerChangeView {
  readonly at: string;
  readonly ref: string;
  readonly url: string;
  /** What changed, as the change's kind reads. */
  readonly kind: string;
  readonly actor: string | null;
  readonly done: "woke" | "echo" | "out-of-scope" | "held" | "failed read";
  /** The echo rule or the hold reason. */
  readonly rule: string | null;
}

export interface DroppedGroupView {
  /** `echo: marker`, `echo: label`, `echo: echo actor` or `out of scope`. */
  readonly reason: string;
  readonly count: number;
  readonly changes: readonly LedgerChangeView[];
}

export interface LedgerView {
  readonly generatedAt: string;
  readonly changes: readonly LedgerChangeView[];
  /** Dropped changes grouped by reason, largest group first. */
  readonly dropped: readonly DroppedGroupView[];
  readonly wakes: readonly { readonly queuedAt: string; readonly dispatchedAt: string | null; readonly kind: string }[];
}

// ---- accounts ----

/** How Renew replaces a credential: a new pre-filled token page, the key's field to paste a new one, or none for a login. */
export type RenewView =
  | { readonly kind: "create"; readonly url: string; readonly owner: string | null }
  | { readonly kind: "paste" }
  | { readonly kind: "login"; readonly command: string };

export interface CredentialSettingView {
  readonly id: string;
  /** What it reaches: an owner (`acme`), `every owner on github.com`, or the host or site. */
  readonly reaches: string;
  /** `fine-grained token`, `classic token`, `personal access token`, `API key`, `API token`, `gh login`, `glab login`. */
  readonly kindLabel: string;
  readonly kind: CredentialKind;
  readonly canWrite: boolean;
  /** Where the service reported an expiry; null shows as `no expiry reported`. */
  readonly expiresAt: string | null;
  /** Days left where it expires within the window the cards warn in; null otherwise. */
  readonly expiresInDays: number | null;
  /** The service refuses it now. */
  readonly refused: boolean;
  /** The fleets that read with it. */
  readonly fleets: readonly string[];
  readonly renew: RenewView;
}

export interface AccountSettingView {
  readonly id: string;
  readonly label: string;
  readonly service: ServiceKind;
  /** The host, site or `linear.app`. */
  readonly place: string;
  readonly name: string;
  readonly via: AccountVia;
  /** True for a `gh` or `glab` account, which can write. */
  readonly canWrite: boolean;
  /** The places it is the default for (`github.com`, `acme.atlassian.net`, `linear:`). */
  readonly defaultFor: readonly string[];
  /** It is not its place's default, and Make default would make it so. */
  readonly canMakeDefault: boolean;
  /** For a login: `gh is signed in as yuser, not buser`, or why the tool gave no token; null otherwise. */
  readonly loginProblem: string | null;
  readonly credentials: readonly CredentialSettingView[];
  /** The owners, groups, Linear teams and Jira projects assigned to it, besides its defaults; Remove returns each to the default. */
  readonly assignments: readonly { readonly scope: string; readonly what: string }[];
  /** Where the service lists its tokens, to revoke one there. */
  readonly tokenPage: string;
  /** GitHub accounts holding tokens: Add token for another owner. */
  readonly addsOwners: boolean;
}

export interface SettingsView {
  readonly accounts: readonly AccountSettingView[];
  readonly fleets: readonly { readonly repo: string; readonly intervalMs: number; readonly isDefault: boolean }[];
}

/** After a Remove or a Renew: the old token still works at the service until it expires or is revoked there. */
export interface RevokeNotice {
  readonly text: string;
  readonly url: string;
}

/** An account the popup lists for a half: those on its host, site or service, the default first. */
export interface AccountOptionView {
  readonly id: string;
  readonly label: string;
  readonly via: AccountVia;
  readonly isDefault: boolean;
  /** It holds a credential reaching the half, so Connect goes straight to verifying. */
  readonly reaches: boolean;
  /** The credential that would read the half can write. */
  readonly canWrite: boolean;
  readonly loginProblem: string | null;
}

/** What Connect asks about: a fleet's half, or (from Add account) a service and place with no fleet. */
export interface ConnectTarget {
  readonly fleet?: string;
  readonly role?: SourceRole;
  readonly service?: ServiceKind;
  /** The host, Jira site or `linear.app`. */
  readonly place?: string;
  /** GitHub: the owner a token is for, when there is no fleet to take it from. */
  readonly owner?: string;
}

/** The popup's first step: which account reads the half. */
export interface ConnectView {
  readonly generatedAt: string;
  readonly fleet: string | null;
  readonly role: SourceRole | null;
  /** The service, null where the host names none and no account is on it: the popup asks for GitHub or GitLab. */
  readonly service: ServiceKind | null;
  readonly place: string;
  /** The owner or group, Linear team or Jira project an account chosen here is assigned; null without a fleet. */
  readonly scope: string | null;
  /** The GitHub owner a token must reach; null off GitHub, and without a fleet or an owner given. */
  readonly owner: string | null;
  /** `acme/api`, `team ENG`, `OPS`; null without a fleet. */
  readonly what: string | null;
  /** The accounts on the place, the default first; "a new login" is always offered beside them. */
  readonly accounts: readonly AccountOptionView[];
  /** The account the half reads as now, if any. */
  readonly current: string | null;
  /** Why the place cannot take an account (a Jira site off atlassian.net); null when it can. */
  readonly problem: string | null;
}

/** The popup's second step for a token: where it will be sent, the page that creates it, and what to tick. */
export interface TokenPageView {
  /** The host or site the token will be sent to. */
  readonly sentTo: string;
  /** The pre-filled page Create token opens; null for Linear and Jira, which are pasted. */
  readonly url: string | null;
  /** The grants or scopes the page is filled in with, to fill a form that ignores the pre-fill by hand. */
  readonly grants: readonly string[];
  /** GitHub: every registered fleet's repository under the owner that reads as this account, or will once this Connect completes, to tick. */
  readonly repositories: readonly string[];
  /** GitLab: the expiry is chosen on the page. */
  readonly chooseExpiry: boolean;
  /** GitHub: when GitHub cannot issue a fine-grained token for the owner, and what to do instead. */
  readonly note: string | null;
  /** The login the browser must be signed in as; null for a new login. */
  readonly signInAs: string | null;
}

/** A repository a saved credential could not read, with what to do. */
export interface NotReadableView {
  readonly fleet: string;
  readonly text: string;
  /** A fine-grained GitHub token: add the repository to the token, or create a new one. Otherwise: choose another account. */
  readonly fineGrained: boolean;
}

export type ConnectSecret =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "jira"; readonly email: string; readonly token: string }
  | { readonly kind: "login"; readonly tool: "gh" | "glab"; readonly login: string }
  /** The account's stored credential reaching the half: no token is sent from the page. */
  | { readonly kind: "stored" };

export interface ConnectInput extends ConnectTarget {
  /** An account the plugin holds, or a new login on a service and place. `apiUrl` is set only here, for an account being added. */
  readonly account: { readonly id: string } | { readonly service: ServiceKind; readonly place: string; readonly apiUrl?: string };
  readonly secret: ConnectSecret;
  /** For a new login: the operator confirmed the login the token belongs to. */
  readonly confirm?: boolean;
  /** Renew: the credential the new token replaces. */
  readonly replaces?: string;
}

/** What Verify and save found. Only `saved` stored anything. */
export type ConnectResult =
  | { readonly outcome: "confirm"; readonly login: string; readonly label: string; readonly text: string }
  | { readonly outcome: "refused"; readonly text: string }
  | { readonly outcome: "wrong-login"; readonly text: string; readonly command: string | null }
  | { readonly outcome: "unreachable"; readonly text: string }
  | { readonly outcome: "invalid"; readonly text: string }
  | {
      readonly outcome: "saved";
      readonly account: AccountRefView;
      /** Whose it is. */
      readonly login: string;
      readonly expiresAt: string | null;
      readonly canWrite: boolean;
      readonly notReadable: readonly NotReadableView[];
      /** The half Connect was opened for, as read at once; null without a fleet. */
      readonly half: HalfView | null;
      readonly revoke: RevokeNotice | null;
    };

/** Signal: a fleet newly needs an account or credential for a half. */
export interface FleetNeedsSignal {
  readonly fleet: string;
  readonly managerThreadId: string;
  readonly role: SourceRole;
  readonly text: string;
}

// ---- results ----

/** A refusal states why, in words a person can read; it never carries a token. */
export type Result<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string };

// ---- the API ----

/** Everything the dashboard's pages call, each answering asynchronously because the wire does. The RPC contract carries each method under the same name. */
export interface DashboardApi {
  /** The Fleets page and the nav page's header count. */
  fleets(): Promise<FleetsView>;
  /** What the Fleet chip and the Fleet tab know of a thread. */
  threadFleet(input: { threadId: string }): Promise<ThreadFleetView>;
  /** The whole Fleet tab for the fleet a manager holds. */
  fleetDetail(input: { repo: string }): Promise<Result<{ detail: FleetDetailView }>>;
  ledger(input: { repo: string; filter?: LedgerFilter }): Promise<Result<{ ledger: LedgerView }>>;
  /**
   * Sends the manager one message for an Inbox row and records the action. `text` is the operator's words for
   * Answer… and Grant…, required and non-empty for those; Re-grant is `grant` with `regrant: true` and no text; Build it
   * takes none. A refusal by bb answers `{ ok: false, reason }` (bb's reason) and the row keeps its action.
   */
  sendAction(input: { fleet: string; rowId: string; kind: ActionKind; text?: string; regrant?: boolean }): Promise<Result<{ action: ActionRecordView }>>;
  settings(): Promise<SettingsView>;
  /** The popup's first step for a fleet's half, or for a service and place from Add account. */
  connectView(input: ConnectTarget): Promise<Result<{ connect: ConnectView }>>;
  /** The popup's second step for a token: where it goes, the pre-filled page and what to tick. */
  tokenPage(input: ConnectTarget & { readonly account: { readonly id: string } | { readonly service: ServiceKind; readonly place: string } }): Promise<Result<{ page: TokenPageView }>>;
  /** The logins `gh` or `glab` holds for a host. */
  cliLogins(input: { tool: "gh" | "glab"; host: string }): Promise<{ logins: readonly string[] }>;
  /** Verify and save: checks the token, key or login, stores it where the service accepts it, assigns, and reads the fleet at once. */
  connect(input: ConnectInput): Promise<ConnectResult>;
  /** Check again: reads the fleet at once and answers how its half stands. */
  checkAgain(input: { fleet: string; role: SourceRole }): Promise<Result<{ half: HalfView; notReadable: readonly NotReadableView[] }>>;
  makeDefault(input: { accountId: string }): Promise<Result<{ settings: SettingsView }>>;
  /** Returns an owner, group, team or project to its default. */
  removeAssignment(input: { scope: string }): Promise<Result<{ settings: SettingsView }>>;
  removeCredential(input: { credentialId: string }): Promise<Result<{ settings: SettingsView; revoke: RevokeNotice }>>;
  /** Refused while a registered fleet reads as it, naming those fleets. */
  removeAccount(input: { accountId: string }): Promise<Result<{ settings: SettingsView; revoke: RevokeNotice | null }>>;
  /** Refuses under 30 seconds. `null` returns the fleet to the default. */
  setInterval(input: { repo: string; seconds: number | null }): Promise<Result<{ settings: SettingsView }>>;
}

// ---- realtime ----

/** The channels the server publishes on. Payloads are signals: pages refetch through the API. */
export const BOARD_CHANGED = "board-changed";
export const INBOX_NEW = "inbox-new";

/** Published when a fleet newly needs an account or credential for a half; the payload is a `FleetNeedsSignal`. */
export const FLEET_NEEDS = "fleet-needs";

/** Published once for each Inbox row never seen before for its repository. */
export interface InboxNewSignal {
  readonly fleet: string;
  readonly ref: string;
  readonly what: string;
  readonly rowId: string;
}
