import { describe, expect, it } from "vitest";
import { EMPTY_PORTS, type PortsSnapshot } from "../../shared/ports";
import { createFakeThreads, makeServerThread } from "../testing/fakes";
import type { ServerThread } from "../threads";
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
  backoffDelay,
  createPortsEngine,
  FRESH_TTL_MS,
  SNAPSHOT_TTL_MS,
} from "./engine";
import { cachedEnvironments, ENVIRONMENT_TTL_MS, MAX_CACHED_ENVIRONMENTS, type EnvironmentSource } from "./environments";
import { createClock, createFakeEnvironments, createFakePortsHost, hostListener } from "./testing/fakes";

const thread = (id: string, environmentId: string | null, overrides: Partial<ServerThread> = {}) =>
  makeServerThread(id, { environmentId, ...overrides });

function setup(
  machines: Parameters<typeof createFakePortsHost>[0] = { h1: [hostListener({ ownerThreadId: "thr_a" })] },
  threads: ServerThread[] = [thread("thr_a", "env-a")],
  locations: Record<string, { hostId: string; path: string }> = { "env-a": { hostId: "h1", path: "/work/app" } },
) {
  const clock = createClock();
  const host = createFakePortsHost(machines);
  const environments = createFakeEnvironments(locations);
  const fakeThreads = createFakeThreads(threads);
  const published: PortsSnapshot[] = [];
  const warnings: string[] = [];
  const engine = createPortsEngine({
    threads: fakeThreads,
    environments,
    host,
    publish: (snapshot) => published.push(snapshot),
    now: clock.read,
    warn: (message) => warnings.push(message),
  });
  return { clock, host, environments, threads: fakeThreads, engine, published, warnings };
}

describe("the snapshot", () => {
  it("lists the listeners of each environment's path, with the owner only for a thread in that environment", async () => {
    const { engine } = setup(
      {
        h1: [
          hostListener({ port: 5173, pid: 1, ownerThreadId: "thr_a" }),
          hostListener({ port: 4000, pid: 2, ownerThreadId: "thr_b" }),
          hostListener({ port: 3000, pid: 3, ownerThreadId: "thr_gone" }),
          hostListener({ port: 2000, pid: 4, ownerThreadId: null }),
        ],
      },
      [thread("thr_a", "env-a"), thread("thr_b", "env-b")],
      { "env-a": { hostId: "h1", path: "/work/app" }, "env-b": { hostId: "h1", path: "/work/other" } },
    );
    const { snapshot } = await engine.read({ fresh: false });
    expect(Object.keys(snapshot.environments)).toEqual(["env-a"]);
    expect(snapshot.environments["env-a"].listeners.map((l) => [l.port, l.ownerThreadId])).toEqual([
      [2000, null],
      [3000, null],
      [4000, null],
      [5173, "thr_a"],
    ]);
  });

  it("ignores an owner that is archived (absent from the threads) or works in another environment", async () => {
    const { engine } = setup(
      { h1: [hostListener({ port: 1, pid: 1, ownerThreadId: "thr_b" }), hostListener({ port: 2, pid: 2, ownerThreadId: "thr_old" })] },
      [thread("thr_a", "env-a"), thread("thr_b", "env-b")],
      { "env-a": { hostId: "h1", path: "/work/app" }, "env-b": { hostId: "h1", path: "/elsewhere" } },
    );
    const { snapshot } = await engine.read({ fresh: false });
    expect(snapshot.environments["env-a"].listeners.map((l) => l.ownerThreadId)).toEqual([null, null]);
  });

  it("gives every environment on one path that path's listeners", async () => {
    const { engine, host } = setup(
      { h1: [hostListener({ ownerThreadId: "thr_b" })] },
      [thread("thr_a", "env-a"), thread("thr_b", "env-b")],
      { "env-a": { hostId: "h1", path: "/work/app" }, "env-b": { hostId: "h1", path: "/work/app" } },
    );
    const { snapshot } = await engine.read({ fresh: false });
    expect(snapshot.environments["env-a"].listeners.map((l) => l.ownerThreadId)).toEqual([null]);
    expect(snapshot.environments["env-b"].listeners.map((l) => l.ownerThreadId)).toEqual(["thr_b"]);
    expect(host.scans).toEqual([{ hostId: "h1", workspaces: ["/work/app"] }]);
  });

  it("scans each machine once with its own workspaces, and skips an environment without a path", async () => {
    const { engine, host } = setup(
      { h1: [hostListener({ workspace: "/a" })], h2: [hostListener({ workspace: "/b", port: 9 })] },
      [thread("t1", "e1"), thread("t2", "e2"), thread("t3", "e3"), thread("t4", null)],
      { e1: { hostId: "h1", path: "/a" }, e2: { hostId: "h2", path: "/b" } },
    );
    const { snapshot } = await engine.read({ fresh: false });
    expect(host.scans.map((scan) => [scan.hostId, scan.workspaces])).toEqual([["h1", ["/a"]], ["h2", ["/b"]]]);
    expect(Object.keys(snapshot.environments).sort()).toEqual(["e1", "e2"]);
  });

  it("carries nothing but the snapshot fields", async () => {
    const { engine } = setup();
    const { snapshot } = await engine.read({ fresh: false });
    expect(Object.keys(snapshot).sort()).toEqual(["at", "environments", "failedHosts"]);
    expect(Object.keys(snapshot.environments["env-a"].listeners[0]).sort()).toEqual(
      ["address", "container", "ownerThreadId", "pid", "port", "process", "startedAt"],
    );
  });

  it("shows nothing for a machine that does not support ports, and fails nothing", async () => {
    const { engine, host } = setup();
    host.machines.set("h1", { supported: false, listeners: [] });
    const view = await engine.read({ fresh: false });
    expect(view.snapshot.environments).toEqual({});
    expect(view.snapshot.failedHosts).toEqual([]);
    expect(view.hostStatus.get("h1")).toBe("unsupported");
  });
});

