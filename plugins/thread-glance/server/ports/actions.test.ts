import { describe, expect, it } from "vitest";
import { settledRow } from "../../shared/lifecycle";
import { createPortsWorld, settled, SETTLED_AT } from "./testing/world";
import { hostListener } from "./testing/fakes";

const LOCATIONS = { "env-a": { hostId: "h1", path: "/work/app" } };

/** Thread A owns :5173 (pid 10); :3000 (pid 20) is unowned; both are in env-a. */
function world(overrides: Parameters<typeof createPortsWorld>[0] = {}) {
  return createPortsWorld({
    threads: [settled("thr_a", "env-a"), settled("thr_b", "env-a")],
    locations: LOCATIONS,
    rows: { thr_a: settledRow(SETTLED_AT, "manual") },
    machines: {
      h1: [
        hostListener({ port: 5173, pid: 10, startedAt: 111, ownerThreadId: "thr_a" }),
        hostListener({ port: 3000, pid: 20, startedAt: 222 }),
      ],
    },
    ...overrides,
  });
}

describe("Stop (AC4)", () => {
  it("signals a process the snapshot lists in the thread's environment and refreshes afterwards", async () => {
    const w = world();
    const outcome = await w.actions.stop({ threadId: "thr_b", port: 3000, pid: 20, startedAt: 222 });
    expect(outcome).toEqual({ outcome: "requested" });
    expect(w.host.signals).toEqual([{ hostId: "h1", port: 3000, pid: 20, startedAt: 222, workspaces: ["/work/app"] }]);
    // One scan to build the snapshot, one after the signal.
    expect(w.host.scans).toHaveLength(2);
  });

  it("refuses a port, PID or start time the snapshot does not list, and signals nothing", async () => {
    const w = world();
    for (const target of [
      { port: 9999, pid: 20, startedAt: 222 },
      { port: 3000, pid: 21, startedAt: 222 },
      { port: 3000, pid: 20, startedAt: 223 },
    ]) {
      expect(await w.actions.stop({ threadId: "thr_b", ...target })).toEqual({ outcome: "refused" });
    }
    expect(w.host.signals).toEqual([]);
  });

  it("refuses a listener outside every workspace: it is not in the snapshot at all", async () => {
    const w = world();
    w.host.machines.set("h1", {
      supported: true,
      listeners: [hostListener({ port: 4444, pid: 44, startedAt: 4, workspace: "/somewhere/else" })],
    });
    expect(await w.actions.stop({ threadId: "thr_a", port: 4444, pid: 44, startedAt: 4 })).toEqual({ outcome: "refused" });
    expect(w.host.signals).toEqual([]);
  });

  it("refuses a listener of another environment, and a thread bb does not list", async () => {
    const w = createPortsWorld({
      threads: [settled("thr_a", "env-a"), settled("thr_c", "env-c")],
      locations: { ...LOCATIONS, "env-c": { hostId: "h1", path: "/work/c" } },
      machines: { h1: [hostListener({ port: 3000, pid: 20, startedAt: 222 })] },
    });
    expect(await w.actions.stop({ threadId: "thr_c", port: 3000, pid: 20, startedAt: 222 })).toEqual({ outcome: "refused" });
    expect(await w.actions.stop({ threadId: "thr_zzz", port: 3000, pid: 20, startedAt: 222 })).toEqual({ outcome: "refused" });
    expect(w.host.signals).toEqual([]);
  });

  it("does not list a port only Docker reports as stoppable", async () => {
    const w = world();
    w.host.machines.set("h1", { supported: true, listeners: [hostListener({ port: 8080, pid: null, startedAt: null, process: null, container: "web" })] });
    expect(await w.actions.stop({ threadId: "thr_a", port: 8080, pid: 1, startedAt: 1 })).toEqual({ outcome: "refused" });
  });

  it("says gone when the host finds the process changed since the scan (a reused PID)", async () => {
    const w = world();
    w.host.signalResult = () => "changed";
    expect(await w.actions.stop({ threadId: "thr_b", port: 3000, pid: 20, startedAt: 222 })).toEqual({ outcome: "gone" });
  });

  it("rejects when the host's signal fails", async () => {
    const w = world();
    w.host.signalResult = () => "failed";
    await expect(w.actions.stop({ threadId: "thr_b", port: 3000, pid: 20, startedAt: 222 })).rejects.toThrow();
  });
});

