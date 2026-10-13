// Connecting a fleet's halves to accounts, and managing accounts (spec #253).
import { describe, expect, it } from "vitest";
import { args, manifest, MANAGER, MANIFEST_PATH, world, type World } from "../testing/kit";
import { createDashboard } from "./dashboard";
import { HttpError, type Identified } from "./ports";
import { checkFleetAccess, registerFleet } from "./register";
import type { ConnectInput, ConnectResult } from "./views";

const accountsWorld = () => {
  const w = world({ accounts: true });
  w.manifests.files.set(MANIFEST_PATH, manifest());
  return w;
};
const api = (w: World) => createDashboard(w.dash);
const owns = (w: World, token: string, login: string, over: Partial<Extract<Identified, { ok: true }>> = {}) =>
  w.probe.owners.set(token, { ok: true, login, name: login, expiresAt: null, classic: false, ...over });
const register = async (w: World, repo: string, tracker = "forge-issues", manager = MANAGER) => {
  w.threads.states.set(manager, "live");
  // Each fleet its own manifest, naming its own repository, so none is left behind.
  const path = `/work/${repo}/manifest.md`;
  w.manifests.files.set(path, manifest({ repo }));
  return registerFleet(w.register, manager, args({ repo, tracker, manifest: path }));
};
const saved = (result: ConnectResult) => {
  if (result.outcome !== "saved") throw new Error(`not saved: ${JSON.stringify(result)}`);
  return result;
};
/** Adds a new login through the popup, confirming whose it is, and returns its account's id. */
const addLogin = async (w: World, input: Omit<ConnectInput, "confirm">) => {
  const first = await api(w).connect(input);
  expect(first.outcome).toBe("confirm");
  return saved(await api(w).connect({ ...input, confirm: true })).account.id;
};
const github = (token: string, owner: string, extra: Partial<ConnectInput> = {}): ConnectInput => ({ service: "github", place: "github.com", owner, account: { service: "github", place: "github.com" }, secret: { kind: "token", token }, ...extra });
const card = async (w: World, repo: string) => (await api(w).fleets()).fleets.find((fleet) => fleet.repo === repo)!;

