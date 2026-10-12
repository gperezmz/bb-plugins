// What the Connect popup asks, says and sends, decided from the request and the views alone.
import type { ConnectInput, ConnectResult, ConnectSecret, ConnectTarget, ConnectView, HalfView, NotReadableView, TokenPageView } from "@/src/fleet/application/views";
import type { ConnectRequest } from "./requests";

export type Service = NonNullable<ConnectTarget["service"]>;
type Account = ConnectInput["account"];

export const SERVICE_NAMES: Readonly<Record<Service, string>> = { github: "GitHub", gitlab: "GitLab", linear: "Linear", jira: "Jira" };
export const SERVICES: readonly Service[] = ["github", "gitlab", "linear", "jira"];
/** The place Linear's key is sent to is no choice of the operator's. */
export const LINEAR_PLACE = "linear.app";
const DEFAULT_HOSTS: Partial<Record<Service, string>> = { github: "github.com", gitlab: "gitlab.com" };

// ---- Add account: what is asked before any account is listed ----

/** What the operator typed while a service, place and owner were asked. */
export interface Setup {
  readonly service: Service | "";
  readonly place: string;
  readonly owner: string;
}

export interface SetupFields {
  readonly service: boolean;
  readonly place: boolean;
  readonly owner: boolean;
}

/** What a request starts with: the part of its target that is already known. */
export function initialSetup(request: ConnectRequest): Setup {
  const { service, place, owner } = request.target;
  return { service: service ?? "", place: place ?? "", owner: owner ?? "" };
}

const hasFleet = (request: ConnectRequest): boolean => request.target.fleet !== undefined;

/** Which of the three the popup has to ask: only a request with no fleet asks, and only for what it was not given. */
export function setupFields(request: ConnectRequest, setup: Setup): SetupFields {
  if (hasFleet(request)) return { service: false, place: false, owner: false };
  const service = request.target.service === undefined;
  const chosen = setup.service === "" ? null : setup.service;
  return {
    service,
    place: request.target.place === undefined && chosen !== "linear",
    owner: request.target.owner === undefined && chosen === "github",
  };
}

/** True while the popup must ask before it can list accounts. */
export function needsSetup(request: ConnectRequest): boolean {
  const fields = setupFields(request, initialSetup(request));
  return fields.service || fields.place || fields.owner;
}

