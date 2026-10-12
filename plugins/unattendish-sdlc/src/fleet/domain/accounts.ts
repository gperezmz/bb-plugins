// Accounts, their credentials and the assignments that say which account reads
// a fleet: the rules of who a fleet reads as, where an account's token may go,
// and what a fleet needs when nothing reads it.
import { parsePrefix, prefixMatches, prefixText, type Prefix, type Subject } from "./identity";
import type { RepoRef, ServiceKind, SourceRole, TrackerSpec } from "./model";

/** How an account gets its token: pasted, or from the operator's `gh` or `glab` login. */
export type AccountVia = "token" | "gh" | "glab";

/**
 * One login on one host or service. `place` is the host for GitHub and GitLab, the site for Jira, and `linear.app`
 * for Linear. `login` is what a later token's owner is compared with: the user name on GitHub and GitLab, the user's
 * id on Linear and the account id on Jira; `name` is how a person reads it.
 */
export interface Account {
  readonly id: string;
  readonly service: ServiceKind;
  readonly place: string;
  readonly login: string;
  readonly name: string;
  readonly via: AccountVia;
  /** The API address the account's token goes to; null for the one its place gives. */
  readonly apiUrl: string | null;
  readonly addedAt: string;
}

/**
 * What a credential is: a fine-grained or classic GitHub token, a GitLab personal access token, a Linear key, a Jira
 * API token, or the operator's `gh` or `glab` login.
 */
export type CredentialKind = "fine-grained" | "classic" | "gitlab-token" | "linear-key" | "jira-token" | "gh" | "glab";

/** A credential of one account. Its token, where it has one, is kept apart and never part of this value. */
export interface AccountCredential {
  readonly id: string;
  readonly accountId: string;
  readonly kind: CredentialKind;
  /** The owner a fine-grained GitHub token reaches; null for one that reaches every owner of its account's host. */
  readonly owner: string | null;
  /** When the service says the token expires; null where it reported none. */
  readonly expiresAt: string | null;
  readonly addedAt: string;
}

/** Which account reads a host, an owner or group, a Linear team (or every team) or a Jira site or project. */
export interface Assignment {
  /** The prefix it covers, as `prefixText` spells it. */
  readonly scope: string;
  readonly accountId: string;
}

export const LINEAR_PLACE = "linear.app";

export const SERVICE_NAMES: Readonly<Record<ServiceKind, string>> = { github: "GitHub", gitlab: "GitLab", linear: "Linear", jira: "Jira" };

/** `GitHub · yuser`: an account as a person reads it. */
export const accountLabel = (account: Pick<Account, "service" | "name">): string => `${SERVICE_NAMES[account.service]} · ${account.name}`;

/** Credentials that can write wherever their login can: a classic token, and a `gh` or `glab` login. */
export const canWrite = (kind: CredentialKind): boolean => kind === "classic" || kind === "gh" || kind === "glab";

/** The key two spellings of one prefix share. */
export const scopeKey = (scope: string): string => scope.trim().toLowerCase();

/** A hostname a token may be sent to over plain http, for testing. */
export const isLoopbackHost = (hostname: string): boolean => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

/** A Jira Cloud site: a host under `atlassian.net`. */
export const isJiraCloudSite = (site: string): boolean => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.atlassian\.net$/i.test(site);

// ---- where a token may go ----

/** The hostnames an account's token may be sent to, besides loopback: its own host, and `api.github.com` for github.com. */
export const tokenHosts = (account: Pick<Account, "service" | "place">): string[] => {
  switch (account.service) {
    case "github":
      return account.place === "github.com" ? ["github.com", "api.github.com"] : [account.place];
    case "gitlab":
      return [account.place];
    case "linear":
      return ["api.linear.app"];
    case "jira":
      return [account.place];
  }
};

/** The API root an account's place gives: the REST root, or Linear's GraphQL endpoint. */
export const defaultApiUrl = (account: Pick<Account, "service" | "place">): string => {
  switch (account.service) {
    case "github":
      return account.place === "github.com" ? "https://api.github.com" : `https://${account.place}/api/v3`;
    case "gitlab":
      return `https://${account.place}/api/v4`;
    case "linear":
      return "https://api.linear.app/graphql";
    case "jira":
      return `https://${account.place}`;
  }
};

/** The base URL an account's token goes to, and its hostname. */
export const apiOf = (account: Pick<Account, "service" | "place" | "apiUrl">): { readonly baseUrl: string; readonly host: string } => {
  const baseUrl = account.apiUrl ?? defaultApiUrl(account);
  return { baseUrl, host: new URL(baseUrl).hostname.toLowerCase() };
};

