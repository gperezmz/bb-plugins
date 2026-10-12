// What the Fleets dashboard reads and does, as plain JSON-safe values. The
// plugin's pages (the Fleets page, the Fleet chip, the Fleet tab, the settings
// section) are written against `DashboardApi` alone; the RPC contract in the
// adapters region is this interface over the wire. Every time is ISO 8601 UTC,
// and every view carries `generatedAt` so a page ages rows by the server's clock.
import type { NotWatchedCode, Stage, WaitsFor } from "../domain/model";

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

/** Where a not-fully-watched reason is fixed. */
export type FixView =
  | { readonly kind: "settings" }
  | { readonly kind: "fleet-tab" }
  | { readonly kind: "none" };

export interface ReasonView {
  /** The contract's `notWatched` codes, or `unreadable-rows` for manifest rows the plugin cannot read. */
  readonly code: NotWatchedCode | "unreadable-rows";
  readonly text: string;
  readonly fix: FixView;
}

/** A credential a fleet uses. The token itself never appears. */
export interface FleetCredentialView {
  readonly role: "forge" | "tracker";
  readonly prefix: string;
  readonly auth: "token" | "gh" | "glab";
  /** Where the service reported the credential's expiry; null when it did not. */
  readonly expiresAt: string | null;
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
  /** Credentials expiring within 7 days, and those sharing the agents' rate limit, for the card to warn of. */
  readonly warnings: readonly CredentialWarningView[];
}

export type CredentialWarningView =
  | { readonly kind: "expires"; readonly prefix: string; readonly expiresAt: string; readonly daysLeft: number }
  | { readonly kind: "shares-rate-limit"; readonly prefix: string };

// ---- the Fleets page ----

export interface FleetsView {
  readonly generatedAt: string;
  /** Every Inbox row of every fleet, unreadable ones included, sent ones too: the header's count. */
  readonly waiting: number;
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

// ---- settings ----

export interface CredentialSettingView {
  readonly prefix: string;
  readonly auth: "token" | "gh" | "glab";
  readonly service: string | null;
  readonly baseUrl: string | null;
  /** True when a pasted token is stored for the prefix. The token is never sent back. */
  readonly hasToken: boolean;
  /** Where any fleet using it learned the service reports an expiry; null when none did. */
  readonly expiresAt: string | null;
  /** Why the entry cannot be used, where it cannot. */
  readonly problem: string | null;
}

export interface CredentialDraft {
  /** The prefix of the entry being edited; absent when adding. */
  readonly was?: string;
  readonly prefix: string;
  readonly auth: "token" | "gh" | "glab";
  readonly service?: string;
  readonly baseUrl?: string;
  /** A new token to store for the prefix; absent keeps the stored one. */
  readonly token?: string;
}

export interface SettingsView {
  readonly credentials: readonly CredentialSettingView[];
  readonly fleets: readonly { readonly repo: string; readonly intervalMs: number; readonly isDefault: boolean }[];
  readonly problems: readonly string[];
}

// ---- results ----

/** A refusal states why, in words a person can read; it never carries a token. */
export type Result<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string };

// ---- the API ----

/** Everything the dashboard's pages call. The RPC contract carries each method under the same name. */
export interface DashboardApi {
  /** The Fleets page and the nav page's header count. */
  fleets(): FleetsView;
  /** What the Fleet chip and the Fleet tab know of a thread. */
  threadFleet(input: { threadId: string }): Promise<ThreadFleetView>;
  /** The whole Fleet tab for the fleet a manager holds. */
  fleetDetail(input: { repo: string }): Promise<Result<{ detail: FleetDetailView }>>;
  ledger(input: { repo: string; filter?: LedgerFilter }): Result<{ ledger: LedgerView }>;
  /**
   * Sends the manager one message for an Inbox row and records the action. `text` is the operator's words for
   * Answer… and Grant…, required and non-empty for those; Re-grant is `grant` with `regrant: true` and no text; Build it
   * takes none. A refusal by bb answers `{ ok: false, reason }` (bb's reason) and the row keeps its action.
   */
  sendAction(input: { fleet: string; rowId: string; kind: ActionKind; text?: string; regrant?: boolean }): Promise<Result<{ action: ActionRecordView }>>;
  settings(): SettingsView;
  saveCredential(input: CredentialDraft): Promise<Result<{ settings: SettingsView }>>;
  removeCredential(input: { prefix: string }): Promise<Result<{ settings: SettingsView }>>;
  /** Refuses under 30 seconds. `null` returns the fleet to the default. */
  setInterval(input: { repo: string; seconds: number | null }): Result<{ settings: SettingsView }>;
}

// ---- realtime ----

/** The channels the server publishes on. Payloads are signals: pages refetch through the API. */
export const BOARD_CHANGED = "board-changed";
export const INBOX_NEW = "inbox-new";

/** Published once for each Inbox row never seen before for its repository. */
export interface InboxNewSignal {
  readonly fleet: string;
  readonly ref: string;
  readonly what: string;
  readonly rowId: string;
}
