import { describe, expect, it } from "vitest";
import {
  accessProblemText,
  accountCovers,
  apiUrlProblem,
  assignmentProblem,
  canWrite,
  credentialFor,
  defaultAccountOf,
  defaultScope,
  forgeHalf,
  githubTokenUrl,
  gitlabTokenUrl,
  isJiraCloudSite,
  placeProblem,
  readerOf,
  tokenHosts,
  trackerHalf,
  winningAssignment,
  type Account,
  type AccountCredential,
  type Assignment,
} from "./accounts";
import { parseRepo } from "./identity";

const account = (id: string, over: Partial<Account> = {}): Account => ({ id, service: "github", place: "github.com", login: id, name: id, via: "token", apiUrl: null, addedAt: "2026-10-12T10:00:00.000Z", ...over });
const credential = (id: string, accountId: string, over: Partial<AccountCredential> = {}): AccountCredential => ({ id, accountId, kind: "fine-grained", owner: "acme", expiresAt: null, addedAt: "2026-10-12T10:00:00.000Z", ...over });
const repo = (text: string) => parseRepo(text)!;

describe("where a token may go (AC3)", () => {
  it("is the account's own host, api.github.com for github.com, api.linear.app for Linear, the site for Jira", () => {
    expect(tokenHosts(account("y"))).toEqual(["github.com", "api.github.com"]);
    expect(tokenHosts(account("y", { place: "ghe.example.com" }))).toEqual(["ghe.example.com"]);
    expect(tokenHosts(account("y", { service: "gitlab", place: "gitlab.example.com" }))).toEqual(["gitlab.example.com"]);
    expect(tokenHosts(account("y", { service: "linear", place: "linear.app" }))).toEqual(["api.linear.app"]);
    expect(tokenHosts(account("y", { service: "jira", place: "acme.atlassian.net" }))).toEqual(["acme.atlassian.net"]);
  });

  it("refuses an API address off the account's host, over plain http off loopback, or with credentials in it", () => {
    expect(apiUrlProblem(account("y"), "https://api.github.com")).toBeNull();
    expect(apiUrlProblem(account("y"), "http://127.0.0.1:9999")).toBeNull();
    expect(apiUrlProblem(account("y"), "https://gitlab.example.com/api/v4")).toContain("github.com or api.github.com");
    expect(apiUrlProblem(account("y", { place: "ghe.example.com" }), "https://api.ghe.example.com")).toContain("ghe.example.com");
    expect(apiUrlProblem(account("y"), "http://api.github.com")).toContain("https");
    expect(apiUrlProblem(account("y"), "https://u:p@api.github.com")).toContain("user name or password");
    expect(apiUrlProblem(account("y"), "not a url")).toContain("not a URL");
  });

  it("refuses an assignment naming an account on another host, site or service, naming both", () => {
    const yuser = account("yuser", { name: "yuser" });
    expect(assignmentProblem("gitlab.example.com", yuser)).toBe("gitlab.example.com is on gitlab.example.com, not on GitHub · yuser's host github.com");
    expect(assignmentProblem("github.com/zorg", yuser)).toBeNull();
    const jira = account("ops", { service: "jira", place: "acme.atlassian.net", name: "ops@acme.com" });
    expect(assignmentProblem("jira:other.atlassian.net/OPS", jira)).toContain("Jira · ops@acme.com");
    expect(assignmentProblem("jira:acme.atlassian.net/OPS", jira)).toBeNull();
    expect(assignmentProblem("linear:ENG", yuser)).toContain("not on GitHub · yuser's host github.com");
    expect(assignmentProblem("jira:acme.example.com", jira)).toContain("not a Jira Cloud site");
  });

  it("takes a Jira site only under atlassian.net, and a Linear account only on linear.app", () => {
    expect(isJiraCloudSite("acme.atlassian.net")).toBe(true);
    expect(isJiraCloudSite("acme.atlassian.net.evil.com")).toBe(false);
    expect(placeProblem("jira", "jira.acme.com")).toContain("not a Jira Cloud site");
    expect(placeProblem("linear", "linear.app")).toBeNull();
    expect(placeProblem("github", "github.com/org")).toContain("not a host");
  });
});

