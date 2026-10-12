// The settings section's credential edits, through the fake host's settings: the same validators the form uses decide.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { SettingsCredentialAdmin } from "./credential-admin";
import { SETTINGS } from "./settings";

const TOKEN_A = "ghp_fake_token_aaaaaaaaaaaa";
const TOKEN_B = "ghp_fake_token_bbbbbbbbbbbb";
const NEW_TOKEN = "ghp_fake_token_nnnnnnnnnnnn";

const setup = async (settings: { credentials?: string; tokens?: string } = {}) => {
  const host = createFakePluginHost({ pluginId: "unattendish-sdlc", settings });
  const handle = host.bb.settings.define(SETTINGS);
  const admin = new SettingsCredentialAdmin(handle, () => [TOKEN_A, TOKEN_B]);
  const stored = async () => {
    const values = await handle.get();
    return { credentials: JSON.parse(values.credentials) as Record<string, unknown>[], tokens: JSON.parse(values.tokens ?? "{}") as Record<string, string> };
  };
  return { admin, handle, stored, host };
};

const TWO = JSON.stringify([
  { prefix: "github.com/org", auth: "token" },
  { prefix: "gitlab.com", auth: "glab" },
]);

describe("list", () => {
  it("lists each credential with whether a token is stored, never the token", async () => {
    const { admin } = await setup({ credentials: TWO, tokens: JSON.stringify({ "GitHub.com/Org": TOKEN_A }) });
    const { entries, problems } = await admin.list();
    expect(entries).toEqual([
      { prefix: "github.com/org", auth: "token", service: "github", baseUrl: "https://api.github.com", hasToken: true, problem: null },
      { prefix: "gitlab.com", auth: "glab", service: "gitlab", baseUrl: "https://gitlab.com/api/v4", hasToken: false, problem: null },
    ]);
    expect(problems).toEqual([]);
    expect(JSON.stringify(entries)).not.toContain(TOKEN_A);
  });

  it("says a token entry with no token stored cannot be used yet", async () => {
    const { admin } = await setup({ credentials: TWO });
    expect((await admin.list()).entries[0]).toMatchObject({ hasToken: false, problem: "no token is stored for this prefix" });
  });

  it("lists an entry that cannot be used with why, and the problems of the settings", async () => {
    const { admin } = await setup({ credentials: JSON.stringify([{ prefix: "git.example.net/team", auth: "token" }, { prefix: "github.com", auth: "gh" }]) });
    const { entries, problems } = await admin.list();
    expect(entries[0]).toMatchObject({ prefix: "git.example.net/team", problem: expect.stringContaining("service") });
    expect(entries[1]).toMatchObject({ prefix: "github.com", problem: null });
    expect(problems).toEqual([expect.stringContaining("credentials entry 1")]);
  });

  it("lists nothing for a setting that is not a list", async () => {
    const { admin } = await setup({ credentials: "{" });
    expect(await admin.list()).toEqual({ entries: [], problems: ["credentials is not valid JSON"] });
  });
});

describe("save: adding", () => {
  it("adds a credential and stores its token under the prefix, keeping every other token as it was", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A }) });
    const result = await admin.save({ prefix: "github.com/other", auth: "token", token: NEW_TOKEN });
    expect(result).toEqual({ ok: true });
    const now = await stored();
    expect(now.credentials.map((entry) => entry.prefix)).toEqual(["github.com/org", "gitlab.com", "github.com/other"]);
    expect(now.tokens).toEqual({ "github.com/org": TOKEN_A, "github.com/other": NEW_TOKEN });
  });

  it("adds a gh login with no token", async () => {
    const { admin, stored } = await setup();
    expect(await admin.save({ prefix: "github.com", auth: "gh" })).toEqual({ ok: true });
    expect((await stored()).credentials).toEqual([{ prefix: "github.com", auth: "gh" }]);
  });

  it("adds a service and a base URL for a host that needs them", async () => {
    const { admin, stored } = await setup();
    expect(await admin.save({ prefix: "git.example.net/team", auth: "token", service: "gitlab", baseUrl: "https://git.example.net/api/v4", token: NEW_TOKEN })).toEqual({ ok: true });
    expect((await stored()).credentials).toEqual([{ prefix: "git.example.net/team", auth: "token", service: "gitlab", baseUrl: "https://git.example.net/api/v4" }]);
  });
});