describe("how long the snapshot lasts (AC9)", () => {
  it("answers a read within 30 s from the snapshot and scans again after", async () => {
    const { engine, host, clock } = setup();
    await engine.read({ fresh: false });
    clock.advance(SNAPSHOT_TTL_MS);
    await engine.read({ fresh: false });
    expect(host.scans).toHaveLength(1);
    clock.advance(1);
    await engine.read({ fresh: false });
    expect(host.scans).toHaveLength(2);
  });

  it("allows a new read for a fresh request only when the snapshot is older than 2 s", async () => {
    const { engine, host, clock } = setup();
    await engine.read({ fresh: true });
    clock.advance(FRESH_TTL_MS);
    await engine.read({ fresh: true });
    expect(host.scans).toHaveLength(1);
    clock.advance(1);
    await engine.read({ fresh: true });
    expect(host.scans).toHaveLength(2);
  });

  it("shares one scan among reads made while it runs", async () => {
    const { engine, host } = setup();
    const views = await Promise.all([engine.read({ fresh: false }), engine.read({ fresh: true }), engine.read({ fresh: false }), engine.refresh()]);
    expect(host.scans).toHaveLength(2);
    expect(new Set(views.slice(0, 3)).size).toBe(1);
  });

  it("refresh scans again after one in flight, so what a signal changed shows", async () => {
    const { engine, host } = setup();
    await engine.read({ fresh: false });
    host.machines.set("h1", { supported: true, listeners: [] });
    expect((await engine.refresh()).snapshot.environments).toEqual({});
  });
});

describe("publishing", () => {
  it("publishes when what the snapshot shows changes, not when only its time does", async () => {
    const { engine, host, clock, published } = setup();
    await engine.read({ fresh: false });
    clock.advance(SNAPSHOT_TTL_MS + 1);
    await engine.read({ fresh: false });
    expect(published).toHaveLength(1);
    host.machines.set("h1", { supported: true, listeners: [] });
    clock.advance(SNAPSHOT_TTL_MS + 1);
    await engine.read({ fresh: false });
    expect(published).toHaveLength(2);
    expect(published[1].environments).toEqual({});
  });
});