/** `GitHub · yuser for acme` for a fine-grained token, else the account's label. */
export const credentialLabel = (account: Pick<Account, "service" | "name">, credential: Pick<AccountCredential, "kind" | "owner">): string =>
  credential.kind === "fine-grained" && credential.owner !== null ? `${accountLabel(account)} for ${credential.owner}` : accountLabel(account);

/** Why an API address cannot be used for an account, or null when it can: https on the account's own host, or loopback. */
export const apiUrlProblem = (account: Pick<Account, "service" | "place">, apiUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return "the API address is not a URL";
  }
  if (url.username !== "" || url.password !== "") return "the API address may not carry a user name or password";
  const hostname = url.hostname.toLowerCase();
  if (isLoopbackHost(hostname)) return url.protocol === "https:" || url.protocol === "http:" ? null : "the API address must be https";
  if (url.protocol !== "https:") return "the API address must be https (http is allowed only on loopback)";
  const hosts = tokenHosts(account);
  return hosts.includes(hostname) ? null : `the API address must be on ${hosts.join(" or ")}, the account's own host`;
};

/** Why an account cannot be added on a service and place, or null when it can. */
export const placeProblem = (service: ServiceKind, place: string): string | null => {
  const host = place.trim().toLowerCase();
  if (service === "linear") return host === LINEAR_PLACE ? null : `a Linear account is on ${LINEAR_PLACE}`;
  const prefix = parsePrefix(host);
  if (prefix === null || prefix.kind !== "repo" || prefix.path.length > 0) return `${place.trim()} is not a host`;
  if (service === "jira" && !isJiraCloudSite(host)) return `${host} is not a Jira Cloud site: a Jira site ends in .atlassian.net`;
  return null;
};

// ---- what an assignment may name ----

/** Whether an account is on the host, site or service a prefix covers. */
export const accountCovers = (account: Pick<Account, "service" | "place">, prefix: Prefix): boolean => {
  switch (prefix.kind) {
    case "repo":
      return (account.service === "github" || account.service === "gitlab") && account.place === prefix.host;
    case "linear":
      return account.service === "linear";
    case "jira":
      return account.service === "jira" && account.place === prefix.site;
  }
};

/** Where a prefix lies, as a refusal names it. */
const placeOfPrefix = (prefix: Prefix): string => (prefix.kind === "repo" ? prefix.host : prefix.kind === "jira" ? prefix.site : "Linear");

/** Why an assignment of `scope` to `account` cannot be made, or null when it can. Names both the scope and the account. */
export const assignmentProblem = (scope: string, account: Pick<Account, "service" | "place" | "name">): string | null => {
  const prefix = parsePrefix(scope);
  if (prefix === null) return `${scope.trim()} is not a host, an owner or group, linear:, a Linear team, or a Jira site or project`;
  if (prefix.kind === "jira" && !isJiraCloudSite(prefix.site)) return `${prefix.site} is not a Jira Cloud site: a Jira site ends in .atlassian.net`;
  if (accountCovers(account, prefix)) return null;
  return `${prefixText(prefix)} is on ${placeOfPrefix(prefix)}, not on ${accountLabel(account)}'s ${account.service === "linear" ? "service" : `host ${account.place}`}`;
};

/** The default's scope for an account's place: the bare host or site, or `linear:`. */
export const defaultScope = (account: Pick<Account, "service" | "place">): string => (account.service === "linear" ? "linear:" : account.service === "jira" ? `jira:${account.place}` : account.place);

/** What a fleet's half reads, as a person reads it: the repository path for the forge, `team ENG` or `OPS` for a tracker. */
export const halfWhat = (repo: RepoRef, tracker: TrackerSpec, role: SourceRole): string => (role === "forge" ? repo.path : (trackerHalf(tracker)?.what ?? ""));

// ---- who reads a fleet ----

/** One half of a fleet: its forge, or its tracker where that is a service of its own. */
export interface Half {
  readonly role: SourceRole;
  /** What an assignment is matched against. */
  readonly subject: Subject;
  /** The service it reads, where known: a forge on a host with no account is not. */
  readonly service: ServiceKind | null;
  /** The host, site or `linear.app`. */
  readonly place: string;
  /** What Connect assigns: the owner or group, the Linear team or the Jira project, as a prefix. */
  readonly scope: string;
  /** The owner a fine-grained GitHub token must reach; null for anything else. */
  readonly owner: string | null;
  /** What a person reads it as: `acme/api`, `team ENG`, `OPS`. */
  readonly what: string;
}