describe("save: refusing", () => {
  const unchanged = async (setupArgs: Parameters<typeof setup>[0], draft: Parameters<SettingsCredentialAdmin["save"]>[0]) => {
    const { admin, handle } = await setup(setupArgs);
    const before = await handle.get();
    const result = await admin.save(draft);
    expect(await handle.get()).toEqual(before);
    return result;
  };

  it("refuses a prefix that is not one, and changes nothing", async () => {
    expect(await unchanged({ credentials: TWO }, { prefix: "not a prefix", auth: "token" })).toMatchObject({ ok: false, reason: expect.stringContaining("prefix") });
    expect(await unchanged({ credentials: TWO }, { prefix: "  ", auth: "token" })).toEqual({ ok: false, reason: "the prefix is empty" });
  });

  it("refuses a prefix already given, by any spelling", async () => {
    expect(await unchanged({ credentials: TWO }, { prefix: "GitHub.com/Org", auth: "token" })).toEqual({ ok: false, reason: "GitHub.com/Org already has a credential" });
  });

  it("refuses a base URL on another host, a host with no service, and a login for the wrong service", async () => {
    expect(await unchanged({}, { prefix: "github.com/org", auth: "token", baseUrl: "https://evil.example.net/api" })).toMatchObject({ ok: false, reason: expect.stringContaining("baseUrl") });
    expect(await unchanged({}, { prefix: "git.example.net/team", auth: "token" })).toMatchObject({ ok: false, reason: expect.stringContaining("service") });
    expect(await unchanged({}, { prefix: "gitlab.com", auth: "gh" })).toMatchObject({ ok: false });
  });

  it("refuses a token that holds whitespace or goes with a login, without quoting it", async () => {
    const spaced = await unchanged({}, { prefix: "github.com/org", auth: "token", token: "has a space" });
    expect(spaced).toEqual({ ok: false, reason: "the token may not hold whitespace" });
    const login = await unchanged({}, { prefix: "github.com", auth: "gh", token: NEW_TOKEN });
    expect(login).toEqual({ ok: false, reason: "a gh login takes no token" });
  });

  it("refuses to edit an entry that is not there", async () => {
    expect(await unchanged({ credentials: TWO }, { was: "github.com/none", prefix: "github.com/none", auth: "token" })).toMatchObject({ ok: false, reason: expect.stringContaining("no credential") });
  });

  it("refuses when the setting is not a list it could change", async () => {
    expect(await unchanged({ credentials: "{" }, { prefix: "github.com", auth: "gh" })).toEqual({ ok: false, reason: "credentials is not valid JSON" });
  });

  it("never carries the token in a refusal", async () => {
    const { admin } = await setup();
    const result = await admin.save({ prefix: "not a prefix", auth: "token", token: NEW_TOKEN });
    expect(JSON.stringify(result)).not.toContain(NEW_TOKEN);
  });

  it("answers with the settings' own refusal, scrubbed of the pasted token and of every token stored, when the host refuses a write", async () => {
    const { handle } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A, "gitlab.com": TOKEN_B }) });
    const refusing = (quoted: string) => new SettingsCredentialAdmin({ get: () => handle.get(), experimental_set: () => Promise.reject(new Error(`rejected ${quoted}`)) }, () => [TOKEN_A, TOKEN_B]);
    expect(await refusing(`${NEW_TOKEN} ${TOKEN_A} ${TOKEN_B}`).save({ was: "github.com/org", prefix: "github.com/org", auth: "token", token: NEW_TOKEN })).toEqual({
      ok: false,
      reason: "the settings were not saved: rejected [redacted] [redacted] [redacted]",
    });
    expect(await refusing(`${TOKEN_A} ${TOKEN_B}`).remove("gitlab.com")).toEqual({ ok: false, reason: "the settings were not saved: rejected [redacted] [redacted]" });
  });
});