describe("ownedPorts", () => {
  it("lists the ports the thread owns from a fresh read", async () => {
    const w = world();
    await w.engine.read({ fresh: false });
    w.clock.advance(5_000);
    w.host.machines.set("h1", { supported: true, listeners: [hostListener({ port: 6000, pid: 60, startedAt: 6, ownerThreadId: "thr_a" })] });
    expect(await w.actions.owned("thr_a")).toEqual({ ports: [{ port: 6000, pid: 60, startedAt: 6, process: "node" }] });
  });

  it("leaves out an owned port that has no process or start time", async () => {
    const w = world();
    w.host.machines.set("h1", { supported: true, listeners: [hostListener({ pid: null, startedAt: null, ownerThreadId: "thr_a" })] });
    expect(await w.actions.owned("thr_a")).toEqual({ ports: [] });
  });

  it("rejects when the machine cannot be scanned", async () => {
    const w = world({ machines: { h1: new Error("offline") } });
    await expect(w.actions.owned("thr_a")).rejects.toThrow("Ports could not be checked");
  });

  it("answers nothing for a machine that does not support ports", async () => {
    const w = world();
    w.host.machines.set("h1", { supported: false, listeners: [] });
    expect(await w.actions.owned("thr_a")).toEqual({ ports: [] });
  });
});

describe("Close (AC6)", () => {
  const owned = { port: 5173, pid: 10, startedAt: 111 };

  it("signals the owned port of a settled thread and reports it requested", async () => {
    const w = world();
    expect(await w.actions.close({ threadId: "thr_a", ports: [owned] })).toEqual({ outcome: "requested" });
    expect(w.host.signals.map((signal) => signal.port)).toEqual([5173]);
  });

  it("signals nothing when the thread was un-settled before Close", async () => {
    const w = world();
    w.lifecycle.putMany([["thr_a", null]]);
    expect(await w.actions.close({ threadId: "thr_a", ports: [owned] })).toEqual({ outcome: "none" });
    expect(w.host.signals).toEqual([]);
  });

  it("signals nothing when attention has made the settle stale", async () => {
    const w = world();
    w.threads.threads.set("thr_a", { ...w.threads.threads.get("thr_a")!, latestAttentionAt: SETTLED_AT + 1 });
    expect(await w.actions.close({ threadId: "thr_a", ports: [owned] })).toEqual({ outcome: "none" });
    expect(w.host.signals).toEqual([]);
  });

  it("stops signalling when the thread is un-settled between two ports", async () => {
    const w = world();
    w.host.machines.set("h1", {
      supported: true,
      listeners: [
        hostListener({ port: 5173, pid: 10, startedAt: 111, ownerThreadId: "thr_a" }),
        hostListener({ port: 5174, pid: 11, startedAt: 112, ownerThreadId: "thr_a" }),
      ],
    });
    w.host.signalResult = () => {
      w.lifecycle.putMany([["thr_a", null]]);
      return "sent";
    };
    const outcome = await w.actions.close({
      threadId: "thr_a",
      ports: [owned, { port: 5174, pid: 11, startedAt: 112 }],
    });
    expect(w.host.signals).toHaveLength(1);
    expect(outcome).toEqual({ outcome: "partial" });
  });

  it("ignores a port the snapshot does not list as the thread's: unowned, another PID, another start", async () => {
    const w = world();
    expect(
      await w.actions.close({
        threadId: "thr_a",
        ports: [{ port: 3000, pid: 20, startedAt: 222 }, { ...owned, pid: 11 }, { ...owned, startedAt: 112 }],
      }),
    ).toEqual({ outcome: "none" });
    expect(w.host.signals).toEqual([]);
  });

  it("reports none when every process changed since, and partial when only some could be stopped", async () => {
    const w = world();
    w.host.signalResult = () => "changed";
    expect(await w.actions.close({ threadId: "thr_a", ports: [owned] })).toEqual({ outcome: "none" });

    const two = world();
    two.host.machines.set("h1", {
      supported: true,
      listeners: [
        hostListener({ port: 5173, pid: 10, startedAt: 111, ownerThreadId: "thr_a" }),
        hostListener({ port: 5174, pid: 11, startedAt: 112, ownerThreadId: "thr_a" }),
      ],
    });
    two.host.signalResult = (signal) => (signal.port === 5173 ? "sent" : "failed");
    expect(await two.actions.close({ threadId: "thr_a", ports: [owned, { port: 5174, pid: 11, startedAt: 112 }] })).toEqual({ outcome: "partial" });
  });

  it("rejects when the lookup fails or the call throws", async () => {
    const offline = world({ machines: { h1: new Error("offline") } });
    await expect(offline.actions.close({ threadId: "thr_a", ports: [owned] })).rejects.toThrow();
    const throwing = world();
    throwing.host.signalResult = () => new Error("worker exited");
    await expect(throwing.actions.close({ threadId: "thr_a", ports: [owned] })).rejects.toThrow("worker exited");
  });
});