describe("a fleet that cannot be read (AC1)", () => {
  it("toasts and shows that other-org/x needs a GitHub account that can read other-org, with Connect…", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/other-org/x");
    const text = "other-org/x needs a GitHub account that can read other-org";
    expect(w.events.needs).toEqual([{ fleet: "github.com/other-org/x", managerThreadId: MANAGER, role: "forge", text }]);
    const fleet = await card(w, "github.com/other-org/x");
    expect(fleet.halves).toEqual([{ role: "forge", what: "other-org/x", account: { id: expect.any(String), label: "GitHub · yuser" }, credential: null, canWrite: false, needs: text }]);
    expect(fleet.problems).toContainEqual({ code: "no-credential", text, fix: { kind: "connect", role: "forge" } });
    const view = await api(w).fleets();
    expect(view.needsAccount).toEqual([{ fleet: "github.com/other-org/x", managerThreadId: MANAGER, role: "forge", text }]);
    // A half that needs an account is a Connect… on the board, not a row: it does not wait in the header's count.
    expect(view.waiting).toBe(0);
  });

  it("shows a GitLab forge as read by its account and a Jira tracker as needing a Jira account for its site", async () => {
    const w = accountsWorld();
    owns(w, "tok-gl", "yuser");
    await addLogin(w, { service: "gitlab", place: "gitlab.example.com", account: { service: "gitlab", place: "gitlab.example.com" }, secret: { kind: "token", token: "tok-gl" } });
    await register(w, "gitlab.example.com/platform/infra", "jira:acme.atlassian.net/OPS");
    const fleet = await card(w, "gitlab.example.com/platform/infra");
    expect(fleet.halves).toEqual([
      { role: "forge", what: "platform/infra", account: { id: expect.any(String), label: "GitLab · yuser" }, credential: "GitLab · yuser", canWrite: false, needs: null },
      { role: "tracker", what: "OPS", account: null, credential: null, canWrite: false, needs: "platform/infra needs a Jira account for acme.atlassian.net" },
    ]);
    expect(w.events.needs.map((need) => need.role)).toEqual(["tracker"]);
  });

  it("raises no toast and no Connect… for a service that does not answer", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/acme/api");
    for (let poll = 0; poll < 3; poll += 1) {
      w.adapters.github.queue(new HttpError("network", "GET /repos/acme/api/issues failed: no answer"));
      await api(w).checkAgain({ fleet: "github.com/acme/api", role: "forge" });
    }
    const fleet = await card(w, "github.com/acme/api");
    expect(fleet.problems).toEqual([{ code: "credential-refused", text: expect.stringContaining("did not answer"), fix: { kind: "none" } }]);
    expect(fleet.halves[0]!.needs).toBeNull();
    expect(w.events.needs).toEqual([]);
    expect((await api(w).fleets()).needsAccount).toEqual([]);
  });

  it("is not watched right after it registers when its credential is accepted but cannot see the repository", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    w.probe.unreadable.set("tok-yuser", new Map([["acme/ghost", "not-found"]]));
    await register(w, "github.com/acme/ghost");
    await checkFleetAccess(w.register, "github.com/acme/ghost");
    const text = expect.stringContaining("GitHub · yuser for acme cannot read acme/ghost: the repository is not ticked on the token");
    expect((await card(w, "github.com/acme/ghost")).halves[0]).toMatchObject({ needs: text });
    expect(w.events.needs).toEqual([{ fleet: "github.com/acme/ghost", managerThreadId: MANAGER, role: "forge", text }]);
    w.probe.unreadable.clear();
    await checkFleetAccess(w.register, "github.com/acme/ghost");
    expect((await card(w, "github.com/acme/ghost")).halves[0]!.needs).toBeNull();
  });

  it("writes nothing for a fleet unregistered, or a half given another credential, while its check waited on the service", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-new", "yuser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    w.probe.unreadable.set("tok-yuser", new Map([["acme/ghost", "not-found"]]));
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    const canRead = w.probe.canRead.bind(w.probe);
    w.probe.canRead = async (...args) => {
      await held;
      return canRead(...args);
    };
    await register(w, "github.com/acme/ghost");
    const unregistered = checkFleetAccess(w.register, "github.com/acme/ghost");
    await new Promise((resolve) => setTimeout(resolve, 0));
    w.store.removeFleet("github.com/acme/ghost");
    answer();
    await unregistered;
    expect(w.accounts.accessProblems("github.com/acme/ghost")).toEqual([]);

    await register(w, "github.com/acme/ghost");
    let answerAgain!: () => void;
    const heldAgain = new Promise<void>((resolve) => (answerAgain = resolve));
    w.probe.canRead = async (...args) => {
      await heldAgain;
      return canRead(...args);
    };
    const replaced = checkFleetAccess(w.register, "github.com/acme/ghost");
    await new Promise((resolve) => setTimeout(resolve, 0));
    w.probe.canRead = canRead;
    saved(await api(w).connect({ fleet: "github.com/acme/ghost", role: "forge", account: { id: yuser }, secret: { kind: "token", token: "tok-new" } }));
    answerAgain();
    await replaced;
    expect(w.accounts.accessProblems("github.com/acme/ghost")).toEqual([]);
  });

  it("toasts a fleet only as it comes to need an account, not again on every poll", async () => {
    const w = accountsWorld();
    await register(w, "github.com/acme/api");
    expect(w.events.needs).toHaveLength(1);
    await api(w).checkAgain({ fleet: "github.com/acme/api", role: "forge" });
    expect(w.events.needs).toHaveLength(1);
  });
});

