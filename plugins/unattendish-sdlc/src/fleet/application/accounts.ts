// The operator's accounts: connecting a fleet's half to one through the popup
// (who reads it, a token or login checked before it is stored, the assignment
// Connect makes), and looking at and managing accounts in Settings. A token
// arrives here only to be checked and stored: no answer carries one, and no
// refusal or log line names one.
import {
  accountCovers,
  accountLabel,
  apiOf,
  apiUrlProblem,
  assignmentProblem,
  canWrite,
  credentialFor,
  credentialLabel,
  defaultAccountOf,
  notReadableText,
  defaultApiUrl,
  defaultScope,
  forgeHalf,
  GITHUB_GRANTS,
  githubTokenUrl,
  GITLAB_SCOPES,
  gitlabTokenUrl,
  isJiraCloudSite,
  LINEAR_PLACE,
  pastedKind,
  placeProblem,
  scopeKey,
  SERVICE_NAMES,
  tokenPageOf,
  trackerHalf,
  type Account,
  type AccountCredential,
  type CredentialKind,
  type Half,
} from "../domain/accounts";
import { daysLeftToWarn } from "../domain/dashboard";
import { defaultServiceOfHost, formatRepo, parsePrefix, parseRepo, repoId } from "../domain/identity";
import type { Registration, ServiceKind, SourceRole } from "../domain/model";
import { gather, halvesOf, type ViewDeps } from "./fleet-views";
import { lookupOf } from "./watching";
import type { AccountStore, CliLogins, DashboardEvents, ServiceProbe, StoredFleet } from "./ports";
import { resolvedOf } from "./resolved";
import type {
  AccountOptionView,
  AccountSettingView,
  ConnectInput,
  ConnectResult,
  ConnectTarget,
  ConnectView,
  CredentialSettingView,
  DashboardApi,
  HalfView,
  NotReadableView,
  Result,
  RevokeNotice,
  TokenPageView,
} from "./views";

/** What the credentials adapter knows of an account's `gh` or `glab` login. */
export interface LoginStatus {
  /** Why the login cannot read now (`gh is signed in as yuser, not buser`); null while it can or nothing was asked. */
  loginProblem(accountId: string): string | null;
  /** Forgets what was found of the login, so the next use asks the tool again. */
  forget(accountId: string): void;
}

export interface AccountsDeps extends ViewDeps {
  readonly accounts: AccountStore;
  readonly probe: ServiceProbe;
  readonly logins: CliLogins;
  readonly loginStatus: LoginStatus;
  readonly events: DashboardEvents;
  /** Reads a fleet at once, behind any poll of it. */
  readonly readNow: (repo: string) => Promise<void>;
  readonly newId: () => string;
}

const refuse = (reason: string) => ({ ok: false as const, reason });