describe("an environment bb cannot be asked about", () => {
  const twoEnvironments = () =>
    setup(
      { h1: [hostListener({ workspace: "/a", ownerThreadId: "t1" }), hostListener({ workspace: "/b", port: 9, pid: 9 })] },
      [thread("t1", "e1"), thread("t2", "e2")],
      { e1: { hostId: "h1", path: "/a" }, e2: { hostId: "h1", path: "/b" } },
    );

  it("is unscannable, keeps what the last snapshot showed for it, and leaves the others alone", async () => {
    const { engine, environments, clock } = twoEnvironments();
    const before = await engine.read({ fresh: false });
    environments.locations.delete("e2");
    environments.failIds.add("e1");
    clock.advance(SNAPSHOT_TTL_MS + 1);
    const view = await engine.read({ fresh: false });
    expect(view.unresolved).toEqual(new Set(["e1"]));
    expect(view.snapshot.environments.e1).toEqual(before.snapshot.environments.e1);
    expect(view.snapshot.environments.e2).toBeUndefined();
    expect(view.complete).toBe(true);
  });

  it("is told apart from an environment that truly has no path", async () => {
    const { engine, environments } = twoEnvironments();
    environments.locations.delete("e1");
    const view = await engine.read({ fresh: false });
    expect(view.unresolved.size).toBe(0);
    expect(view.locations.has("e1")).toBe(false);
  });
});

describe("a machine that fails (AC3)", () => {
  const twoMachines = () =>
    setup(
      { h1: [hostListener({ workspace: "/a" })], h2: [hostListener({ workspace: "/b", port: 9 })] },
      [thread("t1", "e1"), thread("t2", "e2")],
      { e1: { hostId: "h1", path: "/a" }, e2: { hostId: "h2", path: "/b" } },
    );

  it("drops its ports and lists it while the other machines answer", async () => {
    const { engine, host, published } = twoMachines();
    await engine.read({ fresh: false });
    host.machines.set("h2", new Error("offline"));
    const view = await engine.refresh();
    expect(Object.keys(view.snapshot.environments)).toEqual(["e1"]);
    expect(view.snapshot.failedHosts).toEqual(["h2"]);
    expect(view.hostStatus.get("h2")).toBe("failed");
    expect(published.at(-1)?.failedHosts).toEqual(["h2"]);
  });

  it("backs off 30 s, then doubling, up to 5 minutes", async () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffDelay)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(backoffDelay(1)).toBe(BACKOFF_FIRST_MS);
    expect(backoffDelay(99)).toBe(BACKOFF_MAX_MS);
    const { engine, host, clock } = twoMachines();
    host.machines.set("h2", new Error("offline"));
    await engine.read({ fresh: false });
    const scansOfH2 = () => host.scans.filter((scan) => scan.hostId === "h2").length;
    expect(scansOfH2()).toBe(1);
    // Within the first 30 s the machine is not asked, however often the snapshot refreshes.
    clock.advance(BACKOFF_FIRST_MS - 1);
    await engine.refresh();
    expect(scansOfH2()).toBe(1);
    clock.advance(1);
    await engine.refresh();
    expect(scansOfH2()).toBe(2);
    // The second failure waits 60 s.
    clock.advance(59_999);
    await engine.refresh();
    expect(scansOfH2()).toBe(2);
    clock.advance(1);
    await engine.refresh();
    expect(scansOfH2()).toBe(3);
  });

  it("asks a machine again after it recovers, restoring its ports", async () => {
    const { engine, host, clock } = twoMachines();
    host.machines.set("h2", new Error("offline"));
    await engine.read({ fresh: false });
    host.machines.set("h2", { supported: true, listeners: [hostListener({ workspace: "/b", port: 9 })] });
    clock.advance(BACKOFF_FIRST_MS);
    const view = await engine.refresh();
    expect(Object.keys(view.snapshot.environments).sort()).toEqual(["e1", "e2"]);
    expect(view.snapshot.failedHosts).toEqual([]);
  });

  it("keeps the last snapshot when a refresh fails entirely", async () => {
    const { engine, host, clock, published } = setup();
    const before = (await engine.read({ fresh: false })).snapshot;
    host.machines.set("h1", new Error("offline"));
    clock.advance(SNAPSHOT_TTL_MS + 1);
    const view = await engine.read({ fresh: false });
    expect(view.snapshot).toBe(before);
    expect(view.hostStatus.get("h1")).toBe("failed");
    expect(published).toHaveLength(1);
  });

  it("keeps the last snapshot when the threads or environments cannot be read", async () => {
    const { engine, environments, clock } = setup();
    const before = (await engine.read({ fresh: false })).snapshot;
    environments.fail = true;
    clock.advance(SNAPSHOT_TTL_MS + 1);
    const view = await engine.read({ fresh: false });
    expect(view.snapshot).toBe(before);
    expect(view.complete).toBe(false);
  });

  it("keeps the last snapshot for as long as every machine fails, until one answers", async () => {
    const { engine, host, clock, published } = setup();
    const before = (await engine.read({ fresh: false })).snapshot;
    host.machines.set("h1", new Error("offline"));
    for (let hour = 0; hour < 3; hour++) {
      clock.advance(60 * 60_000);
      expect((await engine.read({ fresh: false })).snapshot).toBe(before);
    }
    expect(published).toHaveLength(1);
    host.machines.set("h1", { supported: true, listeners: [] });
    clock.advance(BACKOFF_MAX_MS);
    expect((await engine.read({ fresh: false })).snapshot.environments).toEqual({});
    expect(published).toHaveLength(2);
  });

  it("logs the machine and the count, nothing a machine said", async () => {
    const { engine, host, warnings } = setup();
    host.machines.set("h1", new Error("lsof says BB_THREAD_ID=thr_x --token=s3cr3t"));
    await engine.read({ fresh: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("h1");
    expect(warnings[0]).not.toContain("s3cr3t");
    expect(warnings[0]).not.toContain("lsof");
  });

  it("starts empty before the first read", () => {
    const { engine } = setup();
    expect(engine.current().snapshot).toBe(EMPTY_PORTS);
  });
});