/** A host or site as typed: without scheme, path or case. */
export function placeFrom(text: string): string {
  return text.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

/** The setup after the operator picked a service: the host most operators mean is offered. */
export function withService(setup: Setup, service: Service | ""): Setup {
  const wasDefault = setup.place === "" || setup.place === (DEFAULT_HOSTS[setup.service as Service] ?? "");
  const place = wasDefault ? (service === "" ? "" : (DEFAULT_HOSTS[service] ?? "")) : setup.place;
  return { ...setup, service, place };
}

export function placeLabel(service: Service | ""): string {
  return service === "jira" ? "Jira site" : "Host";
}

/** Why the setup cannot be sent yet, or null. */
export function setupProblem(request: ConnectRequest, setup: Setup): string | null {
  const fields = setupFields(request, setup);
  if (fields.service && setup.service === "") return "Choose the service.";
  if (fields.place && placeFrom(setup.place) === "") return `Enter the ${placeLabel(setup.service).toLowerCase()}.`;
  if (fields.owner && setup.owner.trim() === "") return "Enter the owner, an organisation or a user, the token is for.";
  return null;
}

/** The target the popup asks the server about: the fleet's half, or the service, place and owner typed. */
export function targetOf(request: ConnectRequest, setup: Setup): ConnectTarget {
  const { fleet, role } = request.target;
  if (fleet !== undefined) return { fleet, ...(role !== undefined ? { role } : {}) };
  const service = request.target.service ?? (setup.service === "" ? undefined : setup.service);
  const owner = (request.target.owner ?? setup.owner).trim();
  const place = service === "linear" ? LINEAR_PLACE : placeFrom(request.target.place ?? setup.place);
  return {
    ...(service !== undefined ? { service } : {}),
    ...(place !== "" ? { place } : {}),
    ...(service === "github" && owner !== "" ? { owner } : {}),
  };
}

// ---- step 1: which account ----

export type AccountChoice =
  | { readonly kind: "existing"; readonly id: string; readonly label: string; readonly reaches: boolean }
  | { readonly kind: "new"; readonly service: Service; readonly place: string };

export const NEW_LOGIN = "new";

/** The option selected at first: the account the half reads as, else the default, which the server lists first. */
export function initialOption(view: ConnectView): string {
  const known = (id: string | null) => (id !== null && view.accounts.some((account) => account.id === id) ? id : null);
  return known(view.current) ?? view.accounts[0]?.id ?? NEW_LOGIN;
}

/** The service a new login is for: the one the place names, else the one the operator chose; null while neither. */
export function newLoginService(view: ConnectView, chosen: Service | null): Service | null {
  return view.service ?? chosen;
}

/** An option of step 1 as an account choice; null for a new login whose service is not yet known. */
export function choiceFor(view: ConnectView, option: string, chosen: Service | null): AccountChoice | null {
  if (option === NEW_LOGIN) {
    const service = newLoginService(view, chosen);
    return service === null ? null : { kind: "new", service, place: view.place };
  }
  const account = view.accounts.find((candidate) => candidate.id === option);
  return account === undefined ? null : { kind: "existing", id: account.id, label: account.label, reaches: account.reaches };
}

/** An account that already holds a credential reaching the half goes straight to verifying. */
export function goesStraight(choice: AccountChoice, view: ConnectView): boolean {
  return choice.kind === "existing" && choice.reaches && view.fleet !== null;
}

/** The account the server is told about. */
export function accountOf(choice: AccountChoice): Account {
  return choice.kind === "existing" ? { id: choice.id } : { service: choice.service, place: choice.place };
}

/** True where step 1 first asks GitHub or GitLab: the host names no service and no account is on it. */
export function asksService(view: ConnectView, chosen: Service | null): boolean {
  return view.service === null && chosen === null;
}

export function dialogTitle(request: ConnectRequest, view: ConnectView | null): string {
  if (request.replaces !== undefined) return "Renew a token";
  if (hasFleet(request)) {
    const role = request.target.role ?? view?.role ?? null;
    const what = view?.what ?? request.target.fleet;
    return role === "tracker" ? `Connect the tracker of ${request.target.fleet} (${what})` : `Connect ${what}`;
  }
  return request.account !== undefined ? "Add a token" : "Add account";
}

// ---- step 2: the credential ----

export type Method = "paste" | "login";

export function loginTool(service: Service): "gh" | "glab" | null {
  return service === "github" ? "gh" : service === "gitlab" ? "glab" : null;
}

export const secretNoun = (service: Service): string => (service === "linear" ? "key" : "token");

/** The label of the secret's field: Jira and Linear name their own. */
export function secretLabel(service: Service): string {
  return service === "jira" ? "API token" : service === "linear" ? "API key" : "Token";
}

/** Which of the logins `gh` or `glab` holds to preselect: the account's own, where the label names it. */
export function defaultLogin(logins: readonly string[], accountLabel: string | null): string {
  const named = accountLabel === null ? undefined : logins.find((login) => accountLabel.endsWith(` ${login}`) || accountLabel.endsWith(`· ${login}`));
  return named ?? logins[0] ?? "";
}

export function signInText(page: TokenPageView): string {
  return page.signInAs !== null ? `Make sure your browser is signed in as ${page.signInAs} before you create the token.` : "Make sure your browser is signed in as the login you are adding before you create the token.";
}

export function sentToText(service: Service, page: TokenPageView): string {
  return `The ${secretNoun(service)} will be sent to ${page.sentTo}, and to nowhere else.`;
}

export interface SecretFields {
  readonly method: Method;
  readonly email: string;
  /** Whether the secret's field has text; the text itself is read from the field when it is sent. */
  readonly typed: boolean;
  readonly login: string;
}

/** Why the credential cannot be sent yet, or null. */
export function secretProblem(service: Service, fields: SecretFields): string | null {
  if (fields.method === "login") return fields.login === "" ? "No login is available." : null;
  if (service === "jira" && fields.email.trim() === "") return "Enter the account's email.";
  return fields.typed ? null : `Paste the ${secretNoun(service)}.`;
}

/** The secret to send; `token` is read from its field at the moment of sending and is not kept. */
export function secretFor(service: Service, fields: SecretFields, token: string): ConnectSecret {
  if (fields.method === "login") return { kind: "login", tool: loginTool(service) ?? "gh", login: fields.login };
  if (service === "jira") return { kind: "jira", email: fields.email.trim(), token: token.trim() };
  return { kind: "token", token: token.trim() };
}

/** The call for a request, the account chosen and the secret; `confirm` re-sends it once the operator confirmed a new login. */
export function connectInput(request: ConnectRequest, setup: Setup, choice: AccountChoice, secret: ConnectSecret, confirm = false): ConnectInput {
  return {
    ...targetOf(request, setup),
    account: accountOf(choice),
    secret,
    ...(confirm ? { confirm: true } : {}),
    ...(request.replaces !== undefined ? { replaces: request.replaces } : {}),
  };
}

// ---- step 3: the outcome ----

export type ResultAction = "confirm" | "check-again" | "another-credential" | "choose-another-account";

/** What the operator may do next with an outcome. Closing the popup is always offered beside them. */
export function resultActions(result: ConnectResult, canCheck: boolean): readonly ResultAction[] {
  switch (result.outcome) {
    case "confirm":
      return ["confirm"];
    case "refused":
    case "wrong-login":
      return canCheck ? ["check-again", "another-credential"] : ["another-credential"];
    case "unreachable":
    case "invalid":
      return ["another-credential"];
    case "saved": {
      if (result.notReadable.length === 0) return [];
      return [
        ...(canCheck ? (["check-again"] as const) : []),
        "another-credential",
        ...(result.notReadable.some((entry) => !entry.fineGrained) ? (["choose-another-account"] as const) : []),
      ];
    }
  }
}

export function actionLabel(action: ResultAction, result: ConnectResult): string {
  switch (action) {
    case "confirm":
      return result.outcome === "confirm" ? `Add as ${result.label}` : "Add";
    case "check-again":
      return "Check again";
    case "another-credential":
      return result.outcome === "unreachable" ? "Try again" : "Use another credential";
    case "choose-another-account":
      return "Choose another account";
  }
}

/** How a half stands after a read: what it needs, or the account it reads as. */
export function halfText(half: HalfView): string {
  if (half.needs !== null) return `${half.what} still needs an account: ${half.needs}`;
  return half.account !== null ? `${half.what} is read as ${half.account.label}.` : `${half.what} is read.`;
}

// ---- the flow ----

export type Step = "setup" | "account" | "token" | "result";

export interface Checked {
  readonly half: HalfView;
  readonly notReadable: readonly NotReadableView[];
}

export interface ConnectState {
  readonly step: Step;
  /** A call is in flight. */
  readonly busy: boolean;
  /** Why the latest call failed, or the server's refusal of it. */
  readonly failure: string | null;
  readonly setup: Setup;
  readonly view: ConnectView | null;
  /** The service the operator chose where the host names none. */
  readonly chosenService: Service | null;
  readonly choice: AccountChoice | null;
  readonly page: TokenPageView | null;
  readonly logins: readonly string[];
  readonly result: ConnectResult | null;
  readonly checked: Checked | null;
}

export type ConnectEvent =
  | { readonly type: "calling" }
  | { readonly type: "failed"; readonly reason: string }
  | { readonly type: "setup-edited"; readonly setup: Setup }
  | { readonly type: "viewed"; readonly view: ConnectView; readonly step: Step }
  | { readonly type: "service-chosen"; readonly service: Service }
  | { readonly type: "chose"; readonly choice: AccountChoice }
  | { readonly type: "paged"; readonly page: TokenPageView; readonly logins: readonly string[] }
  | { readonly type: "resulted"; readonly result: ConnectResult }
  | { readonly type: "checked"; readonly checked: Checked }
  | { readonly type: "back"; readonly to: Step };

export function initialState(request: ConnectRequest): ConnectState {
  return {
    step: needsSetup(request) ? "setup" : "account",
    busy: !needsSetup(request),
    failure: null,
    setup: initialSetup(request),
    view: null,
    chosenService: null,
    choice: null,
    page: null,
    logins: [],
    result: null,
    checked: null,
  };
}

export function connectReducer(state: ConnectState, event: ConnectEvent): ConnectState {
  switch (event.type) {
    case "calling":
      return { ...state, busy: true, failure: null };
    case "failed":
      return { ...state, busy: false, failure: event.reason };
    case "setup-edited":
      return { ...state, setup: event.setup, failure: null };
    case "viewed":
      return { ...state, busy: false, failure: null, view: event.view, step: event.step };
    case "service-chosen":
      return { ...state, chosenService: event.service };
    case "chose":
      return { ...state, choice: event.choice, page: null, logins: [] };
    case "paged":
      return { ...state, busy: false, failure: null, step: "token", page: event.page, logins: event.logins, result: null };
    case "resulted":
      return { ...state, busy: false, failure: null, step: "result", result: event.result, checked: null };
    case "checked":
      return { ...state, busy: false, failure: null, checked: event.checked };
    case "back":
      return { ...state, step: event.to, busy: false, failure: null, result: null, checked: null };
  }
}
