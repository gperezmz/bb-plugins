// The settings section's poll intervals (AC16); its accounts are in accounts.test.ts.
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

describe("setInterval (AC16)", () => {
  it("sets a fleet's interval in seconds and returns the settings with it", async () => {
    const w = world();
    await start(w);
    const answer = await api(w).setInterval({ repo: REPO, seconds: 45 });
    expect(answer).toMatchObject({ ok: true, settings: { fleets: [{ repo: REPO, forge: "github", intervalMs: 45_000, isDefault: false }] } });
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

describe("the settings' fleets", () => {
  it("name the service behind each fleet's forge: its credential's, else its host's, else GitHub", async () => {
    const w = world();
    await start(w);
    w.credentials.set([{ prefix: "git.example.com/group", service: "gitlab" }]);
    w.manifests.files.set("/work/gl/manifest.md", manifest());
    w.manifests.files.set("/work/gl2/manifest.md", manifest());
    await registerFleet(w.register, MANAGER, args({ repo: "git.example.com/group/proj", manifest: "/work/gl/manifest.md" }));
    await registerFleet(w.register, MANAGER, args({ repo: "gitlab.com/group/other", manifest: "/work/gl2/manifest.md" }));
    const fleets = (await api(w).settings()).fleets;
    expect(Object.fromEntries(fleets.map((fleet) => [fleet.repo, fleet.forge]))).toEqual({ [REPO]: "github", "git.example.com/group/proj": "gitlab", "gitlab.com/group/other": "gitlab" });
  });
});