describe("Connect (AC2)", () => {
  it("assigns other-org to buser when buser's token is pasted for it, and the card turns watched", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-buser", "buser");
    owns(w, "tok-buser-2", "buser");
    await addLogin(w, github("tok-yuser", "acme"));
    const buser = await addLogin(w, github("tok-buser", "zorg"));
    await register(w, "github.com/other-org/x");
    const view = await api(w).connectView({ fleet: "github.com/other-org/x", role: "forge" });
    if (!view.ok) throw new Error(view.reason);
    expect(view.connect.accounts.map((option) => [option.label, option.isDefault, option.reaches])).toEqual([
      ["GitHub · yuser", true, false],
      ["GitHub · buser", false, false],
    ]);
    const result = saved(await api(w).connect({ fleet: "github.com/other-org/x", role: "forge", account: { id: buser }, secret: { kind: "token", token: "tok-buser-2" } }));
    expect(result.half).toMatchObject({ account: { label: "GitHub · buser" }, needs: null });
    expect(w.accounts.assignments()).toContainEqual({ scope: "github.com/other-org", accountId: buser });
    expect((await card(w, "github.com/other-org/x")).halves[0]).toMatchObject({ account: { label: "GitHub · buser" }, credential: "GitHub · buser for other-org", needs: null });
    expect(w.readNow).toContain("github.com/other-org/x");
  });

  it("offers only a new login with no account, and adds the confirmed login as github.com's default", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await register(w, "github.com/acme/api");
    const view = await api(w).connectView({ fleet: "github.com/acme/api", role: "forge" });
    expect(view).toMatchObject({ ok: true, connect: { service: "github", place: "github.com", owner: "acme", accounts: [] } });
    const input: ConnectInput = { fleet: "github.com/acme/api", role: "forge", account: { service: "github", place: "github.com" }, secret: { kind: "token", token: "tok-yuser" } };
    expect(await api(w).connect(input)).toEqual({ outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "This token belongs to yuser. Add as GitHub · yuser?" });
    expect(w.accounts.accounts()).toEqual([]);
    saved(await api(w).connect({ ...input, confirm: true }));
    const settings = await api(w).settings();
    expect(settings.accounts).toMatchObject([{ label: "GitHub · yuser", defaultFor: ["github.com"], credentials: [{ reaches: "acme", kind: "fine-grained", fleets: ["github.com/acme/api"] }] }]);
  });

  it("removes the owner's assignment when the default is chosen again", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-yuser-other", "yuser");
    owns(w, "tok-buser", "buser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/other-org/x");
    await addLogin(w, github("tok-buser", "other-org", { fleet: "github.com/other-org/x", role: "forge" }));
    expect(w.accounts.assignments().map((a) => a.scope)).toContain("github.com/other-org");
    saved(await api(w).connect({ fleet: "github.com/other-org/x", role: "forge", account: { id: yuser }, secret: { kind: "token", token: "tok-yuser-other" } }));
    expect(w.accounts.assignments()).toEqual([{ scope: "github.com", accountId: yuser }]);
  });

  it("lists every fleet under the owner to tick when Connect will assign the owner to another account (AC4)", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-buser", "buser");
    await addLogin(w, github("tok-yuser", "zorg"));
    const buser = await addLogin(w, github("tok-buser", "elsewhere"));
    await register(w, "github.com/zorg/z");
    await register(w, "github.com/zorg/y", "forge-issues", "thr_second");
    await register(w, "github.com/acme/api", "forge-issues", "thr_third");
    const page = await api(w).tokenPage({ fleet: "github.com/zorg/z", role: "forge", account: { id: buser } });
    expect(page).toMatchObject({ ok: true, page: { repositories: ["zorg/y", "zorg/z"], signInAs: "buser", url: expect.stringContaining("target_name=zorg") } });
    const withoutFleet = await api(w).tokenPage({ owner: "zorg", account: { id: buser } });
    expect(withoutFleet).toMatchObject({ ok: true, page: { repositories: [] } });
  });

  it("does not offer a credential the service refuses as one that reaches the fleet", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/acme/api");
    for (let poll = 0; poll < 1; poll += 1) {
      w.adapters.github.queue(new HttpError("auth", "GET /repos/acme/api/issues answered 401", 401));
      await api(w).checkAgain({ fleet: "github.com/acme/api", role: "forge" });
    }
    expect(await api(w).connectView({ fleet: "github.com/acme/api", role: "forge" })).toMatchObject({ ok: true, connect: { accounts: [{ id: yuser, reaches: false }] } });
    expect((await api(w).settings()).accounts[0]!.credentials[0]).toMatchObject({ refused: true });
  });

  it("says a gh login's credential shares the agents' rate limit, and a token's does not", async () => {
    const w = accountsWorld();
    w.accounts.addAccount({ id: "b", service: "github", place: "github.com", login: "buser", name: "buser", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "bc", accountId: "b", kind: "gh", owner: null, expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, null);
    w.accounts.addAccount({ id: "y", service: "github", place: "github.com", login: "yuser", name: "yuser", via: "token", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "yc", accountId: "y", kind: "fine-grained", owner: "acme", expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, "tok-y");
    const shares = Object.fromEntries((await api(w).settings()).accounts.flatMap((account) => account.credentials.map((credential) => [credential.id, credential.sharesRateLimit])));
    expect(shares).toEqual({ bc: true, yc: false });
  });

  it("tells a gh account signed in as another user how to sign in again, when Connect goes straight to it", async () => {
    const w = accountsWorld();
    w.accounts.addAccount({ id: "b", service: "github", place: "github.com", login: "buser", name: "buser", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "bc", accountId: "b", kind: "gh", owner: null, expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, null);
    w.accounts.assign("github.com", "b");
    w.logins.set("gh", "github.com", "buser", "tok-gh");
    owns(w, "tok-gh", "yuser");
    await register(w, "github.com/acme/api");
    expect(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { id: "b" }, secret: { kind: "stored" } })).toEqual({
      outcome: "wrong-login",
      text: "gh is signed in as yuser, not buser.",
      command: "gh auth login --hostname github.com",
    });
  });

  it("says a gh that gives no token as it is, with the command for when it is not signed in", async () => {
    const w = accountsWorld();
    w.accounts.addAccount({ id: "b", service: "github", place: "github.com", login: "buser", name: "buser", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "bc", accountId: "b", kind: "gh", owner: null, expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, null);
    w.accounts.assign("github.com", "b");
    await register(w, "github.com/acme/api");
    expect(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { id: "b" }, secret: { kind: "stored" } })).toEqual({
      outcome: "unreachable",
      text: "gh gave no token for buser on github.com. If gh is not signed in as buser, run gh auth login --hostname github.com.",
    });
  });

  it("goes straight to verifying with an account whose credential reaches the fleet", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/acme/api");
    const view = await api(w).connectView({ fleet: "github.com/acme/api", role: "forge" });
    expect(view).toMatchObject({ ok: true, connect: { accounts: [{ id: yuser, reaches: true }] } });
    expect(saved(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { id: yuser }, secret: { kind: "stored" } })).half).toMatchObject({ needs: null });
  });
});

