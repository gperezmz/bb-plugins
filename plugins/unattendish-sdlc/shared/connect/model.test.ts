import { describe, expect, it } from "vitest";
import { accountOption, connectView } from "@/testing/fixtures";
import {
  actionLabel,
  asksService,
  choiceFor,
  connectInput,
  connectReducer,
  defaultLogin,
  dialogTitle,
  goesStraight,
  halfText,
  initialOption,
  initialSetup,
  initialState,
  needsSetup,
  NEW_LOGIN,
  placeFrom,
  remedyText,
  resultActions,
  secretFor,
  secretProblem,
  sentToText,
  setupFields,
  setupProblem,
  targetOf,
  withService,
  type Setup,
} from "./model";
import type { ConnectRequest } from "./requests";

const fleetRequest: ConnectRequest = { target: { fleet: "github.com/acme/web", role: "forge" } };
const addAccount: ConnectRequest = { target: {} };
const empty: Setup = { service: "", place: "", owner: "" };

describe("what Add account asks", () => {
  it("asks nothing for a fleet's half", () => {
    expect(needsSetup(fleetRequest)).toBe(false);
  });

  it("asks the service first, then the host, and the owner only on GitHub", () => {
    expect(setupFields(addAccount, empty)).toEqual({ service: true, place: true, owner: false });
    expect(setupFields(addAccount, { ...empty, service: "github" })).toEqual({ service: true, place: true, owner: true });
    expect(setupFields(addAccount, { ...empty, service: "jira" })).toEqual({ service: true, place: true, owner: false });
  });

  it("asks Linear for no host: the key goes to linear.app", () => {
    expect(setupFields(addAccount, { ...empty, service: "linear" })).toEqual({ service: true, place: false, owner: false });
    expect(targetOf(addAccount, { ...empty, service: "linear" })).toEqual({ service: "linear", place: "linear.app" });
  });

  it("asks only the owner when Add token for another owner names the account's service and host", () => {
    const request: ConnectRequest = { target: { service: "github", place: "github.com" }, account: "acc_1" };
    expect(setupFields(request, initialSetup(request))).toEqual({ service: false, place: false, owner: true });
    expect(needsSetup(request)).toBe(true);
  });

  it("asks nothing for a Renew that names the owner", () => {
    expect(needsSetup({ target: { service: "github", place: "github.com", owner: "acme" }, account: "acc_1", replaces: "cred_1" })).toBe(false);
  });

  it("offers the usual host when a service is picked, and keeps one the operator typed", () => {
    expect(withService(empty, "github").place).toBe("github.com");
    expect(withService(withService(empty, "github"), "gitlab").place).toBe("gitlab.com");
    expect(withService({ ...empty, service: "gitlab", place: "gitlab.example.com" }, "github").place).toBe("gitlab.example.com");
    expect(withService(empty, "jira").place).toBe("");
  });

  it("says what is missing before it can go on", () => {
    expect(setupProblem(addAccount, empty)).toBe("Choose the service.");
    expect(setupProblem(addAccount, { ...empty, service: "jira" })).toBe("Enter the jira site.");
    expect(setupProblem(addAccount, { service: "github", place: "github.com", owner: " " })).toBe("Enter the owner, an organisation or a user, the token is for.");
    expect(setupProblem(addAccount, { service: "github", place: "github.com", owner: "zorg" })).toBeNull();
  });

  it("reads a host as typed: no scheme, path or case", () => {
    expect(placeFrom(" https://GitLab.Example.com/groups ")).toBe("gitlab.example.com");
  });
});

describe("the target the server is asked about", () => {
  it("is the fleet's half for a fleet", () => {
    expect(targetOf(fleetRequest, empty)).toEqual({ fleet: "github.com/acme/web", role: "forge" });
  });

  it("is the service, host and owner typed for Add account, with an owner only on GitHub", () => {
    expect(targetOf(addAccount, { service: "github", place: "GitHub.com", owner: " zorg " })).toEqual({ service: "github", place: "github.com", owner: "zorg" });
    expect(targetOf(addAccount, { service: "gitlab", place: "gitlab.example.com", owner: "ignored" })).toEqual({ service: "gitlab", place: "gitlab.example.com" });
  });
});

