// Views for screen and decision tests, each built from a complete default and the fields a test names.
import type {
  AccountOptionView,
  AccountSettingView,
  ActionRecordView,
  ConnectView,
  CredentialSettingView,
  FleetCardView,
  FleetCredentialView,
  FleetDetailView,
  FleetsView,
  InboxRowView,
  LandedRowView,
  LedgerChangeView,
  LedgerView,
  HalfView,
  SettingsView,
  TokenPageView,
  UnreadableInboxRowView,
} from "@/src/fleet/application/views";

export const NOW = "2026-10-12T12:00:00.000Z";

/** An ISO time `ms` before `NOW`. */
export const ago = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function fleetCard(over: Partial<FleetCardView> = {}): FleetCardView {
  return {
    repo: "acme/web",
    forge: "github",
    tracker: "linear:ENG",
    managerThreadId: "thr_acme",
    manager: { state: "idle", since: ago(12 * MINUTE) },
    waiting: 0,
    inFlight: 0,
    blocked: 0,
    landed: 0,
    cost: null,
    lastPolledAt: ago(40_000),
    intervalMs: 120_000,
    reasons: [],
    halves: [],
    warnings: [],
    ...over,
  };
}

export function actionRecord(over: Partial<ActionRecordView> = {}): ActionRecordView {
  return { id: "act_1", fleet: "acme/web", kind: "answer", ref: "ENG-212", what: "which locale wins?", state: "sent", sentAt: ago(3 * MINUTE), doneAt: null, ...over };
}

export function inboxRow(over: Partial<InboxRowView> = {}): InboxRowView {
  return {
    id: "row_1",
    fleet: "acme/web",
    managerThreadId: "thr_acme",
    ref: "ENG-212",
    what: "which locale wins?",
    waitsFor: "answer",
    since: ago(5 * MINUTE),
    link: { kind: "url", url: "https://linear.test/ENG-212", text: "ENG-212" },
    offer: { kind: "answer", label: "Answer…", regrant: false },
    action: null,
    ...over,
  };
}

export function unreadableInboxRow(over: Partial<UnreadableInboxRowView> = {}): UnreadableInboxRowView {
  return { fleet: "acme/web", managerThreadId: "thr_acme", line: 9, reason: "the table has no \"Waits for\" column", ...over };
}

export function landedRow(over: Partial<LandedRowView> = {}): LandedRowView {
  return { fleet: "acme/web", ref: "ENG-198", spec: "dark mode", merged: ago(3 * HOUR), link: { kind: "url", url: "https://github.test/acme/web/pull/88", text: "#88" }, ...over };
}

export function fleetsView(over: Partial<FleetsView> = {}): FleetsView {
  return { generatedAt: NOW, waiting: 0, needsAccount: [], fleets: [], inbox: [], unreadableInbox: [], recentActions: [], landed: [], ...over };
}

export function fleetDetail(over: Partial<FleetDetailView> = {}): FleetDetailView {
  return {
    generatedAt: NOW,
    card: fleetCard(),
    manifest: { status: "ok", inbox: [], unreadableInbox: [], inFlight: [], blocked: [], landed: [], unreadable: [], written: [] },
    watched: [],
    credentials: [],
    requestsThisHour: 0,
    recentActions: [],
    ...over,
  };
}

export function ledgerChange(over: Partial<LedgerChangeView> = {}): LedgerChangeView {
  return { at: ago(10 * MINUTE), ref: "#163", url: "https://github.test/acme/web/issues/163", kind: "comment added", actor: "alice", done: "woke", rule: null, ...over };
}

export function ledgerView(over: Partial<LedgerView> = {}): LedgerView {
  return { generatedAt: NOW, changes: [], dropped: [], wakes: [], ...over };
}

export function settingsView(over: Partial<SettingsView> = {}): SettingsView {
  return { accounts: [], fleets: [], ...over };
}

export function half(over: Partial<HalfView> = {}): HalfView {
  return { role: "forge", what: "acme/web", account: { id: "acc_yuser", label: "GitHub · yuser" }, credential: "GitHub · yuser for acme", canWrite: false, needs: null, ...over };
}

export function fleetCredential(over: Partial<FleetCredentialView> = {}): FleetCredentialView {
  return {
    role: "forge",
    label: "GitHub · yuser for acme",
    account: { id: "acc_yuser", label: "GitHub · yuser" },
    kind: "fine-grained",
    auth: "token",
    expiresAt: null,
    canWrite: false,
    sharesAgentRateLimit: false,
    ...over,
  };
}

export function credentialSetting(over: Partial<CredentialSettingView> = {}): CredentialSettingView {
  return {
    id: "cred_acme",
    reaches: "acme",
    kindLabel: "fine-grained token",
    kind: "fine-grained",
    canWrite: false,
    expiresAt: null,
    expiresInDays: null,
    refused: false,
    sharesRateLimit: false,
    fleets: [],
    renew: { kind: "create", url: "https://github.com/settings/personal-access-tokens/new?target_name=acme", owner: "acme" },
    ...over,
  };
}

export function accountSetting(over: Partial<AccountSettingView> = {}): AccountSettingView {
  return {
    id: "acc_yuser",
    label: "GitHub · yuser",
    service: "github",
    place: "github.com",
    name: "yuser",
    via: "token",
    canWrite: false,
    defaultFor: ["github.com"],
    canMakeDefault: false,
    loginProblem: null,
    credentials: [],
    assignments: [],
    tokenPage: "https://github.com/settings/personal-access-tokens",
    addsOwners: true,
    ...over,
  };
}

export function accountOption(over: Partial<AccountOptionView> = {}): AccountOptionView {
  return { id: "acc_yuser", label: "GitHub · yuser", via: "token", isDefault: true, reaches: false, canWrite: false, loginProblem: null, ...over };
}

export function connectView(over: Partial<ConnectView> = {}): ConnectView {
  return {
    generatedAt: NOW,
    fleet: "acme/web",
    role: "forge",
    service: "github",
    place: "github.com",
    scope: "acme",
    owner: "acme",
    what: "acme/web",
    accounts: [accountOption()],
    current: null,
    problem: null,
    ...over,
  };
}

export function tokenPage(over: Partial<TokenPageView> = {}): TokenPageView {
  return {
    sentTo: "api.github.com",
    url: "https://github.com/settings/personal-access-tokens/new?target_name=acme&expires_in=90",
    grants: ["Issues: read", "Pull requests: read", "Metadata: read"],
    repositories: ["acme/web"],
    chooseExpiry: false,
    note: null,
    signInAs: "yuser",
    ...over,
  };
}