describe("a token goes only to its own account's host (AC3)", () => {
  it("refuses to read gitlab.example.com as GitHub · yuser, naming both, and sends it no token", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "gitlab.example.com/platform/infra");
    const before = w.probe.identified.length;
    const result = await api(w).connect({ fleet: "gitlab.example.com/platform/infra", role: "forge", account: { id: yuser }, secret: { kind: "stored" } });
    expect(result).toMatchObject({ outcome: "invalid", text: expect.stringContaining("GitHub · yuser") });
    expect(result).toMatchObject({ text: expect.stringContaining("gitlab.example.com") });
    expect(w.probe.identified.length).toBe(before);
    expect(w.accounts.assignments().map((a) => a.scope)).toEqual(["github.com"]);
  });

  it("sends a new account's token to its own API address, loopback over http included, and refuses one off its host", async () => {
    const w = accountsWorld();
    owns(w, "tok", "yuser");
    const off = await api(w).connect({ account: { service: "github", place: "github.com", apiUrl: "https://evil.example.com" }, owner: "acme", secret: { kind: "token", token: "tok" } });
    expect(off).toMatchObject({ outcome: "invalid", text: expect.stringContaining("github.com or api.github.com") });
    expect(w.probe.identified).toEqual([]);
    await addLogin(w, { account: { service: "github", place: "github.com", apiUrl: "http://127.0.0.1:9999" }, owner: "acme", secret: { kind: "token", token: "tok" } });
    expect(w.probe.identified.at(-1)!.target).toEqual({ service: "github", baseUrl: "http://127.0.0.1:9999", host: "127.0.0.1" });
    expect(w.accounts.accounts()[0]).toMatchObject({ apiUrl: "http://127.0.0.1:9999" });
  });

  it("gives a gh account no API address", async () => {
    const w = accountsWorld();
    w.logins.set("gh", "github.com", "yuser", "tok-gh");
    owns(w, "tok-gh", "yuser");
    expect(await api(w).connect({ account: { service: "github", place: "github.com", apiUrl: "http://127.0.0.1:9999" }, secret: { kind: "login", tool: "gh", login: "yuser" } })).toMatchObject({ outcome: "invalid" });
  });
});

