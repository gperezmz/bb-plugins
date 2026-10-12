import { describe, expect, it } from "vitest";
import { defaultServiceOfHost, forgeSource, formatTracker, longestMatch, parsePrefix, parseRepo, parseTracker, prefixMatches, repoId, repoSubject, trackerSource, trackerSubject, urlUnder, type Prefix } from "./identity";

const prefix = (text: string): Prefix => parsePrefix(text)!;

describe("parseRepo", () => {
  it("reads host and path, lower-casing the host", () => {
    expect(parseRepo("GitHub.com/Org/Repo")).toEqual({ host: "github.com", path: "Org/Repo" });
    expect(parseRepo("gitlab.example.net/group/sub/project.git")).toEqual({ host: "gitlab.example.net", path: "group/sub/project" });
  });
  it("refuses a URL, a bare host and odd segments", () => {
    for (const text of ["https://github.com/o/r", "github.com", "github.com/", "github.com/o/../r", "github.com//r", "git hub.com/o/r", ""]) expect(parseRepo(text)).toBeNull();
  });
  it("keys a repository case-insensitively", () => {
    expect(repoId(parseRepo("GitHub.com/Org/Repo")!)).toBe("github.com/org/repo");
  });
});

describe("parseTracker", () => {
  it("reads the three forms", () => {
    expect(parseTracker("forge-issues")).toEqual({ kind: "forge-issues" });
    expect(parseTracker("linear:eng")).toEqual({ kind: "linear", team: "ENG" });
    expect(parseTracker("jira:acme.atlassian.net/proj")).toEqual({ kind: "jira", site: "acme.atlassian.net", project: "PROJ" });
  });
  it("refuses any other", () => {
    for (const text of ["github", "linear:", "linear:E/G", "jira:acme", "jira:acme.atlassian.net/", "jira:/PROJ"]) expect(parseTracker(text)).toBeNull();
  });
});

describe("prefixes", () => {
  const repo = repoSubject(parseRepo("github.com/org/repo")!);
  it("matches whole hosts and whole path segments", () => {
    expect(prefixMatches(prefix("github.com"), repo)).toBe(true);
    expect(prefixMatches(prefix("github.com/org"), repo)).toBe(true);
    expect(prefixMatches(prefix("github.com/org/repo"), repo)).toBe(true);
    expect(prefixMatches(prefix("github.com/or"), repo)).toBe(false);
    expect(prefixMatches(prefix("github.com/org/repo/x"), repo)).toBe(false);
    expect(prefixMatches(prefix("github.co"), repo)).toBe(false);
    expect(prefixMatches(prefix("GITHUB.com/ORG"), repo)).toBe(true);
  });
  it("does not match a host that merely starts with the prefix's", () => {
    const evil = repoSubject(parseRepo("gitlab.com.evil.net/x")!);
    expect(prefixMatches(prefix("gitlab.com"), evil)).toBe(false);
    expect(prefixMatches(prefix("gitlab.com.evil.net"), evil)).toBe(true);
  });
  it("matches Linear and Jira prefixes by team and by site and project, and never across kinds", () => {
    const linear = trackerSubject({ kind: "linear", team: "ENG" }, parseRepo("github.com/o/r")!);
    const jira = trackerSubject({ kind: "jira", site: "acme.atlassian.net", project: "PROJ" }, parseRepo("github.com/o/r")!);
    expect(prefixMatches(prefix("linear:"), linear)).toBe(true);
    expect(prefixMatches(prefix("linear:eng"), linear)).toBe(true);
    expect(prefixMatches(prefix("linear:OPS"), linear)).toBe(false);
    expect(prefixMatches(prefix("jira:acme.atlassian.net"), jira)).toBe(true);
    expect(prefixMatches(prefix("jira:acme.atlassian.net/PROJ"), jira)).toBe(true);
    expect(prefixMatches(prefix("jira:acme.atlassian.net/OTHER"), jira)).toBe(false);
    expect(prefixMatches(prefix("jira:acme.atlassian.net"), linear)).toBe(false);
    expect(prefixMatches(prefix("github.com"), linear)).toBe(false);
  });
  it("prefers the longest matching prefix", () => {
    const entries = ["github.com", "github.com/org", "github.com/org/repo", "github.com/other"].map((text) => ({ prefix: prefix(text), text }));
    expect(longestMatch(entries, repo)?.text).toBe("github.com/org/repo");
    expect(longestMatch(entries.slice(0, 2).reverse(), repo)?.text).toBe("github.com/org");
    expect(longestMatch([{ prefix: prefix("gitlab.com") }], repo)).toBeNull();
  });
  it("refuses a malformed prefix", () => {
    for (const text of ["", "github.com/..", "linear:E/G", "jira:", "jira:a/b/c", "https://github.com"]) expect(parsePrefix(text)).toBeNull();
  });
});

describe("sources", () => {
  it("names the host's service for github.com and gitlab.com only", () => {
    expect(defaultServiceOfHost("GitHub.com")).toBe("github");
    expect(defaultServiceOfHost("gitlab.com")).toBe("gitlab");
    expect(defaultServiceOfHost("git.example.net")).toBeNull();
  });
  it("makes a tracker source only for a separate tracker", () => {
    expect(trackerSource({ kind: "forge-issues" })).toBeNull();
    expect(trackerSource({ kind: "linear", team: "ENG" })).toEqual({ role: "tracker", service: "linear", team: "ENG" });
  });
});

describe("urlUnder", () => {
  const github = forgeSource(parseRepo("github.com/org/repo")!, "github");
  it("accepts an item URL under the repository and nothing else", () => {
    expect(urlUnder(github, "https://github.com/org/repo/pull/4")).toBe(true);
    expect(urlUnder(github, "https://github.com/Org/Repo/issues/4#issuecomment-1")).toBe(true);
    expect(urlUnder(github, "https://github.com/org/repository/issues/4")).toBe(false);
    expect(urlUnder(github, "https://github.com.evil.net/org/repo/issues/4")).toBe(false);
    expect(urlUnder(github, "https://example.net/x")).toBe(false);
    expect(urlUnder(github, "javascript:alert(1)")).toBe(false);
    expect(urlUnder(github, "not a url")).toBe(false);
  });
  it("accepts a Linear issue and a Jira browse URL of the fleet's own team and project", () => {
    expect(urlUnder({ role: "tracker", service: "linear", team: "ENG" }, "https://linear.app/acme/issue/ENG-212/some-title")).toBe(true);
    expect(urlUnder({ role: "tracker", service: "linear", team: "ENG" }, "https://linear.app/acme/issue/OPS-1")).toBe(false);
    expect(urlUnder({ role: "tracker", service: "jira", site: "acme.atlassian.net", project: "PROJ" }, "https://acme.atlassian.net/browse/PROJ-12")).toBe(true);
    expect(urlUnder({ role: "tracker", service: "jira", site: "acme.atlassian.net", project: "PROJ" }, "https://acme.atlassian.net/browse/OTHER-12")).toBe(false);
    expect(urlUnder({ role: "tracker", service: "jira", site: "acme.atlassian.net", project: "PROJ" }, "https://evil.net/browse/PROJ-12")).toBe(false);
  });
});

describe("formatTracker", () => {
  it("spells a tracker as --tracker does, so parsing it again gives it back", () => {
    for (const text of ["forge-issues", "linear:ENG", "jira:acme.atlassian.net/PROJ"]) expect(formatTracker(parseTracker(text)!)).toBe(text);
  });
});