describe("step 1", () => {
  const view = connectView({ accounts: [accountOption({ id: "a_default" }), accountOption({ id: "a_other", label: "GitHub · buser", isDefault: false, reaches: true })] });

  it("preselects the account the half reads as, else the default, else a new login", () => {
    expect(initialOption(view)).toBe("a_default");
    expect(initialOption({ ...view, current: "a_other" })).toBe("a_other");
    expect(initialOption({ ...view, accounts: [] })).toBe(NEW_LOGIN);
  });

  it("goes straight to verifying only for an account that already reaches the fleet", () => {
    expect(goesStraight(choiceFor(view, "a_other", null)!, view)).toBe(true);
    expect(goesStraight(choiceFor(view, "a_default", null)!, view)).toBe(false);
    expect(goesStraight(choiceFor(view, NEW_LOGIN, null)!, view)).toBe(false);
    expect(goesStraight(choiceFor(view, "a_other", null)!, { ...view, fleet: null })).toBe(false);
  });

  it("makes a new login of the service the host names", () => {
    expect(choiceFor(view, NEW_LOGIN, null)).toEqual({ kind: "new", service: "github", place: "github.com" });
  });

  it("asks GitHub or GitLab first where the host names none, and takes the answer", () => {
    const unknown = connectView({ service: null, place: "git.example.com", accounts: [] });
    expect(asksService(unknown, null)).toBe(true);
    expect(asksService(unknown, "gitlab")).toBe(false);
    expect(choiceFor(unknown, NEW_LOGIN, null)).toBeNull();
    expect(choiceFor(unknown, NEW_LOGIN, "gitlab")).toEqual({ kind: "new", service: "gitlab", place: "git.example.com" });
  });

  it("titles the popup for what it is opened for", () => {
    expect(dialogTitle(fleetRequest, view)).toBe("Connect acme/web");
    expect(dialogTitle({ target: { fleet: "acme/web", role: "tracker" } }, connectView({ role: "tracker", what: "OPS" }))).toBe("Connect the tracker of acme/web (OPS)");
    expect(dialogTitle(addAccount, null)).toBe("Add account");
    expect(dialogTitle({ ...addAccount, replaces: "c" }, null)).toBe("Renew a token");
  });
});

describe("step 2", () => {
  const page = { sentTo: "api.github.com" } as never;

  it("names where the token goes", () => {
    expect(sentToText("github", page)).toBe("The token will be sent to api.github.com, and to nowhere else.");
    expect(sentToText("linear", page)).toBe("The key will be sent to api.github.com, and to nowhere else.");
  });

  it("will not send before the secret is given", () => {
    expect(secretProblem("github", { method: "paste", email: "", typed: false, login: "" })).toBe("Paste the token.");
    expect(secretProblem("github", { method: "paste", email: "", typed: true, login: "" })).toBeNull();
    expect(secretProblem("jira", { method: "paste", email: " ", typed: true, login: "" })).toBe("Enter the account's email.");
    expect(secretProblem("github", { method: "login", email: "", typed: false, login: "" })).toBe("No login is available.");
    expect(secretProblem("github", { method: "login", email: "", typed: false, login: "yuser" })).toBeNull();
  });

  it("builds the secret each service takes", () => {
    const fields = { method: "paste", email: " ops@acme.com ", typed: true, login: "yuser" } as const;
    expect(secretFor("github", fields, " tok ")).toEqual({ kind: "token", token: "tok" });
    expect(secretFor("linear", fields, "key")).toEqual({ kind: "token", token: "key" });
    expect(secretFor("jira", fields, "tok")).toEqual({ kind: "jira", email: "ops@acme.com", token: "tok" });
    expect(secretFor("gitlab", { ...fields, method: "login" }, "")).toEqual({ kind: "login", tool: "glab", login: "yuser" });
  });

  it("preselects the gh login the account's label names", () => {
    expect(defaultLogin(["other", "buser"], "GitHub · buser")).toBe("buser");
    expect(defaultLogin(["other"], null)).toBe("other");
    expect(defaultLogin([], null)).toBe("");
  });

  it("sends the target, the account and the secret, and says when the login was confirmed or a credential replaced", () => {
    const choice = { kind: "new", service: "github", place: "github.com" } as const;
    expect(connectInput(fleetRequest, empty, choice, { kind: "token", token: "t" })).toEqual({
      fleet: "github.com/acme/web",
      role: "forge",
      account: { service: "github", place: "github.com" },
      secret: { kind: "token", token: "t" },
    });
    const renew: ConnectRequest = { target: { service: "github", place: "github.com", owner: "acme" }, account: "acc_1", replaces: "cred_1" };
    expect(connectInput(renew, initialSetup(renew), { kind: "existing", id: "acc_1", label: "x", reaches: false }, { kind: "stored" }, true)).toEqual({
      service: "github",
      place: "github.com",
      owner: "acme",
      account: { id: "acc_1" },
      secret: { kind: "stored" },
      confirm: true,
      replaces: "cred_1",
    });
  });
});