describe("who reads a fleet", () => {
  const yuser = account("yuser");
  const buser = account("buser");
  const assignments: Assignment[] = [
    { scope: "github.com", accountId: "yuser" },
    { scope: "github.com/zorg", accountId: "buser" },
  ];

  it("takes the most specific assignment covering the fleet, the bare host being the default", () => {
    expect(winningAssignment(forgeHalf(repo("github.com/zorg/z"), "github").subject, assignments, [yuser, buser])?.account.id).toBe("buser");
    expect(winningAssignment(forgeHalf(repo("github.com/acme/api"), "github").subject, assignments, [yuser, buser])?.account.id).toBe("yuser");
    expect(defaultAccountOf("github", "github.com", assignments, [yuser, buser])?.id).toBe("yuser");
    expect(defaultScope(account("l", { service: "linear", place: "linear.app" }))).toBe("linear:");
    expect(defaultScope(account("j", { service: "jira", place: "acme.atlassian.net" }))).toBe("jira:acme.atlassian.net");
  });

  it("never takes an assignment naming an account on another host", () => {
    const gitlab = account("gl", { service: "gitlab", place: "gitlab.example.com" });
    expect(winningAssignment(forgeHalf(repo("github.com/acme/api"), "github").subject, [{ scope: "github.com", accountId: "gl" }], [gitlab])).toBeNull();
  });

  it("says what a half needs in AC1's words", () => {
    const needs = readerOf(repo("github.com/other-org/x"), forgeHalf(repo("github.com/other-org/x"), "github"), [yuser], [{ scope: "github.com", accountId: "yuser" }], [credential("c", "yuser", { owner: "acme" })]);
    expect(needs).toEqual({ kind: "needs", account: yuser, need: "other-org/x needs a GitHub account that can read other-org" });
    const jira = readerOf(repo("gitlab.example.com/platform/infra"), trackerHalf({ kind: "jira", site: "acme.atlassian.net", project: "OPS" })!, [], [], []);
    expect(jira).toEqual({ kind: "needs", account: null, need: "platform/infra needs a Jira account for acme.atlassian.net" });
    const group = readerOf(repo("gitlab.example.com/platform/sub/infra"), forgeHalf(repo("gitlab.example.com/platform/sub/infra"), "gitlab"), [], [], []);
    expect(group).toMatchObject({ need: "platform/sub/infra needs a GitLab account that can read platform/sub" });
  });

  it("reads with the token for the fleet's owner, else one reaching every owner", () => {
    const own = [credential("acme", "yuser", { owner: "Acme" }), credential("all", "yuser", { owner: null, kind: "classic" })];
    expect(credentialFor(yuser, { owner: "acme" }, own)?.id).toBe("acme");
    expect(credentialFor(yuser, { owner: "zorg" }, own)?.id).toBe("all");
    expect(credentialFor(account("gl", { service: "gitlab" }), { owner: "anything" }, [credential("g", "gl", { owner: null, kind: "gitlab-token" })])?.id).toBe("g");
  });

  it("lets an account cover only prefixes on its own place", () => {
    expect(accountCovers(yuser, { kind: "repo", host: "github.com", path: ["x"] })).toBe(true);
    expect(accountCovers(yuser, { kind: "repo", host: "gitlab.com", path: [] })).toBe(false);
    expect(accountCovers(account("l", { service: "linear", place: "linear.app" }), { kind: "linear", team: "ENG" })).toBe(true);
  });
});

describe("the pre-filled token pages", () => {
  const at = new Date("2026-10-12T18:30:00Z");

  it("fills GitHub's fine-grained token page with the owner, 90 days and read-only Issues, Pull requests and Metadata, and nothing else (AC4)", () => {
    const url = new URL(githubTokenUrl("github.com", "zorg", at));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(url.searchParams.get("target_name")).toBe("zorg");
    expect(url.searchParams.get("expires_in")).toBe("90");
    expect(url.searchParams.get("issues")).toBe("read");
    expect(url.searchParams.get("pull_requests")).toBe("read");
    expect(url.searchParams.get("metadata")).toBe("read");
    expect([...url.searchParams.keys()].sort()).toEqual(["description", "expires_in", "issues", "metadata", "name", "pull_requests", "target_name"]);
    const name = url.searchParams.get("name")!;
    expect(name).toContain("Unattendish");
    expect(name).toContain("zorg");
    expect(name).toContain("2026-10-12 18:30");
    expect(name.length).toBeLessThanOrEqual(40);
  });

  it("cuts a long owner, never the day and time, to keep GitHub's 40 characters", () => {
    const name = new URL(githubTokenUrl("github.com", "a-very-long-organisation-name", at)).searchParams.get("name")!;
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith("2026-10-12 18:30")).toBe(true);
    expect(name.startsWith("Unattendish a-very-long")).toBe(true);
  });

  it("fills GitLab's token page with a name, a read-only description and read_api alone (AC5)", () => {
    const url = new URL(gitlabTokenUrl("gitlab.example.com", at));
    expect(`${url.origin}${url.pathname}`).toBe("https://gitlab.example.com/-/user_settings/personal_access_tokens");
    expect(url.searchParams.get("scopes")).toBe("read_api");
    expect(url.searchParams.get("name")).toContain("Unattendish");
    expect(url.searchParams.get("description")).toContain("Read-only");
    expect([...url.searchParams.keys()].sort()).toEqual(["description", "name", "scopes"]);
  });
});

describe("what a credential that cannot read says (AC6)", () => {
  it("gives a fine-grained token both causes and both remedies, and any other the login's lack of access", () => {
    const fine = accessProblemText({ label: "GitHub · yuser for acme", kind: "fine-grained" }, "acme/api");
    expect(fine).toContain("not ticked on the token");
    expect(fine).toContain("not yet approved");
    expect(fine).toContain("Add the repository to the token on GitHub, or create a new token");
    expect(accessProblemText({ label: "GitLab · yuser", kind: "gitlab-token" }, "platform/infra")).toContain("Choose another account");
  });

  it("labels a classic token and a gh or glab login as able to write (AC11)", () => {
    expect(["classic", "gh", "glab"].every((kind) => canWrite(kind as AccountCredential["kind"]))).toBe(true);
    expect(["fine-grained", "gitlab-token", "linear-key", "jira-token"].some((kind) => canWrite(kind as AccountCredential["kind"]))).toBe(false);
  });
});