describe("Verify and save (AC6)", () => {
  it("stores nothing for a token the service rejects", async () => {
    const w = accountsWorld();
    await register(w, "github.com/acme/api");
    expect(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { service: "github", place: "github.com" }, secret: { kind: "token", token: "tok-bad" }, confirm: true })).toEqual({
      outcome: "refused",
      text: "GitHub rejected the token. Nothing was stored.",
    });
    expect(w.accounts.accounts()).toEqual([]);
    expect(w.accounts.tokens()).toEqual([]);
  });

  it("stores a fine-grained token that cannot see a fleet's repository, and names the repository as not readable until a read succeeds", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    w.probe.unreadable.set("tok-yuser", new Map([["acme/api", "not-found"]]));
    await register(w, "github.com/acme/api");
    w.adapters.github.queue(new HttpError("not-found", "GET /repos/acme/api answered 404", 404));
    const result = saved(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { service: "github", place: "github.com" }, secret: { kind: "token", token: "tok-yuser" }, confirm: true }));
    expect(w.accounts.tokens()).toEqual(["tok-yuser"]);
    expect(result.notReadable).toEqual([{ fleet: "github.com/acme/api", fineGrained: true, text: expect.stringContaining("not ticked on the token") }]);
    expect(result.notReadable[0]!.text).toContain("create a new token");
    const half = (await card(w, "github.com/acme/api")).halves[0]!;
    expect(half.needs).toContain("not yet approved");
    // A read that succeeds clears it.
    w.probe.unreadable.clear();
    await api(w).checkAgain({ fleet: "github.com/acme/api", role: "forge" });
    expect((await card(w, "github.com/acme/api")).halves[0]!.needs).toBeNull();
  });

  it("says another credential's login cannot see the repository, and offers another account", async () => {
    const w = accountsWorld();
    owns(w, "tok-gl", "yuser");
    w.probe.unreadable.set("tok-gl", new Map([["platform/infra", "forbidden"]]));
    await register(w, "gitlab.example.com/platform/infra");
    const result = saved(await api(w).connect({ fleet: "gitlab.example.com/platform/infra", role: "forge", account: { service: "gitlab", place: "gitlab.example.com" }, secret: { kind: "token", token: "tok-gl" }, confirm: true }));
    expect(result.notReadable).toEqual([{ fleet: "gitlab.example.com/platform/infra", fineGrained: false, text: "platform/infra is not readable as GitLab · yuser: its login has no access to it. Choose another account." }]);
  });

  it("stores a token the service accepts when no fleet reads as the account", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    expect(w.accounts.tokens()).toEqual(["tok-yuser"]);
    expect(w.probe.reads).toEqual([]);
  });
});