describe("save: editing", () => {
  it("keeps the stored token when none is given", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A }) });
    expect(await admin.save({ was: "github.com/org", prefix: "github.com/org", auth: "token", service: "github" })).toEqual({ ok: true });
    const now = await stored();
    expect(now.credentials[0]).toEqual({ prefix: "github.com/org", auth: "token", service: "github" });
    expect(now.tokens).toEqual({ "github.com/org": TOKEN_A });
  });

  it("replaces the token when a new one is given", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A, "gitlab.com": TOKEN_B }) });
    await admin.save({ was: "github.com/org", prefix: "github.com/org", auth: "token", token: NEW_TOKEN });
    expect((await stored()).tokens).toEqual({ "github.com/org": NEW_TOKEN, "gitlab.com": TOKEN_B });
  });

  it("renames an entry: it is removed under the old prefix and added under the new, the token moving with it", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A }) });
    expect(await admin.save({ was: "github.com/org", prefix: "github.com/org2", auth: "token" })).toEqual({ ok: true });
    const now = await stored();
    expect(now.credentials.map((entry) => entry.prefix)).toEqual(["github.com/org2", "gitlab.com"]);
    expect(now.tokens).toEqual({ "github.com/org2": TOKEN_A });
  });

  it("drops the stored token when an entry becomes a login", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A }) });
    await admin.save({ was: "github.com/org", prefix: "github.com/org", auth: "gh" });
    expect((await stored()).tokens).toEqual({});
  });

  it("refuses a rename onto a prefix another entry holds", async () => {
    const { admin } = await setup({ credentials: TWO });
    expect(await admin.save({ was: "github.com/org", prefix: "gitlab.com", auth: "token", service: "gitlab" })).toMatchObject({ ok: false, reason: "gitlab.com already has a credential" });
  });
});

describe("remove", () => {
  it("removes the entry and its token, keeping the others", async () => {
    const { admin, stored } = await setup({ credentials: TWO, tokens: JSON.stringify({ "github.com/org": TOKEN_A, "gitlab.com": TOKEN_B }) });
    expect(await admin.remove("GitHub.com/org")).toEqual({ ok: true });
    const now = await stored();
    expect(now.credentials.map((entry) => entry.prefix)).toEqual(["gitlab.com"]);
    expect(now.tokens).toEqual({ "gitlab.com": TOKEN_B });
  });

  it("refuses an entry that is not there", async () => {
    const { admin } = await setup({ credentials: TWO });
    expect(await admin.remove("github.com/none")).toMatchObject({ ok: false });
  });
});

describe("the form and the section hold to one rule", () => {
  it("refuses, through the settings' own validator, a list the section would refuse, and accepts what the section writes", async () => {
    const { admin, handle } = await setup();
    await expect(handle.experimental_set({ credentials: JSON.stringify([{ prefix: "git.example.net/team", auth: "token" }]) })).rejects.toThrow();
    expect(await admin.save({ prefix: "git.example.net/team", auth: "token", service: "gitlab" })).toEqual({ ok: true });
    await expect(handle.experimental_set({ credentials: (await handle.get()).credentials })).resolves.toBeDefined();
  });

  it("answers the host's refusal when another entry already breaks the list", async () => {
    const { admin } = await setup({ credentials: JSON.stringify([{ prefix: "git.example.net/team", auth: "token" }]) });
    expect(await admin.save({ prefix: "github.com", auth: "gh" })).toMatchObject({ ok: false, reason: expect.stringContaining("the settings were not saved") });
  });
});

describe("writes one after another", () => {
  it("keeps both of two saves sent together", async () => {
    const { admin, stored } = await setup();
    await Promise.all([admin.save({ prefix: "github.com/a", auth: "gh" }), admin.save({ prefix: "github.com/b", auth: "gh" })]);
    expect((await stored()).credentials.map((entry) => entry.prefix)).toEqual(["github.com/a", "github.com/b"]);
  });
});
