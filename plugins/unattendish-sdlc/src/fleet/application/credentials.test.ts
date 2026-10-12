import { describe, expect, it } from "vitest";
import type { Account, AccountCredential } from "../domain/accounts";
import { parseRepo, parseTracker } from "../domain/identity";
import { FakeClock, FakeLogins, FakeProbe } from "../testing/fakes";
import { InMemoryAccounts } from "../testing/memory-accounts";
import { AccountCredentials, CLI_FAILURE_TTL_MS, CLI_TOKEN_TTL_MS } from "./credentials";
import type { ResolvedCredential } from "./ports";

const repo = (text: string) => parseRepo(text)!;
const account = (id: string, over: Partial<Account> = {}): Account => ({ id, service: "github", place: "github.com", login: id, name: id, via: "token", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z", ...over });
const credential = (id: string, accountId: string, over: Partial<AccountCredential> = {}): AccountCredential => ({ id, accountId, kind: "fine-grained", owner: "acme", expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z", ...over });

const setup = () => {
  const store = new InMemoryAccounts();
  const logins = new FakeLogins();
  const probe = new FakeProbe();
  const clock = new FakeClock();
  return { store, logins, probe, clock, credentials: new AccountCredentials(store, logins, probe, clock) };
};
const found = (lookup: ReturnType<AccountCredentials["forForge"]>): ResolvedCredential => {
  if (!lookup.found) throw new Error(lookup.need);
  return lookup.credential;
};

describe("who reads a fleet's half", () => {
  it("reads as the most specific assignment's account, with its credential reaching the owner, sent to its own API", () => {
    const { store, credentials } = setup();
    store.addAccount(account("yuser"));
    store.addAccount(account("buser", { apiUrl: "http://127.0.0.1:4010" }));
    store.saveCredential(credential("y-acme", "yuser"), "ghp_y");
    store.saveCredential(credential("b-zorg", "buser", { owner: "zorg" }), "ghp_b");
    store.assign("github.com", "yuser");
    store.assign("github.com/zorg", "buser");
    expect(found(credentials.forForge(repo("github.com/acme/api")))).toEqual({
      key: "y-acme",
      label: "GitHub · yuser for acme",
      accountId: "yuser",
      accountLabel: "GitHub · yuser",
      service: "github",
      auth: "token",
      kind: "fine-grained",
      baseUrl: "https://api.github.com",
      host: "api.github.com",
    });
    expect(found(credentials.forForge(repo("github.com/zorg/z")))).toMatchObject({ key: "b-zorg", baseUrl: "http://127.0.0.1:4010", host: "127.0.0.1" });
    expect(credentials.forForge(repo("github.com/other-org/x"))).toEqual({ found: false, account: { id: "yuser", label: "GitHub · yuser" }, need: "other-org/x needs a GitHub account that can read other-org" });
  });

  it("reads forge-issues through the forge, and a separate tracker through its own assignment", () => {
    const { store, credentials } = setup();
    store.addAccount(account("yuser"));
    store.saveCredential(credential("y", "yuser"), "ghp_y");
    store.assign("github.com", "yuser");
    expect(found(credentials.forTracker(parseTracker("forge-issues")!, repo("github.com/acme/api"))).key).toBe("y");
    expect(credentials.forTracker(parseTracker("linear:ENG")!, repo("github.com/acme/api"))).toEqual({ found: false, account: null, need: "acme/api needs a Linear account that can read team ENG" });
  });

  it("gives a stored token, and none for a credential whose token is gone", async () => {
    const { store, credentials } = setup();
    store.addAccount(account("yuser"));
    store.saveCredential(credential("y", "yuser"), "ghp_y");
    store.assign("github.com", "yuser");
    const resolved = found(credentials.forForge(repo("github.com/acme/api")));
    expect(await credentials.token(resolved)).toBe("ghp_y");
    expect(credentials.secrets()).toEqual(["ghp_y"]);
    store.removeCredential("y");
    await expect(credentials.token(resolved)).rejects.toThrow("No token is stored for GitHub · yuser for acme");
  });
});

describe("a gh or glab account", () => {
  const ghAccount = () => {
    const world = setup();
    world.store.addAccount(account("buser", { via: "gh" }));
    world.store.saveCredential(credential("b", "buser", { kind: "gh", owner: null }), null);
    world.store.assign("github.com", "buser");
    return world;
  };

  it("asks gh for its own login's token, and keeps it for 5 minutes", async () => {
    const { logins, probe, clock, credentials } = ghAccount();
    logins.set("gh", "github.com", "buser", "gho_b");
    probe.owners.set("gho_b", { ok: true, login: "buser", name: "buser", expiresAt: null, classic: false });
    const resolved = found(credentials.forForge(repo("github.com/acme/api")));
    expect(await credentials.token(resolved)).toBe("gho_b");
    expect(await credentials.token(resolved)).toBe("gho_b");
    expect(logins.asked).toEqual(["gh github.com buser"]);
    clock.advance(CLI_TOKEN_TTL_MS + 1);
    await credentials.token(resolved);
    expect(logins.asked).toHaveLength(2);
    expect(credentials.secrets()).toEqual(["gho_b"]);
  });

  it("reads only as its own login: a token of yuser shows gh as signed in as yuser, not buser", async () => {
    const { logins, probe, credentials } = ghAccount();
    logins.set("gh", "github.com", "buser", "gho_y");
    probe.owners.set("gho_y", { ok: true, login: "yuser", name: "yuser", expiresAt: null, classic: false });
    await expect(credentials.token(found(credentials.forForge(repo("github.com/acme/api"))))).rejects.toThrow("gh is signed in as yuser, not buser");
    expect(credentials.loginProblem("buser")).toBe("gh is signed in as yuser, not buser");
  });

  it("uses the login's token while the service cannot say whose it is", async () => {
    const { logins, probe, credentials } = ghAccount();
    logins.set("gh", "github.com", "buser", "gho_b");
    probe.owners.set("gho_b", { ok: false, why: "unreachable", reason: "GET /user failed: no answer" });
    expect(await credentials.token(found(credentials.forForge(repo("github.com/acme/api"))))).toBe("gho_b");
    expect(credentials.loginProblem("buser")).toBeNull();
  });

  it("remembers a failed lookup for 30 seconds, then asks again; forgetting asks at once", async () => {
    const { logins, probe, clock, credentials } = ghAccount();
    const resolved = found(credentials.forForge(repo("github.com/acme/api")));
    await expect(credentials.token(resolved)).rejects.toThrow("gh gave no token for buser on github.com");
    await expect(credentials.token(resolved)).rejects.toThrow();
    expect(logins.asked).toHaveLength(1);
    clock.advance(CLI_FAILURE_TTL_MS + 1);
    logins.set("gh", "github.com", "buser", "gho_b");
    probe.owners.set("gho_b", { ok: true, login: "buser", name: "buser", expiresAt: null, classic: false });
    expect(await credentials.token(resolved)).toBe("gho_b");
    credentials.forget("buser");
    await credentials.token(resolved);
    expect(logins.asked).toHaveLength(3);
  });
});