describe("whose a token is (AC7)", () => {
  it("refuses a token of another login for GitHub · buser, storing nothing", async () => {
    const w = accountsWorld();
    owns(w, "tok-buser", "buser");
    owns(w, "tok-yuser", "yuser");
    const buser = await addLogin(w, github("tok-buser", "zorg"));
    expect(await api(w).connect({ account: { id: buser }, owner: "acme", secret: { kind: "token", token: "tok-yuser" } })).toEqual({
      outcome: "wrong-login",
      text: "This token belongs to yuser, not buser. Sign in as buser and create the token again.",
      command: null,
    });
    expect(w.accounts.tokens()).toEqual(["tok-buser"]);
  });

  it("refuses a token of buser for GitLab · yuser", async () => {
    const w = accountsWorld();
    owns(w, "tok-y", "yuser");
    owns(w, "tok-b", "buser");
    const yuser = await addLogin(w, { account: { service: "gitlab", place: "gitlab.example.com" }, secret: { kind: "token", token: "tok-y" } });
    expect(await api(w).connect({ account: { id: yuser }, secret: { kind: "token", token: "tok-b" } })).toMatchObject({ outcome: "wrong-login", text: expect.stringContaining("This token belongs to buser, not yuser") });
  });

  it("refuses, storing nothing, a gh login that gives another user's token, new or held", async () => {
    const w = accountsWorld();
    w.logins.set("gh", "github.com", "buser", "tok-gh");
    owns(w, "tok-gh", "yuser");
    expect(await api(w).connect({ account: { service: "github", place: "github.com" }, secret: { kind: "login", tool: "gh", login: "buser" } })).toEqual({
      outcome: "wrong-login",
      text: "gh gave a token of yuser, not buser.",
      command: "gh auth login --hostname github.com",
    });
    expect(w.accounts.accounts()).toEqual([]);
    w.accounts.addAccount({ id: "b", service: "github", place: "github.com", login: "buser", name: "buser", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    expect(await api(w).connect({ account: { id: "b" }, secret: { kind: "login", tool: "gh", login: "buser" } })).toEqual({
      outcome: "wrong-login",
      text: "gh is signed in as yuser, not buser.",
      command: "gh auth login --hostname github.com",
    });
    expect(w.accounts.credentials()).toEqual([]);
  });

  it("refuses a new login whose own API address claims a held account's login", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-fake", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    const claimed = await api(w).connect({ account: { service: "github", place: "github.com", apiUrl: "http://127.0.0.1:9999" }, owner: "acme", secret: { kind: "token", token: "tok-fake" }, confirm: true });
    expect(claimed).toMatchObject({ outcome: "invalid", text: expect.stringContaining("GitHub · yuser is already held") });
    expect(w.accounts.tokens()).toEqual(["tok-yuser"]);
  });

  it("shows a gh account whose gh gives yuser's token as signed in as yuser, and its fleet as not watched", async () => {
    const w = accountsWorld();
    w.accounts.addAccount({ id: "b", service: "github", place: "github.com", login: "buser", name: "buser", via: "gh", apiUrl: null, addedAt: "2026-10-12T09:00:00.000Z" });
    w.accounts.saveCredential({ id: "bc", accountId: "b", kind: "gh", owner: null, expiresAt: null, addedAt: "2026-10-12T09:00:00.000Z" }, null);
    w.accounts.assign("github.com", "b");
    w.logins.set("gh", "github.com", "buser", "tok-gh");
    owns(w, "tok-gh", "yuser");
    const outcome = await register(w, "github.com/acme/api");
    expect(outcome).toMatchObject({ watched: false, notWatched: [{ code: "no-credential", text: "gh is signed in as yuser, not buser", role: "forge" }] });
    expect(w.logins.asked).toContain("gh github.com buser");
    expect((await api(w).settings()).accounts[0]).toMatchObject({ label: "GitHub · buser", loginProblem: "gh is signed in as yuser, not buser", canWrite: true });
    expect(w.adapters.github.reads).toEqual([]);
  });
});

describe("Settings (AC8, AC10, AC11)", () => {
  it("lists each account with the hosts it is the default for, its credentials and the fleets that use them, and Make default on the others", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-buser", "buser", { classic: true });
    await addLogin(w, github("tok-yuser", "acme"));
    await addLogin(w, github("tok-buser", "zorg"));
    await register(w, "github.com/acme/api");
    const settings = await api(w).settings();
    expect(settings.accounts).toMatchObject([
      { label: "GitHub · yuser", defaultFor: ["github.com"], canMakeDefault: false, credentials: [{ reaches: "acme", kindLabel: "fine-grained token", expiresAt: null, fleets: ["github.com/acme/api"], canWrite: false }] },
      { label: "GitHub · buser", defaultFor: [], canMakeDefault: true, credentials: [{ reaches: "every owner on github.com", kindLabel: "classic token", canWrite: true, fleets: [] }] },
    ]);
    expect(JSON.stringify(settings)).not.toContain("tok-");
    const made = await api(w).makeDefault({ accountId: settings.accounts[1]!.id });
    expect(made).toMatchObject({ ok: true, settings: { accounts: [{ defaultFor: [] }, { defaultFor: ["github.com"] }] } });
  });

  it("warns of a token expiring within the window, with Renew opening the same pre-filled page, and a token saved through it replaces the old one", async () => {
    const w = accountsWorld();
    owns(w, "tok-old", "yuser", { expiresAt: "2026-10-15T10:00:00.000Z" });
    owns(w, "tok-new", "yuser", { expiresAt: "2027-01-10T10:00:00.000Z" });
    const yuser = await addLogin(w, github("tok-old", "acme"));
    await register(w, "github.com/acme/api");
    const settings = await api(w).settings();
    const credential = settings.accounts[0]!.credentials[0]!;
    expect(credential.expiresInDays).toBe(3);
    expect(credential.renew).toMatchObject({ kind: "create", owner: "acme", url: expect.stringContaining("target_name=acme") });
    const warning = (await card(w, "github.com/acme/api")).warnings[0];
    expect(warning).toMatchObject({ kind: "expires", daysLeft: 3, credentialId: credential.id, accountId: yuser, role: "forge" });
    const renewed = saved(await api(w).connect({ fleet: "github.com/acme/api", role: "forge", account: { id: yuser }, secret: { kind: "token", token: "tok-new" }, replaces: credential.id }));
    expect(renewed.revoke).toMatchObject({ text: expect.stringContaining("still works at GitHub"), url: "https://github.com/settings/personal-access-tokens" });
    expect(w.accounts.tokens()).toEqual(["tok-new"]);
  });

  it("reads every fleet a credential renewed from Settings reaches before it answers, so Settings shows them as read", async () => {
    const w = accountsWorld();
    owns(w, "tok-old", "yuser");
    owns(w, "tok-new", "yuser");
    const yuser = await addLogin(w, github("tok-old", "acme"));
    await register(w, "github.com/acme/api");
    const credential = (await api(w).settings()).accounts[0]!.credentials[0]!;
    w.readNow.length = 0;
    saved(await api(w).connect({ owner: "acme", account: { id: yuser }, secret: { kind: "token", token: "tok-new" }, replaces: credential.id }));
    expect(w.readNow).toEqual(["github.com/acme/api"]);
    expect(w.store.getFleet("github.com/acme/api")!.lastPolledAt).not.toBeNull();
  });

  it("offers a gh login no Renew but the command to sign in again", async () => {
    const w = accountsWorld();
    w.logins.set("gh", "github.com", "yuser", "tok-gh");
    owns(w, "tok-gh", "yuser");
    saved(await api(w).connect({ account: { service: "github", place: "github.com" }, secret: { kind: "login", tool: "gh", login: "yuser" } }));
    const settings = await api(w).settings();
    expect(settings.accounts[0]!.credentials[0]!.renew).toEqual({ kind: "login", command: "gh auth login --hostname github.com" });
    expect(w.accounts.tokens()).toEqual([]);
  });
});