describe("the environment cache", () => {
  function source() {
    const reads: string[][] = [];
    const known: EnvironmentSource = {
      async read(ids) {
        reads.push([...ids]);
        const failed = new Set(ids.filter((id) => id.startsWith("broken")));
        const found = new Map(ids.filter((id) => !failed.has(id)).map((id) => [id, id === "bare" ? null : { hostId: "h", path: `/p/${id}` }] as const));
        return { found, failed };
      },
    };
    return { reads, known };
  }

  it("keeps a location for a minute and skips an environment without a path", async () => {
    const clock = createClock();
    const { reads, known } = source();
    const directory = cachedEnvironments(known, clock.read);
    expect([...(await directory.resolve(["a", "bare"])).locations]).toEqual([["a", { hostId: "h", path: "/p/a" }]]);
    clock.advance(ENVIRONMENT_TTL_MS - 1);
    await directory.resolve(["a", "bare", "a"]);
    expect(reads).toEqual([["a", "bare"]]);
    clock.advance(1);
    await directory.resolve(["a"]);
    expect(reads).toEqual([["a", "bare"], ["a"]]);
  });

  it("reports the environments bb could not answer for, apart from those with no path, and asks again for them", async () => {
    const clock = createClock();
    const { reads, known } = source();
    const directory = cachedEnvironments(known, clock.read);
    const first = await directory.resolve(["a", "bare", "broken1"]);
    expect([...first.failed]).toEqual(["broken1"]);
    expect([...first.locations.keys()]).toEqual(["a"]);
    await directory.resolve(["a", "bare", "broken1"]);
    expect(reads).toEqual([["a", "bare", "broken1"], ["broken1"]]);
  });

  it("holds a bounded number of locations", async () => {
    const clock = createClock();
    const { reads, known } = source();
    const directory = cachedEnvironments(known, clock.read);
    const ids = Array.from({ length: MAX_CACHED_ENVIRONMENTS + 10 }, (_, index) => `e${index}`);
    await directory.resolve(ids);
    await directory.resolve(["e0", "e1"]);
    // The oldest were evicted, so they are read again.
    expect(reads.at(-1)).toEqual(["e0", "e1"]);
    reads.length = 0;
    await directory.resolve([ids.at(-1)!]);
    expect(reads).toEqual([]);
  });
});