/** Text a refusal may quote: one line, at most 200 characters. */
const shown = (text: string): string => {
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

// ---- halves ----

/** The service of a forge on a host: the one its name gives, else the one every account on it is on. */
const forgeServiceOn = (host: string, accounts: readonly Account[]): ServiceKind | null => {
  const named = defaultServiceOfHost(host);
  if (named !== null) return named;
  const services = [...new Set(accounts.filter((account) => account.place === host && (account.service === "github" || account.service === "gitlab")).map((account) => account.service))];
  return services.length === 1 ? services[0]! : null;
};

const halfOf = (registration: Registration, role: SourceRole, accounts: readonly Account[]): Half | null =>
  role === "forge" ? forgeHalf(registration.repo, forgeServiceOn(registration.repo.host, accounts)) : trackerHalf(registration.tracker);

/** The account a fleet's half reads as, or would once it has a credential: the winning assignment's. */
const readerIdOf = (deps: Pick<AccountsDeps, "credentials">, registration: Registration, role: SourceRole): string | null => {
  const lookup = lookupOf(deps.credentials, registration, role);
  return lookup.found ? lookup.credential.accountId : (lookup.account?.id ?? null);
};

const rolesOf = (registration: Registration): SourceRole[] => (trackerHalf(registration.tracker) === null ? ["forge"] : ["forge", "tracker"]);

/** Every registered fleet's halves that read as an account, or would once it has a credential. */
const fleetsReadingAs = (deps: Pick<AccountsDeps, "credentials" | "store">, accountId: string): { readonly fleet: StoredFleet; readonly role: SourceRole }[] =>
  deps.store.listFleets().flatMap((fleet) => rolesOf(fleet.registration).filter((role) => readerIdOf(deps, fleet.registration, role) === accountId).map((role) => ({ fleet, role })));

const fleetByName = (deps: Pick<AccountsDeps, "store">, name: string | undefined): StoredFleet | null => {
  if (name === undefined) return null;
  const repo = parseRepo(name);
  return repo === null ? null : deps.store.getFleet(repoId(repo));
};

/** `acme/api`, `team ENG`, `OPS`, a site: what an assignment's scope covers, as a person reads it. */
const scopeWhat = (scope: string): string => {
  const prefix = parsePrefix(scope);
  if (prefix === null) return scope;
  if (prefix.kind === "repo") return prefix.path.length === 0 ? prefix.host : prefix.path.join("/");
  if (prefix.kind === "linear") return prefix.team === null ? "every Linear team" : `team ${prefix.team}`;
  return prefix.project ?? prefix.site;
};

// ---- Settings ----

const KIND_LABELS: Readonly<Record<CredentialKind, string>> = {
  "fine-grained": "fine-grained token",
  classic: "classic token",
  "gitlab-token": "personal access token",
  "linear-key": "API key",
  "jira-token": "API token",
  gh: "gh login",
  glab: "glab login",
};

const reachesText = (account: Account, credential: AccountCredential): string => {
  if (credential.owner !== null) return credential.owner;
  switch (account.service) {
    case "github":
      return `every owner on ${account.place}`;
    case "gitlab":
      return account.place;
    case "linear":
      return "every team the key reaches";
    case "jira":
      return account.place;
  }
};

const loginCommand = (account: Pick<Account, "via" | "place">): string => (account.via === "glab" ? `glab auth login --hostname ${account.place}` : `gh auth login --hostname ${account.place}`);

const renewOf = (account: Account, credential: AccountCredential, now: Date): CredentialSettingView["renew"] => {
  if (credential.kind === "gh" || credential.kind === "glab") return { kind: "login", command: loginCommand(account) };
  if (credential.kind === "fine-grained" && credential.owner !== null) return { kind: "create", url: githubTokenUrl(account.place, credential.owner, now), owner: credential.owner };
  if (credential.kind === "gitlab-token") return { kind: "create", url: gitlabTokenUrl(account.place, now), owner: null };
  return { kind: "paste" };
};

/** Which fleets read with each credential, by its id, and the ids of the credentials the services refuse now. */
const usageOf = (deps: Pick<AccountsDeps, "store" | "credentials">): { readonly usedBy: Map<string, string[]>; readonly refused: Set<string> } => {
  const usedBy = new Map<string, string[]>();
  const refused = new Set<string>();
  for (const fleet of deps.store.listFleets()) {
    for (const role of rolesOf(fleet.registration)) {
      const lookup = lookupOf(deps.credentials, fleet.registration, role);
      if (!lookup.found) continue;
      usedBy.set(lookup.credential.key, [...new Set([...(usedBy.get(lookup.credential.key) ?? []), formatRepo(fleet.registration.repo)])]);
      const outage = fleet.outages[role]?.refused ?? null;
      if (outage !== null && outage.why === "refused" && outage.credential === lookup.credential.label) refused.add(lookup.credential.key);
    }
  }
  return { usedBy, refused };
};

export async function accountsView(deps: AccountsDeps): Promise<AccountSettingView[]> {
  const now = deps.clock.now();
  const accounts = deps.accounts.accounts();
  const credentials = deps.accounts.credentials();
  const assignments = deps.accounts.assignments();
  const { usedBy, refused } = usageOf(deps);
  return accounts.map((account): AccountSettingView => {
    const own = assignments.filter((assignment) => assignment.accountId === account.id);
    const isDefault = own.some((assignment) => scopeKey(assignment.scope) === scopeKey(defaultScope(account)));
    return {
      id: account.id,
      label: accountLabel(account),
      service: account.service,
      place: account.place,
      name: account.name,
      via: account.via,
      canWrite: account.via !== "token",
      defaultFor: isDefault ? [defaultScope(account)] : [],
      canMakeDefault: !isDefault,
      loginProblem: account.via === "token" ? null : deps.loginStatus.loginProblem(account.id),
      credentials: credentials
        .filter((credential) => credential.accountId === account.id)
        .map((credential): CredentialSettingView => ({
          id: credential.id,
          reaches: reachesText(account, credential),
          kindLabel: KIND_LABELS[credential.kind],
          kind: credential.kind,
          canWrite: canWrite(credential.kind),
          expiresAt: credential.expiresAt,
          expiresInDays: daysLeftToWarn(credential.expiresAt, now),
          refused: refused.has(credential.id),
          fleets: usedBy.get(credential.id) ?? [],
          renew: renewOf(account, credential, now),
        })),
      assignments: own.filter((assignment) => scopeKey(assignment.scope) !== scopeKey(defaultScope(account))).map((assignment) => ({ scope: assignment.scope, what: scopeWhat(assignment.scope) })),
      tokenPage: tokenPageOf(account),
      addsOwners: account.service === "github" && account.via === "token",
    };
  });
}

// ---- the popup's first step ----

/** The accounts on a place as options; `reach` is the owner a credential must reach for the option to skip to verifying. */
const optionsOn = (deps: AccountsDeps, service: ServiceKind | null, place: string, reach: Pick<Half, "owner"> | null): AccountOptionView[] => {
  const accounts = deps.accounts.accounts();
  const assignments = deps.accounts.assignments();
  const credentials = deps.accounts.credentials();
  const on = accounts.filter((account) => account.place === place && (service === null ? account.service === "github" || account.service === "gitlab" : account.service === service));
  const fallback = defaultAccountOf(service, place, assignments, accounts);
  const { refused } = usageOf(deps);
  return on
    .map((account): AccountOptionView => {
      const credential = reach === null ? null : credentialFor(account, reach, credentials);
      return {
        id: account.id,
        label: accountLabel(account),
        via: account.via,
        isDefault: fallback?.id === account.id,
        // A credential the service refuses reaches nothing: the operator goes to the token step for a new one.
        reaches: credential !== null && !refused.has(credential.id),
        canWrite: account.via !== "token" || (credential !== null && canWrite(credential.kind)),
        loginProblem: account.via === "token" ? null : deps.loginStatus.loginProblem(account.id),
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
};

export async function connectView(deps: AccountsDeps, target: ConnectTarget): Promise<Result<{ connect: ConnectView }>> {
  const generatedAt = deps.clock.now().toISOString();
  const accounts = deps.accounts.accounts();
  if (target.fleet !== undefined) {
    const fleet = fleetByName(deps, target.fleet);
    if (fleet === null) return refuse(`no fleet is registered for ${shown(target.fleet)}`);
    const role = target.role ?? "forge";
    const half = halfOf(fleet.registration, role, accounts);
    if (half === null) return refuse(`${formatRepo(fleet.registration.repo)} reads its tracker through its forge`);
    const problem = half.service === "jira" && !isJiraCloudSite(half.place) ? `${half.place} is not a Jira Cloud site: a Jira site ends in .atlassian.net` : null;
    return {
      ok: true,
      connect: {
        generatedAt,
        fleet: formatRepo(fleet.registration.repo),
        role,
        service: half.service,
        place: half.place,
        scope: half.scope,
        owner: half.service === "github" || half.service === null ? half.owner : null,
        what: half.what,
        accounts: problem === null ? optionsOn(deps, half.service, half.place, half) : [],
        current: readerIdOf(deps, fleet.registration, role),
        problem,
      },
    };
  }
  if (target.service === undefined || target.place === undefined) return refuse("name the service and its host or site, or a fleet");
  const place = target.service === "linear" ? LINEAR_PLACE : target.place.trim().toLowerCase();
  const problem = placeProblem(target.service, place);
  const owner = target.service === "github" && target.owner !== undefined && target.owner.trim() !== "" ? target.owner.trim() : null;
  return {
    ok: true,
    connect: {
      generatedAt,
      fleet: null,
      role: null,
      service: target.service,
      place,
      scope: null,
      owner,
      what: null,
      accounts: problem === null ? optionsOn(deps, target.service, place, owner === null ? null : { owner }) : [],
      current: null,
      problem,
    },
  };
}

// ---- the popup's second step ----

/** The account a call names: one the plugin holds, or a new login on a service and place, checked. */
type Chosen = { readonly kind: "held"; readonly account: Account } | { readonly kind: "new"; readonly service: ServiceKind; readonly place: string; readonly apiUrl: string | null };

const choose = (deps: AccountsDeps, account: ConnectInput["account"]): { readonly chosen: Chosen } | { readonly reason: string } => {
  if ("id" in account) {
    const held = deps.accounts.accounts().find((candidate) => candidate.id === account.id);
    return held === undefined ? { reason: "there is no such account" } : { chosen: { kind: "held", account: held } };
  }
  const place = account.service === "linear" ? LINEAR_PLACE : account.place.trim().toLowerCase();
  const problem = placeProblem(account.service, place);
  if (problem !== null) return { reason: problem };
  const apiUrl = "apiUrl" in account && account.apiUrl !== undefined && account.apiUrl.trim() !== "" ? account.apiUrl.trim() : null;
  if (apiUrl !== null) {
    const bad = apiUrlProblem({ service: account.service, place }, apiUrl);
    if (bad !== null) return { reason: bad };
  }
  return { chosen: { kind: "new", service: account.service, place, apiUrl } };
};

const serviceOf = (chosen: Chosen): ServiceKind => (chosen.kind === "held" ? chosen.account.service : chosen.service);
const placeOf = (chosen: Chosen): string => (chosen.kind === "held" ? chosen.account.place : chosen.place);

/**
 * The registered fleets under a GitHub owner on a host that read as an account, or will once this Connect completes:
 * opened for a fleet, Connect assigns the account the fleet's whole owner, so every fleet under it.
 */
const repositoriesToTick = (deps: AccountsDeps, chosen: Chosen, owner: string, opened: StoredFleet | null): string[] => {
  const accounts = deps.accounts.accounts();
  const place = placeOf(chosen);
  const noDefault = defaultAccountOf("github", place, deps.accounts.assignments(), accounts) === null;
  return deps.store
    .listFleets()
    .filter((fleet) => {
      const repo = fleet.registration.repo;
      if (repo.host !== place || repo.path.split("/")[0]!.toLowerCase() !== owner.toLowerCase()) return false;
      if (opened !== null) return true;
      const reader = readerIdOf(deps, fleet.registration, "forge");
      return chosen.kind === "held" ? reader === chosen.account.id : reader === null && noDefault;
    })
    .map((fleet) => fleet.registration.repo.path)
    .sort();
};

export async function tokenPage(deps: AccountsDeps, input: Parameters<DashboardApi["tokenPage"]>[0]): Promise<Result<{ page: TokenPageView }>> {
  const picked = choose(deps, input.account);
  if ("reason" in picked) return refuse(picked.reason);
  const chosen = picked.chosen;
  const service = serviceOf(chosen);
  const place = placeOf(chosen);
  const opened = fleetByName(deps, input.fleet);
  if (input.fleet !== undefined && opened === null) return refuse(`no fleet is registered for ${shown(input.fleet)}`);
  const half = opened === null ? null : halfOf(opened.registration, input.role ?? "forge", deps.accounts.accounts());
  const owner = input.owner?.trim() || (half?.service === "github" || half?.service === null ? half.owner : null) || null;
  const now = deps.clock.now();
  const page: TokenPageView = {
    sentTo: new URL(defaultApiUrl({ service, place })).hostname,
    url: service === "github" ? (owner === null ? null : githubTokenUrl(place, owner, now)) : service === "gitlab" ? gitlabTokenUrl(place, now) : null,
    grants: service === "github" ? [...GITHUB_GRANTS] : service === "gitlab" ? [...GITLAB_SCOPES] : [],
    repositories: service === "github" && owner !== null ? repositoriesToTick(deps, chosen, owner, opened) : [],
    chooseExpiry: service === "gitlab",
    note:
      service === "github" && owner !== null
        ? `GitHub issues a fine-grained token only for an owner you belong to that allows them. If ${owner} is not offered as the resource owner (you are an outside collaborator, or the organisation blocks fine-grained tokens), paste a classic token instead, which can write, or use your gh login.`
        : null,
    signInAs: chosen.kind === "held" ? chosen.account.name : null,
  };
  return { ok: true, page };
}

// ---- Verify and save ----

const notReadableOf = (fleet: Registration, what: string, credential: { readonly label: string; readonly kind: CredentialKind }): NotReadableView => ({
  fleet: formatRepo(fleet.repo),
  fineGrained: credential.kind === "fine-grained",
  text: notReadableText(credential, what),
});

/** The fleet's half as it reads now, for the popup and the card. */
const halfView = async (deps: AccountsDeps, repo: string, role: SourceRole): Promise<HalfView | null> => {
  const fleet = deps.store.getFleet(repo);
  if (fleet === null) return null;
  return halvesOf(await gather(deps, fleet, false)).find((half) => half.role === role) ?? null;
};

/** The token for a secret, or why none can be had. Never returns the reason with a token in it. */
const tokenOf = async (deps: AccountsDeps, chosen: Chosen, input: ConnectInput, half: Half | null): Promise<{ readonly token: string } | { readonly result: ConnectResult }> => {
  const secret = input.secret;
  const service = serviceOf(chosen);
  const invalid = (text: string) => ({ result: { outcome: "invalid" as const, text } });
  switch (secret.kind) {
    case "token": {
      if (service === "jira") return invalid("a Jira account takes its email and an API token");
      if (chosen.kind === "held" && chosen.account.via !== "token") return invalid(`${accountLabel(chosen.account)} reads through its ${chosen.account.via} login and takes no token`);
      const token = secret.token.trim();
      if (token === "" || /\s/.test(token)) return invalid("the token is empty or holds a space");
      return { token };
    }
    case "jira": {
      if (service !== "jira") return invalid("an email and API token are for a Jira account");
      const email = secret.email.trim();
      const token = secret.token.trim();
      if (!/^[^\s@:]+@[^\s@:]+$/.test(email)) return invalid("the email is not an email address");
      if (token === "" || /\s/.test(token)) return invalid("the API token is empty or holds a space");
      return { token: `${email}:${token}` };
    }
    case "login": {
      if (secret.tool === "gh" ? service !== "github" : service !== "gitlab") return invalid(`${secret.tool} is the ${secret.tool === "gh" ? "GitHub" : "GitLab"} login`);
      if (chosen.kind === "held" && chosen.account.via !== secret.tool) return invalid(`${accountLabel(chosen.account)} does not read through ${secret.tool}`);
      if (chosen.kind === "new" && chosen.apiUrl !== null) return invalid(`a ${secret.tool} account takes no API address`);
      const login = chosen.kind === "held" ? chosen.account.login : secret.login.trim();
      try {
        return { token: await deps.logins.token(secret.tool, placeOf(chosen), login) };
      } catch {
        return { result: { outcome: "unreachable", text: `${secret.tool} gave no token for ${shown(login)} on ${placeOf(chosen)}. Run ${secret.tool} auth login --hostname ${placeOf(chosen)} as ${shown(login)}.` } };
      }
    }
    case "stored": {
      if (chosen.kind !== "held" || half === null) return invalid("only an account the plugin holds has a stored credential");
      const credential = credentialFor(chosen.account, half, deps.accounts.credentials());
      if (credential === null) return invalid(`${accountLabel(chosen.account)} holds no credential reaching ${half.what}`);
      try {
        return { token: await deps.credentials.token(resolvedOf(chosen.account, credential)) };
      } catch (error) {
        const text = error instanceof Error ? shown(error.message) : "no token could be had";
        // A gh or glab login signed in as another user is put right by signing in again; any other failure of the tool
        // (not signed in, not installed, too slow) is said as it is, with the same command for the case it fits.
        if (chosen.account.via === "token") return { result: { outcome: "unreachable", text } };
        if (text.startsWith(`${chosen.account.via} is signed in as `)) return { result: { outcome: "wrong-login", text: `${text}.`, command: loginCommand(chosen.account) } };
        return { result: { outcome: "unreachable", text: `${text}. If ${chosen.account.via} is not signed in as ${chosen.account.name}, run ${loginCommand(chosen.account)}.` } };
      }
    }
  }
};

export async function connect(deps: AccountsDeps, input: ConnectInput): Promise<ConnectResult> {
  const picked = choose(deps, input.account);
  if ("reason" in picked) return { outcome: "invalid", text: picked.reason };
  let chosen = picked.chosen;
  const accounts = deps.accounts.accounts();

  // The fleet's half, which the account must be on.
  const opened = fleetByName(deps, input.fleet);
  if (input.fleet !== undefined && opened === null) return { outcome: "invalid", text: `no fleet is registered for ${shown(input.fleet)}` };
  const role = input.role ?? "forge";
  const half = opened === null ? null : halfOf(opened.registration, role, accounts);
  if (opened !== null && half === null) return { outcome: "invalid", text: `${formatRepo(opened.registration.repo)} reads its tracker through its forge` };
  if (half !== null) {
    const scope = parsePrefix(half.scope)!;
    const service = serviceOf(chosen);
    if (half.service !== null && half.service !== service) return { outcome: "invalid", text: `${half.what} is read from ${SERVICE_NAMES[half.service]}, not ${SERVICE_NAMES[service]}` };
    const account = chosen.kind === "held" ? chosen.account : { service, place: chosen.place, name: "a new login" };
    if (!accountCovers(account, scope)) return { outcome: "invalid", text: assignmentProblem(half.scope, account) ?? `${half.scope} cannot be read as that account` };
  }
  if (serviceOf(chosen) === "jira" && !isJiraCloudSite(placeOf(chosen))) return { outcome: "invalid", text: `${placeOf(chosen)} is not a Jira Cloud site: a Jira site ends in .atlassian.net` };

  const got = await tokenOf(deps, chosen, input, half);
  if ("result" in got) return got.result;
  const token = got.token;
  const service = serviceOf(chosen);
  const place = placeOf(chosen);
  const api = chosen.kind === "held" ? apiOf(chosen.account) : apiOf({ service, place, apiUrl: chosen.apiUrl });
  const via = input.secret.kind === "login" ? input.secret.tool : chosen.kind === "held" ? chosen.account.via : "token";

  const identified = await deps.probe.identify({ service, ...api }, token);
  if (!identified.ok) {
    return identified.why === "refused"
      ? { outcome: "refused", text: `${SERVICE_NAMES[service]} rejected the ${via === "token" ? "token" : `${via} login`}. Nothing was stored.` }
      : { outcome: "unreachable", text: `${SERVICE_NAMES[service]} could not be asked whose the token is (${shown(identified.reason)}). Nothing was stored.` };
  }

  // Whose it is: a held account reads only as its own login; a new login is shown before it is added.
  if (chosen.kind === "held" && identified.login.toLowerCase() !== chosen.account.login.toLowerCase()) {
    const account = chosen.account;
    if (via === "token") return { outcome: "wrong-login", text: `This token belongs to ${shown(identified.name)}, not ${account.name}. Sign in as ${account.name} and create the token again.`, command: null };
    return { outcome: "wrong-login", text: `${via} is signed in as ${shown(identified.name)}, not ${account.name}.`, command: loginCommand(account) };
  }
  if (chosen.kind === "new") {
    if (input.secret.kind === "login" && identified.login.toLowerCase() !== input.secret.login.trim().toLowerCase()) {
      return { outcome: "wrong-login", text: `${via} gave a token of ${shown(identified.name)}, not ${shown(input.secret.login)}.`, command: `${via} auth login --hostname ${place}` };
    }
    const same = accounts.find((account) => account.service === service && account.place === place && account.login.toLowerCase() === identified.login.toLowerCase() && account.via === via);
    // An API address given here answered whose the token is; it may speak for a held account only where it is that account's own.
    if (same !== undefined && chosen.apiUrl !== null && same.apiUrl !== chosen.apiUrl) {
      return { outcome: "invalid", text: `${accountLabel(same)} is already held, with its own API address: choose it rather than a new login` };
    }
    if (same !== undefined) chosen = { kind: "held", account: same };
    // A token's or key's login is shown for the operator to confirm; a gh or glab login was picked from the tool's own and checked above.
    else if (input.confirm !== true && input.secret.kind !== "login") {
      const label = accountLabel({ service, name: identified.name });
      return { outcome: "confirm", login: identified.name, label, text: `This ${via === "token" ? (service === "linear" ? "key" : "token") : `${via} login`} belongs to ${shown(identified.name)}. Add as ${shown(label)}?` };
    }
  }

  const now = deps.clock.now().toISOString();
  const kind: CredentialKind = via === "gh" || via === "glab" ? via : pastedKind(service, identified.classic);
  const owner = kind === "fine-grained" ? (input.owner?.trim() || half?.owner || null) : null;
  if (kind === "fine-grained" && owner === null) return { outcome: "invalid", text: "name the owner the token is for" };

  // Stored from here on.
  let account: Account;
  if (chosen.kind === "new") {
    account = { id: deps.newId(), service, place, login: identified.login, name: identified.name, via, apiUrl: chosen.apiUrl, addedAt: now };
    deps.accounts.addAccount(account);
    if (defaultAccountOf(service, place, deps.accounts.assignments(), deps.accounts.accounts().filter((candidate) => candidate.id !== account.id)) === null) deps.accounts.assign(defaultScope(account), account.id);
  } else {
    account = chosen.account;
  }
  let credential: AccountCredential | null = null;
  if (input.secret.kind !== "stored") {
    const replaced = input.replaces === undefined ? null : (deps.accounts.credentials().find((candidate) => candidate.id === input.replaces && candidate.accountId === account.id) ?? null);
    credential = { id: deps.newId(), accountId: account.id, kind, owner, expiresAt: identified.expiresAt, addedAt: now };
    deps.accounts.saveCredential(credential, via === "token" ? token : null);
    if (replaced !== null && deps.accounts.credentials().some((candidate) => candidate.id === replaced.id)) deps.accounts.removeCredential(replaced.id);
    if (via !== "token") deps.loginStatus.forget(account.id);
  } else if (half !== null) {
    credential = credentialFor(account, half, deps.accounts.credentials());
  }

  // The assignment Connect makes: the chosen account reads the half's owner, group, team or project, or the default does.
  if (half !== null) {
    const fallback = defaultAccountOf(service, place, deps.accounts.assignments(), deps.accounts.accounts());
    if (fallback?.id === account.id) deps.accounts.unassign(half.scope);
    else deps.accounts.assign(half.scope, account.id);
  }

  // Which fleets this credential now reads, and whether it can, asked of every one at once.
  const reads: { readonly fleet: StoredFleet; readonly role: SourceRole; readonly half: Half }[] = [];
  if (credential !== null) {
    const accountsNow = deps.accounts.accounts();
    for (const fleet of deps.store.listFleets()) {
      for (const fleetRole of rolesOf(fleet.registration)) {
        const lookup = lookupOf(deps.credentials, fleet.registration, fleetRole);
        const fleetHalf = halfOf(fleet.registration, fleetRole, accountsNow);
        if (lookup.found && lookup.credential.key === credential.id && fleetHalf !== null) reads.push({ fleet, role: fleetRole, half: fleetHalf });
      }
    }
  }
  const label = credential === null ? accountLabel(account) : credentialLabel(account, credential);
  const answers = await Promise.all(reads.map((read) => deps.probe.canRead({ service, ...api }, token, read.half)));
  const notReadable: NotReadableView[] = [];
  reads.forEach((read, at) => {
    const readable = answers[at]!;
    const repo = repoId(read.fleet.registration.repo);
    if (readable === "readable") deps.accounts.setAccessProblem(repo, read.role, null);
    else if (readable === "not-found" || readable === "forbidden") {
      deps.accounts.setAccessProblem(repo, read.role, { credentialId: credential!.id, why: readable, at: now });
      notReadable.push(notReadableOf(read.fleet.registration, read.half.what, { label, kind }));
    }
  });
  // Read at once, so what the popup answers into shows the result without waiting for the next poll. Opened for a fleet,
  // that is the fleet: the others it reaches are read behind it, and their cards follow when they are. Opened from
  // Settings, which shows each credential's standing, it is every fleet the credential reads.
  const others = new Set(reads.map((read) => repoId(read.fleet.registration.repo)));
  const awaited = opened === null ? [...others] : [repoId(opened.registration.repo)];
  for (const repo of awaited) others.delete(repo);
  for (const repo of others) void deps.readNow(repo).catch(() => undefined);
  await Promise.all(awaited.map((repo) => deps.readNow(repo).catch(() => undefined)));
  deps.events.boardChanged();

  const replacedNotice = input.replaces !== undefined && input.secret.kind !== "stored" ? revokeNotice(account) : null;
  return {
    outcome: "saved",
    account: { id: account.id, label: accountLabel(account) },
    login: account.name,
    expiresAt: credential?.expiresAt ?? null,
    canWrite: credential === null ? account.via !== "token" : canWrite(credential.kind),
    notReadable,
    half: opened === null ? null : await halfView(deps, repoId(opened.registration.repo), role),
    revoke: replacedNotice,
  };
}

export async function checkAgain(deps: AccountsDeps, input: { fleet: string; role: SourceRole }): Promise<Result<{ half: HalfView; notReadable: readonly NotReadableView[] }>> {
  const fleet = fleetByName(deps, input.fleet);
  if (fleet === null) return refuse(`no fleet is registered for ${shown(input.fleet)}`);
  const repo = repoId(fleet.registration.repo);
  const accounts = deps.accounts.accounts();
  const half = halfOf(fleet.registration, input.role, accounts);
  if (half === null) return refuse(`${formatRepo(fleet.registration.repo)} reads its tracker through its forge`);
  const lookup = lookupOf(deps.credentials, fleet.registration, input.role);
  const notReadable: NotReadableView[] = [];
  if (lookup.found) {
    const account = accounts.find((candidate) => candidate.id === lookup.credential.accountId);
    if (account !== undefined && lookup.credential.auth !== "token") deps.loginStatus.forget(account.id);
    const token = await deps.credentials.token(lookup.credential).catch(() => null);
    if (account !== undefined && token !== null) {
      const readable = await deps.probe.canRead({ service: account.service, ...apiOf(account) }, token, half);
      const now = deps.clock.now().toISOString();
      if (readable === "readable") deps.accounts.setAccessProblem(repo, input.role, null);
      else if (readable === "not-found" || readable === "forbidden") {
        deps.accounts.setAccessProblem(repo, input.role, { credentialId: lookup.credential.key, why: readable, at: now });
        notReadable.push(notReadableOf(fleet.registration, half.what, lookup.credential));
      }
    }
  }
  await deps.readNow(repo).catch(() => undefined);
  deps.events.boardChanged();
  const view = await halfView(deps, repo, input.role);
  return view === null ? refuse(`no fleet is registered for ${shown(input.fleet)}`) : { ok: true, half: view, notReadable };
}

// ---- managing accounts ----

/** After a Remove or a Renew: the plugin's copy is gone, the token is not. */
export const revokeNotice = (account: Pick<Account, "service" | "place">): RevokeNotice => ({
  text: `The old token still works at ${SERVICE_NAMES[account.service]} until it expires or is revoked there.`,
  url: tokenPageOf(account),
});

const accountById = (deps: AccountsDeps, accountId: string): Account | null => deps.accounts.accounts().find((account) => account.id === accountId) ?? null;

export const makeDefault = (deps: AccountsDeps, accountId: string): Result<object> => {
  const account = accountById(deps, accountId);
  if (account === null) return refuse("there is no such account");
  deps.accounts.assign(defaultScope(account), account.id);
  deps.events.boardChanged();
  return { ok: true };
};

export const removeAssignment = (deps: AccountsDeps, scope: string): Result<object> => {
  const known = deps.accounts.assignments().find((assignment) => scopeKey(assignment.scope) === scopeKey(scope));
  if (known === undefined) return refuse(`nothing is assigned ${shown(scope)}`);
  const account = accountById(deps, known.accountId);
  if (account !== null && scopeKey(defaultScope(account)) === scopeKey(known.scope)) return refuse(`${known.scope} is ${accountLabel(account)}'s default: make another account the default instead`);
  deps.accounts.unassign(known.scope);
  deps.events.boardChanged();
  return { ok: true };
};

export const removeCredential = (deps: AccountsDeps, credentialId: string): Result<{ revoke: RevokeNotice }> => {
  const credential = deps.accounts.credentials().find((candidate) => candidate.id === credentialId);
  const account = credential === undefined ? null : accountById(deps, credential.accountId);
  if (credential === undefined || account === null) return refuse("there is no such credential");
  deps.accounts.removeCredential(credentialId);
  deps.events.boardChanged();
  const revoke: RevokeNotice =
    credential.kind === "gh" || credential.kind === "glab"
      ? { text: `The ${credential.kind} login stays signed in on this machine; ${credential.kind} auth logout signs it out.`, url: tokenPageOf(account) }
      : revokeNotice(account);
  return { ok: true, revoke };
};

export const removeAccount = (deps: AccountsDeps, accountId: string): Result<{ revoke: RevokeNotice | null }> => {
  const account = accountById(deps, accountId);
  if (account === null) return refuse("there is no such account");
  const reading = [...new Set(fleetsReadingAs(deps, accountId).map(({ fleet }) => formatRepo(fleet.registration.repo)))].sort();
  if (reading.length > 0) return refuse(`${accountLabel(account)} still reads ${reading.join(", ")}: connect ${reading.length === 1 ? "it" : "them"} to another account first`);
  const hadToken = deps.accounts.credentials().some((credential) => credential.accountId === accountId && credential.kind !== "gh" && credential.kind !== "glab");
  deps.accounts.removeAccount(accountId);
  deps.loginStatus.forget(accountId);
  deps.events.boardChanged();
  return { ok: true, revoke: hadToken ? revokeNotice(account) : null };
};
