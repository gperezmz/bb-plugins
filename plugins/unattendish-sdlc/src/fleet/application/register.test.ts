import { describe, expect, it } from "vitest";
import { args, manifest, MANAGER, MANIFEST_PATH, REPO_KEY, world } from "../testing/kit";
import { registerFleet } from "./register";

describe("registerFleet (AC1)", () => {
  it("registers a repository no fleet holds, and says it is not fully watched while its manifest is missing", async () => {
    const w = world();
    const outcome = await registerFleet(w.register, MANAGER, args());
    expect(outcome).toEqual({ outcome: "registered", watched: false, notWatched: [{ code: "manifest-missing", text: expect.stringContaining(MANIFEST_PATH) }] });
    expect(w.store.getFleet(REPO_KEY)?.registration).toMatchObject({ managerThreadId: MANAGER, operator: "olivia" });
  });

  it("is watched, with no reasons, once the manifest can be read and a credential is chosen", async () => {
    const w = world();
    w.manifests.files.set(MANIFEST_PATH, manifest());
    expect(await registerFleet(w.register, MANAGER, args())).toEqual({ outcome: "registered", watched: true, notWatched: [] });
  });

  it("says the manifest is unreadable, and that no credential is chosen, naming the path and the repository", async () => {
    const w = world();
    w.manifests.files.set(MANIFEST_PATH, "not a manifest");
    w.credentials.set([]);
    const outcome = await registerFleet(w.register, MANAGER, args());
    expect(outcome).toMatchObject({ outcome: "registered", watched: false });
    if (outcome.outcome !== "registered") throw new Error("not registered");
    const reasons = outcome.notWatched;
    expect(reasons.map((r) => r.code).sort()).toEqual(["manifest-unreadable", "no-credential"]);
    expect(reasons.find((r) => r.code === "no-credential")!.text).toContain("github.com/org/repo");
    expect(reasons.find((r) => r.code === "manifest-unreadable")!.text).toContain(MANIFEST_PATH);
  });

  it("refuses a second manager while the first thread lives, leaving its registration unchanged", async () => {
    const w = world();
    await registerFleet(w.register, MANAGER, args());
    w.threads.states.set("thr_second", "live");
    const before = w.store.getFleet(REPO_KEY);
    const outcome = await registerFleet(w.register, "thr_second", args({ labelSpec: "other" }));
    expect(outcome).toEqual({ outcome: "refused", holder: MANAGER });
    expect(w.store.getFleet(REPO_KEY)).toEqual(before);
  });

  it("lets a second thread take over from an archived manager, handing it the old manifest path", async () => {
    const w = world();
    await registerFleet(w.register, MANAGER, args());
    w.threads.states.set(MANAGER, "archived");
    w.threads.states.set("thr_second", "live");
    const outcome = await registerFleet(w.register, "thr_second", args({ manifest: "/work2/fleet/manifest.md" }));
    expect(outcome).toMatchObject({ outcome: "taken-over", previousManager: MANAGER, previousManifest: MANIFEST_PATH });
    expect(w.store.getFleet(REPO_KEY)?.registration).toMatchObject({ managerThreadId: "thr_second", manifestPath: "/work2/fleet/manifest.md" });
  });

  it("treats a manager bb no longer lists as archived", async () => {
    const w = world();
    await registerFleet(w.register, MANAGER, args());
    w.threads.states.set(MANAGER, "gone");
    expect(await registerFleet(w.register, "thr_second", args())).toMatchObject({ outcome: "taken-over", previousManager: MANAGER });
  });

  it("applies new labels when the holder registers again, and keeps its interval and registration time", async () => {
    const w = world();
    await registerFleet(w.register, MANAGER, args());
    w.store.setIntervalMs(REPO_KEY, 45_000);
    const registeredAt = w.store.getFleet(REPO_KEY)!.registration.registeredAt;
    w.clock.advance(3_600_000);
    const outcome = await registerFleet(w.register, MANAGER, args({ labelReady: "ready" }));
    expect(outcome).toMatchObject({ outcome: "registered" });
    expect(w.store.getFleet(REPO_KEY)!.registration).toMatchObject({ labels: { ready: "ready" }, intervalMs: 45_000, registeredAt });
  });

  it("answers an unsupported contract version without registering", async () => {
    const w = world();
    expect(await registerFleet(w.register, MANAGER, args({ contract: 2 }))).toEqual({ outcome: "unsupported", supported: [1] });
    expect(w.store.listFleets()).toEqual([]);
  });

  it("answers an echo actor equal to the operator as invalid, naming --echo-actor, and changes nothing", async () => {
    const w = world();
    await registerFleet(w.register, MANAGER, args());
    const before = w.store.getFleet(REPO_KEY);
    const outcome = await registerFleet(w.register, MANAGER, args({ echoActors: ["Olivia"], labelSpec: "changed" }));
    expect(outcome).toMatchObject({ outcome: "invalid", reason: expect.stringContaining("--echo-actor") });
    expect(w.store.getFleet(REPO_KEY)).toEqual(before);
  });

  it("does not register a tracker none of the forms names", async () => {
    const w = world();
    expect(await registerFleet(w.register, MANAGER, args({ tracker: "asana:x" }))).toMatchObject({ outcome: "invalid", reason: expect.stringContaining("--tracker") });
    expect(w.store.listFleets()).toEqual([]);
  });
});