describe("step 3", () => {
  const saved = (over = {}) => ({ outcome: "saved", account: { id: "a", label: "GitHub · yuser" }, login: "yuser", expiresAt: null, canWrite: false, notReadable: [], half: null, revoke: null, ...over }) as const;

  it("offers what each outcome allows", () => {
    expect(resultActions({ outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "t" }, true)).toEqual(["confirm"]);
    expect(resultActions({ outcome: "refused", text: "t" }, true)).toEqual(["check-again", "another-credential"]);
    expect(resultActions({ outcome: "wrong-login", text: "t", command: null }, true)).toEqual(["check-again", "another-credential"]);
    expect(resultActions({ outcome: "wrong-login", text: "t", command: null }, false)).toEqual(["another-credential"]);
    expect(resultActions({ outcome: "invalid", text: "t" }, true)).toEqual(["another-credential"]);
    expect(resultActions({ outcome: "unreachable", text: "t" }, true)).toEqual(["another-credential"]);
    expect(resultActions(saved(), true)).toEqual([]);
  });

  it("offers choosing another account only where a repository was unreadable for a reason a token cannot mend", () => {
    const fine = { fleet: "acme/web", text: "t", fineGrained: true };
    const other = { fleet: "acme/web", text: "t", fineGrained: false };
    expect(resultActions(saved({ notReadable: [fine] }), true)).toEqual(["check-again", "another-credential"]);
    expect(resultActions(saved({ notReadable: [other] }), true)).toEqual(["check-again", "another-credential", "choose-another-account"]);
  });

  it("words the buttons", () => {
    expect(actionLabel("confirm", { outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "t" })).toBe("Add as GitHub · yuser");
    expect(actionLabel("another-credential", { outcome: "refused", text: "t" })).toBe("Use another credential");
    expect(actionLabel("another-credential", { outcome: "unreachable", text: "t" })).toBe("Try again");
  });

  it("gives the remedy for an unreadable repository", () => {
    expect(remedyText({ fleet: "a", text: "t", fineGrained: true })).toContain("Add the repository to the token on GitHub, or create a new token");
    expect(remedyText({ fleet: "a", text: "t", fineGrained: false })).toContain("Choose another account");
  });

  it("says how a half stands after a read", () => {
    const half = { role: "forge", what: "acme/web", account: { id: "a", label: "GitHub · yuser" }, credential: null, canWrite: false, needs: null } as const;
    expect(halfText(half)).toBe("acme/web is read as GitHub · yuser.");
    expect(halfText({ ...half, needs: "needs a token for acme" })).toBe("acme/web still needs an account: needs a token for acme");
  });
});

describe("the flow's state", () => {
  it("starts on Add account's questions, or loading a fleet's accounts", () => {
    expect(initialState(addAccount)).toMatchObject({ step: "setup", busy: false });
    expect(initialState(fleetRequest)).toMatchObject({ step: "account", busy: true });
  });

  it("goes view, page, result, and back to the token step clearing the outcome", () => {
    let state = initialState(fleetRequest);
    state = connectReducer(state, { type: "viewed", view: connectView(), step: "account" });
    state = connectReducer(state, { type: "paged", page: { sentTo: "x" } as never, logins: ["yuser"] });
    expect(state).toMatchObject({ step: "token", busy: false, logins: ["yuser"] });
    state = connectReducer(state, { type: "resulted", result: { outcome: "invalid", text: "rejected" } });
    expect(state.step).toBe("result");
    state = connectReducer(state, { type: "back", to: "token" });
    expect(state).toMatchObject({ step: "token", result: null });
  });

  it("keeps a failure until the next call", () => {
    let state = connectReducer(initialState(fleetRequest), { type: "failed", reason: "down" });
    expect(state).toMatchObject({ busy: false, failure: "down" });
    state = connectReducer(state, { type: "calling" });
    expect(state).toMatchObject({ busy: true, failure: null });
  });
});
