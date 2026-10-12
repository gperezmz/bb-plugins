import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { credentialsText, isLoopbackHost, parseCredentialEntries, parseTokens, SETTINGS, tokensText } from "./settings";

const list = (...entries: object[]) => JSON.stringify(entries);

/** Runs a setting's StandardSchema validator, as bb does on save. */
const check = (schema: { "~standard": { validate(value: unknown): unknown } }, text: string) => schema["~standard"].validate(text) as { issues?: { message: string }[]; value?: string };
const messages = (schema: Parameters<typeof check>[0], text: string) => (check(schema, text).issues ?? []).map((issue) => issue.message);

describe("isLoopbackHost", () => {
  it("is true for the loopback names a test server uses and false for anything else", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["127.0.0.2", "example.com", "localhost.evil.net", ""]) expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("SETTINGS", () => {
  it("declares credentials as a multiline, non-secret list and tokens as a secret", () => {
    const declared: PluginSettingDescriptors = SETTINGS;
    expect(declared.credentials).toMatchObject({ type: "string", experimental_multiline: true, default: "[]" });
    expect(declared.credentials).not.toHaveProperty("secret");
    expect(declared.tokens).toMatchObject({ type: "string", secret: true });
    expect(declared.tokens).not.toHaveProperty("experimental_multiline");
  });

  it("explains the prefix forms and whole-segment matching in the credentials description", () => {
    const text = SETTINGS.credentials.description;
    for (const form of ["github.com/org/repo", "linear:", "linear:<team key>", "jira:<site>", "jira:<site>/<project key>", "whole host and whole path segments"]) expect(text).toContain(form);
  });

  it("says in the credentials description that api.<host> is for github.com alone", () => {
    expect(SETTINGS.credentials.description).toContain("for github.com also api.github.com");
  });

  it("has validators that accept the defaults and return the proposed value unchanged", () => {
    expect(check(SETTINGS.credentials.experimental_schema, "[]")).toMatchObject({ value: "[]" });
    expect(check(SETTINGS.tokens.experimental_schema, "{}")).toMatchObject({ value: "{}" });
    expect(check(SETTINGS.tokens.experimental_schema, "")).toMatchObject({ value: "" });
  });
});

describe("parseCredentialEntries", () => {
  it("reads entries and fills in the service and base URL by the prefix's kind", () => {
    const { entries, problems } = parseCredentialEntries(
      list(
        { prefix: "GitHub.com/Org", auth: "token" },
        { prefix: "gitlab.com", auth: "glab" },
        { prefix: "git.example.com/team", auth: "token", service: "gitlab" },
        { prefix: "ghe.example.com", auth: "gh", service: "github" },
        { prefix: "linear:", auth: "token" },
        { prefix: "jira:Example.atlassian.net/proj", auth: "token" },
      ),
    );
    expect(problems).toEqual([]);
    expect(entries.map((e) => [e.text, e.service, e.auth, e.baseUrl])).toEqual([
      ["GitHub.com/Org", "github", "token", "https://api.github.com"],
      ["gitlab.com", "gitlab", "glab", "https://gitlab.com/api/v4"],
      ["git.example.com/team", "gitlab", "token", "https://git.example.com/api/v4"],
      ["ghe.example.com", "github", "gh", "https://ghe.example.com/api/v3"],
      ["linear:", "linear", "token", "https://api.linear.app/graphql"],
      ["jira:Example.atlassian.net/proj", "jira", "token", "https://example.atlassian.net"],
    ]);
  });

  it("takes an empty text as no entries", () => {
    expect(parseCredentialEntries("  ")).toMatchObject({ entries: [], problems: [] });
  });

  it("refuses text that is not JSON without echoing it", () => {
    const { entries, problems } = parseCredentialEntries('[{"prefix": ghp_secretsecret');
    expect(entries).toEqual([]);
    expect(problems).toEqual(["credentials is not valid JSON"]);
  });

  it("refuses JSON that is not a list", () => {
    expect(parseCredentialEntries("{}").problems).toEqual(["credentials must be a JSON list of entries"]);
  });

  it("refuses an unparsable prefix, an unknown auth and an unknown key, entry by entry", () => {
    const { entries, problems } = parseCredentialEntries(
      list({ prefix: "github.com/org//x y", auth: "token" }, { prefix: "github.com", auth: "password" }, { prefix: "github.com/ok", auth: "token", token: "ghp_leak" }, { prefix: "github.com/fine", auth: "token" }),
    );
    expect(entries.map((e) => e.text)).toEqual(["github.com/fine"]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("entry 1");
    expect(problems[1]).toContain("entry 2");
    expect(problems[2]).toContain("entry 3");
    expect(problems.join("\n")).not.toContain("ghp_leak");
  });

  it("refuses a baseUrl that is not https, but allows loopback over http", () => {
    const insecure = parseCredentialEntries(list({ prefix: "github.com", auth: "token", baseUrl: "http://api.github.com" }));
    expect(insecure.entries).toEqual([]);
    expect(insecure.problems[0]).toContain("https");
    for (const url of ["http://127.0.0.1:8123/api/v3", "http://localhost:9/x", "http://[::1]:5000"]) {
      const loop = parseCredentialEntries(list({ prefix: "github.com", auth: "token", baseUrl: url }));
      expect(loop.problems).toEqual([]);
      expect(loop.entries[0]?.baseUrl).toBe(url);
    }
  });

  it("refuses a baseUrl off the prefix's host, with user info, or that is not a URL", () => {
    const bad = [
      { prefix: "github.com/org", auth: "token", baseUrl: "https://evil.example/api" },
      { prefix: "github.com/org", auth: "token", baseUrl: "https://github.com.evil.net" },
      { prefix: "github.com/org", auth: "token", baseUrl: "https://user:pw@api.github.com" },
      { prefix: "github.com/org", auth: "token", baseUrl: "not a url" },
      { prefix: "linear:", auth: "token", baseUrl: "https://api.linear.app.evil.net/graphql" },
      { prefix: "jira:a.atlassian.net", auth: "token", baseUrl: "https://b.atlassian.net" },
    ];
    const { entries, problems } = parseCredentialEntries(list(...bad));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(bad.length);
  });

  it("accepts a baseUrl on the host, on api.<host>, on api.linear.app and on the Jira site", () => {
    const ok = [
      { prefix: "github.com/org", auth: "token", baseUrl: "https://api.github.com/" },
      { prefix: "git.example.com", auth: "token", service: "gitlab", baseUrl: "https://git.example.com/gitlab/api/v4" },
      { prefix: "linear:ENG", auth: "token", baseUrl: "https://api.linear.app/graphql" },
      { prefix: "jira:a.atlassian.net", auth: "token", baseUrl: "https://a.atlassian.net" },
    ];
    expect(parseCredentialEntries(list(...ok))).toMatchObject({ problems: [] });
  });

  it("allows api.<host> for github.com alone", () => {
    const refused = [
      { prefix: "ghe.example.com", auth: "token", service: "github", baseUrl: "https://api.ghe.example.com" },
      { prefix: "git.example.com", auth: "token", service: "gitlab", baseUrl: "https://api.git.example.com/v4" },
      { prefix: "gitlab.com", auth: "token", baseUrl: "https://api.gitlab.com" },
    ];
    const { entries, problems } = parseCredentialEntries(list(...refused));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(refused.length);
    expect(problems[0]).toContain("must be on ghe.example.com,");
    const accepted = [
      { prefix: "github.com", auth: "token", baseUrl: "https://api.github.com" },
      { prefix: "ghe.example.com", auth: "token", service: "github", baseUrl: "https://ghe.example.com/api/v3" },
      { prefix: "gitlab.com", auth: "token", baseUrl: "https://gitlab.com/api/v4" },
      { prefix: "git.example.com", auth: "token", service: "gitlab", baseUrl: "http://127.0.0.1:4010" },
    ];
    expect(parseCredentialEntries(list(...accepted))).toMatchObject({ problems: [] });
  });

  it("refuses a service that does not fit the prefix's kind", () => {
    const bad = [
      { prefix: "linear:", auth: "token", service: "jira" },
      { prefix: "jira:a.atlassian.net", auth: "token", service: "github" },
      { prefix: "github.com/org", auth: "token", service: "linear" },
      { prefix: "github.com/org2", auth: "token", service: "jira" },
    ];
    const { entries, problems } = parseCredentialEntries(list(...bad));
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(4);
  });

  it("refuses a repository prefix on an unknown host that names no service", () => {
    const { entries, problems } = parseCredentialEntries(list({ prefix: "git.example.com", auth: "token" }));
    expect(entries).toEqual([]);
    expect(problems[0]).toContain("service");
  });

  it("refuses gh for a service other than github and glab for one other than gitlab", () => {
    const { entries, problems } = parseCredentialEntries(
      list({ prefix: "gitlab.com", auth: "gh" }, { prefix: "github.com", auth: "glab" }, { prefix: "linear:", auth: "gh" }, { prefix: "jira:a.atlassian.net", auth: "glab" }),
    );
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(4);
  });

  it("refuses a duplicate prefix, however it is spelled, and lists it as unusable", () => {
    const { entries, problems, unusable } = parseCredentialEntries(list({ prefix: "github.com/org", auth: "token" }, { prefix: "GitHub.com/ORG/", auth: "gh" }, { prefix: "linear:eng", auth: "token" }, { prefix: "linear:ENG", auth: "token" }));
    expect(entries.map((e) => e.text)).toEqual(["github.com/org", "linear:eng"]);
    expect(problems).toHaveLength(2);
    expect(unusable.map((u) => u.text)).toEqual(["GitHub.com/ORG/", "linear:ENG"]);
  });
});

describe("parseTokens", () => {
  it("reads a JSON object from prefix to token, keyed by the prefix in its normal form", () => {
    const { tokens, problems } = parseTokens('{"GitHub.com/Org": " ghp_abc ", "jira:A.atlassian.net": "me@x.com:tok"}');
    expect(problems).toEqual([]);
    expect([...tokens]).toEqual([
      ["github.com/org", "ghp_abc"],
      ["jira:a.atlassian.net", "me@x.com:tok"],
    ]);
  });

  it("takes an unset or empty setting as no tokens", () => {
    expect(parseTokens("")).toMatchObject({ problems: [] });
    expect(parseTokens("{}").tokens.size).toBe(0);
  });

  it("refuses what is not an object, without echoing the text", () => {
    expect(parseTokens("ghp_secretsecret").problems).toEqual(["tokens is not valid JSON"]);
    expect(parseTokens('["ghp_secretsecret"]').problems).toEqual(["tokens must be a JSON object from prefix to token"]);
  });

  it("refuses an unparsable prefix, a non-string, an empty or spaced token, never quoting the token", () => {
    const { tokens, problems } = parseTokens('{"not a prefix": "ghp_aaa", "github.com/a": 5, "github.com/b": "  ", "github.com/c": "two words", "github.com/d": "ok"}');
    expect([...tokens.keys()]).toEqual(["github.com/d"]);
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).not.toMatch(/ghp_aaa|two words/);
  });

  it("refuses the same prefix given twice", () => {
    expect(parseTokens('{"github.com/a": "x", "GITHUB.com/a": "y"}').problems).toHaveLength(1);
  });
});

describe("the validators", () => {
  it("reject malformed JSON in either setting", () => {
    expect(messages(credentialsText, "[{")).toEqual(["credentials is not valid JSON"]);
    expect(messages(tokensText, "{")).toEqual(["tokens is not valid JSON"]);
  });

  it("reject an unparsable prefix, an unknown auth, a non-https baseUrl, a service that does not fit and a duplicate", () => {
    for (const entry of [
      { prefix: "a b", auth: "token" },
      { prefix: "github.com", auth: "oauth" },
      { prefix: "github.com", auth: "token", baseUrl: "http://api.github.com" },
      { prefix: "linear:", auth: "token", service: "github" },
    ]) {
      expect(messages(credentialsText, list(entry)).length).toBeGreaterThan(0);
    }
    expect(messages(credentialsText, list({ prefix: "github.com", auth: "token" }, { prefix: "github.com", auth: "gh" }))).toHaveLength(1);
  });

  it("accept a valid list and valid tokens", () => {
    expect(check(credentialsText, list({ prefix: "github.com/org", auth: "gh" }))).toMatchObject({ value: list({ prefix: "github.com/org", auth: "gh" }) });
    expect(check(tokensText, '{"github.com/org": "ghp_x"}').issues).toBeUndefined();
  });

  it("never carry a token in a message", () => {
    expect(messages(tokensText, '{"github.com/a": "ghp_secret value"}').join()).not.toContain("ghp_secret");
    expect(messages(tokensText, 'ghp_secret value').join()).not.toContain("ghp_secret");
  });
});