/** The fleet's forge, as a half. */
export const forgeHalf = (repo: RepoRef, service: ServiceKind | null): Half => {
  const segments = repo.path.split("/");
  const group = segments.slice(0, -1).join("/");
  return {
    role: "forge",
    subject: { kind: "repo", host: repo.host, path: segments },
    service,
    place: repo.host,
    scope: `${repo.host}/${group}`,
    owner: segments[0] ?? null,
    what: repo.path,
  };
};

/** The fleet's tracker where it is a service of its own; null for the forge's issues, which the forge reads. */
export const trackerHalf = (tracker: TrackerSpec): Half | null => {
  switch (tracker.kind) {
    case "forge-issues":
      return null;
    case "linear":
      return { role: "tracker", subject: { kind: "linear", team: tracker.team }, service: "linear", place: LINEAR_PLACE, scope: `linear:${tracker.team}`, owner: null, what: `team ${tracker.team}` };
    case "jira":
      return { role: "tracker", subject: { kind: "jira", site: tracker.site, project: tracker.project }, service: "jira", place: tracker.site, scope: `jira:${tracker.site}/${tracker.project}`, owner: null, what: tracker.project };
  }
};

const specificity = (prefix: Prefix): number => (prefix.kind === "repo" ? 1 + prefix.path.length : prefix.kind === "linear" ? (prefix.team === null ? 0 : 1) : prefix.project === null ? 1 : 2);

/**
 * The assignment covering a subject that wins: the most specific whose account is on the subject's host, site or
 * service. An assignment naming an account elsewhere is never taken.
 */
export const winningAssignment = (subject: Subject, assignments: readonly Assignment[], accounts: readonly Account[]): { readonly assignment: Assignment; readonly account: Account } | null => {
  let best: { assignment: Assignment; account: Account; prefix: Prefix } | null = null;
  for (const assignment of assignments) {
    const prefix = parsePrefix(assignment.scope);
    const account = accounts.find((candidate) => candidate.id === assignment.accountId);
    if (prefix === null || account === undefined || !prefixMatches(prefix, subject) || !accountCovers(account, prefix)) continue;
    if (best === null || specificity(prefix) > specificity(best.prefix)) best = { assignment, account, prefix };
  }
  return best === null ? null : { assignment: best.assignment, account: best.account };
};

/** The default account of a place: the one assigned its bare host, site or `linear:`. */
export const defaultAccountOf = (service: ServiceKind | null, place: string, assignments: readonly Assignment[], accounts: readonly Account[]): Account | null => {
  for (const assignment of assignments) {
    const account = accounts.find((candidate) => candidate.id === assignment.accountId);
    if (account === undefined || account.place !== place || (service !== null && account.service !== service)) continue;
    if (scopeKey(assignment.scope) === scopeKey(defaultScope(account))) return account;
  }
  return null;
};

/**
 * The credential of an account that reaches a half: on GitHub the fine-grained token for the half's owner, else one
 * that reaches every owner; on any other service the account's credential. Null when it has none.
 */
export const credentialFor = (account: Account, half: Pick<Half, "owner">, credentials: readonly AccountCredential[]): AccountCredential | null => {
  const own = credentials.filter((credential) => credential.accountId === account.id);
  if (account.service !== "github") return own[0] ?? null;
  const owner = half.owner?.toLowerCase() ?? null;
  return own.find((credential) => credential.owner !== null && credential.owner.toLowerCase() === owner) ?? own.find((credential) => credential.owner === null) ?? null;
};

/** Who reads a half: the account the winning assignment names and its credential, or nothing. */
export type HalfReader =
  | { readonly kind: "reads"; readonly account: Account; readonly credential: AccountCredential }
  | { readonly kind: "needs"; readonly account: Account | null; readonly need: string };

/** `other-org/x needs a GitHub account that can read other-org`: what a half needs, in AC1's words. */
export const needText = (fleet: RepoRef, half: Half): string => {
  switch (half.service) {
    case "linear":
      return `${fleet.path} needs a Linear account that can read ${half.what}`;
    case "jira":
      return `${fleet.path} needs a Jira account for ${half.place}`;
    case null:
      return `${half.what} needs a GitHub or GitLab account that can read ${half.scope.slice(half.place.length + 1)} on ${half.place}`;
    default:
      return `${half.what} needs a ${SERVICE_NAMES[half.service]} account that can read ${half.scope.slice(half.place.length + 1)}`;
  }
};

