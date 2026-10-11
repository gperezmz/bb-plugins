import { describe, expect, it } from "vitest";
import { EMPTY_PORTS, type PortListener, type PortsSnapshot } from "../../shared/ports";
import { distinctProcesses, holdBackThreads, isScannable, ownerInEnvironment, snapshotEnvironments, snapshotKey, type HostStatus, type PortsView } from "./rules";
import { hostListener } from "./testing/fakes";

const listener = (overrides: Partial<PortListener> = {}): PortListener => ({
  port: 5173,
  address: "127.0.0.1",
  process: "node",
  pid: 1,
  startedAt: 1,
  ownerThreadId: null,
  container: null,
  ...overrides,
});

function view(options: {
  environments?: PortsSnapshot["environments"];
  locations?: Record<string, string>;
  status?: Record<string, HostStatus>;
  complete?: boolean;
  unresolved?: string[];
}): PortsView {
  return {
    snapshot: { ...EMPTY_PORTS, environments: options.environments ?? {} },
    locations: new Map(Object.entries(options.locations ?? {}).map(([id, hostId]) => [id, { hostId, path: `/${id}` }])),
    unresolved: new Set(options.unresolved ?? []),
    hostStatus: new Map(Object.entries(options.status ?? {})),
    complete: options.complete ?? true,
  };
}

describe("ownerInEnvironment", () => {
  const threads = new Map<string, string | null>([["thr_a", "env-a"], ["thr_b", "env-b"], ["thr_none", null]]);

  it("counts an owner that works in the environment", () => {
    expect(ownerInEnvironment("thr_a", "env-a", threads)).toBe("thr_a");
  });

  it("drops an owner in another environment, without one, or that is not a live thread", () => {
    expect(ownerInEnvironment("thr_b", "env-a", threads)).toBeNull();
    expect(ownerInEnvironment("thr_none", "env-a", threads)).toBeNull();
    expect(ownerInEnvironment("thr_gone", "env-a", threads)).toBeNull();
    expect(ownerInEnvironment(null, "env-a", threads)).toBeNull();
  });
});

describe("snapshotEnvironments", () => {
  it("leaves out a machine that did not answer and an environment with no listener", () => {
    const environments = snapshotEnvironments({
      locations: new Map([
        ["e1", { hostId: "h1", path: "/a" }],
        ["e2", { hostId: "h2", path: "/b" }],
        ["e3", { hostId: "h1", path: "/c" }],
      ]),
      scans: new Map([["h1", [hostListener({ workspace: "/a" })]]]),
      threadEnvironments: new Map(),
    });
    expect(Object.keys(environments)).toEqual(["e1"]);
  });
});

describe("snapshotKey", () => {
  it("is equal for snapshots that show the same, whatever their time", () => {
    const environments = { e: { hostId: "h", listeners: [listener()] } };
    expect(snapshotKey({ at: 1, environments, failedHosts: ["b", "a"] })).toBe(snapshotKey({ at: 2, environments, failedHosts: ["a", "b"] }));
    expect(snapshotKey({ at: 1, environments, failedHosts: [] })).not.toBe(snapshotKey({ at: 1, environments: {}, failedHosts: [] }));
  });
});

describe("holdBackThreads (AC7)", () => {
  const ok = { h: "ok" as const };

  it("holds back the owner of a port", () => {
    const held = holdBackThreads(
      [{ id: "a", environmentId: "e" }, { id: "b", environmentId: "e" }],
      view({ environments: { e: { hostId: "h", listeners: [listener({ ownerThreadId: "a" })] } }, locations: { e: "h" }, status: ok }),
    );
    expect([...held]).toEqual(["a"]);
  });

  it("holds back the only thread of an environment that has an unowned port, but not one of several", () => {
    const unowned = { e: { hostId: "h", listeners: [listener()] } };
    expect([...holdBackThreads([{ id: "a", environmentId: "e" }], view({ environments: unowned, locations: { e: "h" }, status: ok }))]).toEqual(["a"]);
    expect(
      holdBackThreads([{ id: "a", environmentId: "e" }, { id: "b", environmentId: "e" }], view({ environments: unowned, locations: { e: "h" }, status: ok })).size,
    ).toBe(0);
  });

  it("counts hidden threads among those sharing the environment", () => {
    // The caller passes every non-archived thread, hidden ones included.
    const held = holdBackThreads(
      [{ id: "a", environmentId: "e" }, { id: "helper", environmentId: "e" }],
      view({ environments: { e: { hostId: "h", listeners: [listener()] } }, locations: { e: "h" }, status: ok }),
    );
    expect(held.size).toBe(0);
  });

  it("holds back every thread of a machine that failed, and of all machines when nothing could be read", () => {
    const threads = [{ id: "a", environmentId: "e1" }, { id: "b", environmentId: "e2" }, { id: "c", environmentId: null }];
    const failed = view({ locations: { e1: "bad", e2: "good" }, status: { bad: "failed", good: "ok" } });
    expect([...holdBackThreads(threads, failed)]).toEqual(["a"]);
    expect([...holdBackThreads(threads, view({ locations: {}, complete: false }))].sort()).toEqual(["a", "b"]);
  });

  it("holds back a thread whose environment could not be resolved, but not one whose environment has no path", () => {
    const threads = [{ id: "a", environmentId: "unknown" }, { id: "b", environmentId: "nopath" }];
    const held = holdBackThreads(threads, view({ locations: {}, unresolved: ["unknown"] }));
    expect([...held]).toEqual(["a"]);
  });

  it("holds back nothing for a thread with no listener, an unsupported machine, or an environment with no path", () => {
    const threads = [{ id: "a", environmentId: "e1" }, { id: "b", environmentId: "nopath" }];
    expect(holdBackThreads(threads, view({ locations: { e1: "win" }, status: { win: "unsupported" } })).size).toBe(0);
  });

  it("does not hold back a thread for a port another thread owns when it is not alone", () => {
    const held = holdBackThreads(
      [{ id: "a", environmentId: "e" }, { id: "b", environmentId: "e" }],
      view({ environments: { e: { hostId: "h", listeners: [listener({ ownerThreadId: "a" })] } }, locations: { e: "h" }, status: ok }),
    );
    expect(held.has("b")).toBe(false);
  });

  it("treats a machine that was never read as unscannable", () => {
    expect(isScannable(view({ locations: { e: "h" } }), "e")).toBe(false);
  });
});

describe("distinctProcesses", () => {
  it("keeps the first port of each process, told by PID and start time", () => {
    const targets = [
      { port: 1, pid: 10, startedAt: 1 },
      { port: 2, pid: 10, startedAt: 1 },
      { port: 3, pid: 10, startedAt: 2 },
      { port: 4, pid: 11, startedAt: 1 },
    ];
    expect(distinctProcesses(targets).map((target) => target.port)).toEqual([1, 3, 4]);
  });
});
