// The settings section: credentials and poll intervals (AC16).
import { describe, expect, it } from "vitest";
import { args, manifest, MANAGER, MANIFEST_PATH, REPO_KEY, world, type World } from "../testing/kit";
import { createDashboard } from "./dashboard";
import { registerFleet } from "./register";

const REPO = "github.com/org/repo";
const start = async (w: World) => {
  w.manifests.files.set(MANIFEST_PATH, manifest());
  await registerFleet(w.register, MANAGER, args());
};
const api = (w: World) => createDashboard(w.dash);

describe("settings", () => {
  it("lists every credential with its prefix, kind, service, whether a token is stored and the expiry some fleet reported", async () => {
    const w = world();
    await start(w);
    w.admin.entries.push(
      { prefix: "github.com/org", auth: "token", service: "github", baseUrl: "https://api.github.com", hasToken: true, problem: null },
      { prefix: "gitlab.com", auth: "glab", service: "gitlab", baseUrl: null, hasToken: false, problem: null },
      { prefix: "git.example.net", auth: "token", service: null, baseUrl: null, hasToken: false, problem: "needs a service" },
    );
    w.admin.problems = ["credentials entry 3 (git.example.net): needs a service"];
    w.store.savePollState(REPO_KEY, { lastPolledAt: null, notWatched: [], unreadableRows: [], outsideLinks: [], expiries: { "github.com/org": "2026-12-01T00:00:00.000Z" }, heldSince: null, pendingCatchUpMs: null, outages: {} });
    expect(await api(w).settings()).toEqual({
      credentials: [
        { prefix: "github.com/org", auth: "token", service: "github", baseUrl: "https://api.github.com", hasToken: true, expiresAt: "2026-12-01T00:00:00.000Z", problem: null },
        { prefix: "gitlab.com", auth: "glab", service: "gitlab", baseUrl: null, hasToken: false, expiresAt: null, problem: null },
        { prefix: "git.example.net", auth: "token", service: null, baseUrl: null, hasToken: false, expiresAt: null, problem: "needs a service" },
      ],
      fleets: [{ repo: REPO, intervalMs: 120_000, isDefault: true }],
      problems: ["credentials entry 3 (git.example.net): needs a service"],
    });
  });

  it("adds, edits and removes a credential, answering with the settings and telling the windows", async () => {
    const w = world();
    const before = w.events.boardChanges;
    const added = await api(w).saveCredential({ prefix: "github.com/org", auth: "token", token: "ghp_fake_value_1234" });
    expect(added).toMatchObject({ ok: true, settings: { credentials: [{ prefix: "github.com/org", auth: "token", hasToken: true }] } });
    expect(JSON.stringify(added)).not.toContain("ghp_fake_value_1234");
    const edited = await api(w).saveCredential({ was: "github.com/org", prefix: "github.com/org", auth: "gh" });
    expect(edited).toMatchObject({ ok: true, settings: { credentials: [{ auth: "gh" }] } });
    const removed = await api(w).removeCredential({ prefix: "github.com/org" });
    expect(removed).toMatchObject({ ok: true, settings: { credentials: [] } });
    expect(w.events.boardChanges).toBe(before + 3);
  });

  it("answers a refusal as it came, changes nothing and tells no one", async () => {
    const w = world();
    const before = w.events.boardChanges;
    expect(await api(w).saveCredential({ prefix: "  ", auth: "token" })).toEqual({ ok: false, reason: "the prefix is empty" });
    expect(await api(w).removeCredential({ prefix: "github.com/none" })).toMatchObject({ ok: false });
    expect(w.events.boardChanges).toBe(before);
  });
});

describe("setInterval (AC16)", () => {
  it("sets a fleet's interval in seconds and returns the settings with it", async () => {
    const w = world();
    await start(w);
    const answer = await api(w).setInterval({ repo: REPO, seconds: 45 });
    expect(answer).toMatchObject({ ok: true, settings: { fleets: [{ repo: REPO, intervalMs: 45_000, isDefault: false }] } });
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBe(45_000);
  });

  it("refuses under 30 seconds, and changes nothing", async () => {
    const w = world();
    await start(w);
    const before = w.events.boardChanges;
    expect(await api(w).setInterval({ repo: REPO, seconds: 29 })).toMatchObject({ ok: false, reason: expect.stringContaining("30-second") });
    expect(await api(w).setInterval({ repo: REPO, seconds: 0.5 })).toMatchObject({ ok: false });
    expect(await api(w).setInterval({ repo: REPO, seconds: Number.NaN })).toMatchObject({ ok: false });
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBeNull();
    expect(w.events.boardChanges).toBe(before);
  });

  it("accepts exactly 30 seconds", async () => {
    const w = world();
    await start(w);
    expect(await api(w).setInterval({ repo: REPO, seconds: 30 })).toMatchObject({ ok: true });
  });

  it("restores the default with null", async () => {
    const w = world();
    await start(w);
    await api(w).setInterval({ repo: REPO, seconds: 60 });
    expect(await api(w).setInterval({ repo: REPO, seconds: null })).toMatchObject({ ok: true, settings: { fleets: [{ intervalMs: 120_000, isDefault: true }] } });
  });

  it("refuses a repository no fleet holds", async () => {
    expect(await api(world()).setInterval({ repo: "github.com/org/none", seconds: 60 })).toMatchObject({ ok: false, reason: expect.stringContaining("no fleet") });
  });

  it("runs behind a poll of the fleet, answers at once with the interval asked, and sets it once the poll ends", async () => {
    const w = world();
    await start(w);
    let release!: () => void;
    const held = w.queue.run(REPO_KEY, () => new Promise<void>((resolve) => (release = resolve)));
    const answer = await api(w).setInterval({ repo: REPO, seconds: 60 });
    expect(answer).toMatchObject({ ok: true, settings: { fleets: [{ intervalMs: 60_000, isDefault: false }] } });
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBeNull();
    release();
    await held;
    await w.queue.run(REPO_KEY, async () => undefined);
    expect(w.store.getFleet(REPO_KEY)!.registration.intervalMs).toBe(60_000);
  });
});