describe("Linear and Jira (AC12)", () => {
  it("reads a Jira tracker as the Jira account connected for its site", async () => {
    const w = accountsWorld();
    owns(w, "tok-gl", "yuser");
    await addLogin(w, { account: { service: "gitlab", place: "gitlab.example.com" }, secret: { kind: "token", token: "tok-gl" } });
    w.probe.owners.set("ops@acme.com:tok-jira", { ok: true, login: "acc-1", name: "ops@acme.com", expiresAt: null, classic: false });
    await register(w, "gitlab.example.com/platform/infra", "jira:acme.atlassian.net/OPS");
    const input: ConnectInput = { fleet: "gitlab.example.com/platform/infra", role: "tracker", account: { service: "jira", place: "acme.atlassian.net" }, secret: { kind: "jira", email: "ops@acme.com", token: "tok-jira" } };
    expect(await api(w).connect(input)).toMatchObject({ outcome: "confirm", label: "Jira · ops@acme.com" });
    expect(saved(await api(w).connect({ ...input, confirm: true })).half).toMatchObject({ account: { label: "Jira · ops@acme.com" }, needs: null });
    expect((await card(w, "gitlab.example.com/platform/infra")).halves.every((half) => half.needs === null)).toBe(true);
  });

  it("says a tracker on a site off atlassian.net is not Jira Cloud, and adds no account", async () => {
    const w = accountsWorld();
    await register(w, "github.com/acme/api", "jira:jira.acme.com/OPS");
    expect(await api(w).connectView({ fleet: "github.com/acme/api", role: "tracker" })).toMatchObject({ ok: true, connect: { problem: expect.stringContaining("not a Jira Cloud site"), accounts: [] } });
    expect(await api(w).connect({ fleet: "github.com/acme/api", role: "tracker", account: { service: "jira", place: "jira.acme.com" }, secret: { kind: "jira", email: "a@b.c", token: "t" }, confirm: true })).toMatchObject({ outcome: "invalid" });
    expect(w.accounts.accounts()).toEqual([]);
  });

  it("adds a Linear account with its key, as linear:'s default", async () => {
    const w = accountsWorld();
    owns(w, "lin_api_key", "user-1", { name: "ana@acme.com" });
    await addLogin(w, { account: { service: "linear", place: "linear.app" }, secret: { kind: "token", token: "lin_api_key" } });
    expect(w.accounts.assignments()).toEqual([{ scope: "linear:", accountId: expect.any(String) }]);
  });
});