export const readerOf = (fleet: RepoRef, half: Half, accounts: readonly Account[], assignments: readonly Assignment[], credentials: readonly AccountCredential[]): HalfReader => {
  const won = winningAssignment(half.subject, assignments, accounts);
  const account = won?.account ?? null;
  const resolved: Half = account === null || half.service !== null ? half : { ...half, service: account.service };
  if (account === null) return { kind: "needs", account: null, need: needText(fleet, resolved) };
  if (half.service !== null && account.service !== half.service) return { kind: "needs", account: null, need: needText(fleet, half) };
  const credential = credentialFor(account, half, credentials);
  return credential === null ? { kind: "needs", account, need: needText(fleet, resolved) } : { kind: "reads", account, credential };
};

/**
 * Why a credential the service accepts cannot read a fleet's repository, team or project, and what to do (AC6): for a
 * fine-grained GitHub token, both likely causes and both remedies; for any other, that its login has no access.
 */
const cannotReadWhy = (kind: CredentialKind): string =>
  kind === "fine-grained"
    ? "the repository is not ticked on the token, or an organisation owner has not yet approved the token. Add the repository to the token on GitHub, or create a new token."
    : "its login has no access to it. Choose another account.";

/** What a fleet's card says of a credential that cannot read the half: `GitHub · yuser for acme cannot read acme/api: …`. */
export const accessProblemText = (credential: { readonly label: string; readonly kind: CredentialKind }, what: string): string => `${credential.label} cannot read ${what}: ${cannotReadWhy(credential.kind)}`;

/** What the popup says of a repository the credential it saved cannot read: `acme/api is not readable as GitHub · yuser: …`. */
export const notReadableText = (credential: { readonly label: string; readonly kind: CredentialKind }, what: string): string => `${what} is not readable as ${credential.label}: ${cannotReadWhy(credential.kind)}`;

// ---- the pages a token is created on ----

const pad = (n: number): string => String(n).padStart(2, "0");

/** `2026-10-12 18:30`: the day and time a token's pre-filled name carries, in UTC. */
const stamp = (at: Date): string => `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;

/** The grants a GitHub token for the plugin carries, as the form names them, and nothing else. */
export const GITHUB_GRANTS = ["Issues: Read-only", "Pull requests: Read-only", "Metadata: Read-only"] as const;
/** The scope a GitLab token for the plugin carries. */
export const GITLAB_SCOPES = ["read_api"] as const;
/** Days a GitHub token's pre-filled expiry runs for. */
export const GITHUB_EXPIRY_DAYS = 90;

/** GitHub's page for a new fine-grained token, filled in for the plugin reading `owner`: read-only Issues, Pull requests and Metadata, for 90 days. */
export const githubTokenUrl = (host: string, owner: string, at: Date): string => {
  // GitHub takes at most 40 characters of name; a long owner is cut, so the day and time that keep names apart stay.
  const when = stamp(at);
  const query = new URLSearchParams({
    name: `Unattendish ${owner.slice(0, 40 - "Unattendish  ".length - when.length)} ${when}`,
    description: `Read-only token for Unattendish to read ${owner}'s issues and pull requests.`,
    target_name: owner,
    expires_in: String(GITHUB_EXPIRY_DAYS),
    issues: "read",
    pull_requests: "read",
    metadata: "read",
  });
  return `https://${host}/settings/personal-access-tokens/new?${query.toString()}`;
};

/** GitLab's page for a new personal access token, filled in with a name, a read-only description and `read_api` alone. */
export const gitlabTokenUrl = (host: string, at: Date): string => {
  const query = new URLSearchParams({
    name: `Unattendish ${stamp(at)}`,
    description: "Read-only token for Unattendish, which reads this account's issues and merge requests.",
    scopes: GITLAB_SCOPES.join(","),
  });
  return `https://${host}/-/user_settings/personal_access_tokens?${query.toString()}`;
};

/** Where a service lists its tokens, to revoke one there. */
export const tokenPageOf = (account: Pick<Account, "service" | "place">): string => {
  switch (account.service) {
    case "github":
      return `https://${account.place}/settings/personal-access-tokens`;
    case "gitlab":
      return `https://${account.place}/-/user_settings/personal_access_tokens`;
    case "linear":
      return "https://linear.app/settings/account/security";
    case "jira":
      return "https://id.atlassian.com/manage-profile/security/api-tokens";
  }
};

/** What kind of credential a pasted token is, from its service and what the service said of it. */
export const pastedKind = (service: ServiceKind, classic: boolean): CredentialKind => {
  switch (service) {
    case "github":
      return classic ? "classic" : "fine-grained";
    case "gitlab":
      return "gitlab-token";
    case "linear":
      return "linear-key";
    case "jira":
      return "jira-token";
  }
};