describe("removing (AC13)", () => {
  it("refuses to remove an account a registered fleet reads as, naming the fleet", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-buser", "buser");
    await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/zorg/z");
    const buser = await addLogin(w, github("tok-buser", "zorg", { fleet: "github.com/zorg/z", role: "forge" }));
    expect(w.accounts.assignments()).toContainEqual({ scope: "github.com/zorg", accountId: buser });
    const refused = await api(w).removeAccount({ accountId: buser });
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("github.com/zorg/z") });
    expect(w.accounts.tokens()).toContain("tok-buser");
  });

  it("deletes the tokens of an account no fleet reads as, and its default with it", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    const yuser = await addLogin(w, github("tok-yuser", "acme"));
    const removed = await api(w).removeAccount({ accountId: yuser });
    expect(removed).toMatchObject({ ok: true, settings: { accounts: [] }, revoke: { text: expect.stringContaining("until it expires or is revoked") } });
    expect(w.accounts.tokens()).toEqual([]);
    expect(w.accounts.assignments()).toEqual([]);
  });

  it("deletes a credential's token and points to the service to revoke it", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    await addLogin(w, github("tok-yuser", "acme"));
    const credential = (await api(w).settings()).accounts[0]!.credentials[0]!;
    expect(await api(w).removeCredential({ credentialId: credential.id })).toMatchObject({ ok: true, revoke: { url: "https://github.com/settings/personal-access-tokens" } });
    expect(w.accounts.tokens()).toEqual([]);
  });

  it("returns an assigned owner to the default, and refuses to remove a default that way", async () => {
    const w = accountsWorld();
    owns(w, "tok-yuser", "yuser");
    owns(w, "tok-buser", "buser");
    await addLogin(w, github("tok-yuser", "acme"));
    await register(w, "github.com/zorg/z");
    await addLogin(w, github("tok-buser", "zorg", { fleet: "github.com/zorg/z", role: "forge" }));
    expect(await api(w).removeAssignment({ scope: "github.com" })).toMatchObject({ ok: false, reason: expect.stringContaining("default") });
    expect(await api(w).removeAssignment({ scope: "github.com/zorg" })).toMatchObject({ ok: true });
    expect((await card(w, "github.com/zorg/z")).halves[0]).toMatchObject({ account: { label: "GitHub · yuser" }, needs: "zorg/z needs a GitHub account that can read zorg" });
  });
});

describe("no token leaves the plugin (AC14)", () => {
  it("puts no token in what Verify and save answers or logs, refused, of another login, or unanswered", async () => {
    const w = accountsWorld();
    owns(w, "tok-buser", "buser");
    owns(w, "tok-yuser-secret", "yuser");
    w.probe.owners.set("tok-unreachable-secret", { ok: false, why: "unreachable", reason: "GET /user failed: no answer" });
    const buser = await addLogin(w, github("tok-buser", "zorg"));
    const answers = [
      await api(w).connect(github("tok-rejected-secret", "acme", { confirm: true })),
      await api(w).connect({ account: { id: buser }, owner: "acme", secret: { kind: "token", token: "tok-yuser-secret" } }),
      await api(w).connect(github("tok-unreachable-secret", "acme", { confirm: true })),
    ];
    expect(answers.map((answer) => answer.outcome)).toEqual(["refused", "wrong-login", "unreachable"]);
    const said = JSON.stringify([answers, w.warnings, await api(w).settings(), await api(w).fleets()]);
    expect(said).not.toContain("secret");
  });
});
