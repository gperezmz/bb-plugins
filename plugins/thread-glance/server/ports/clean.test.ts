import { describe, expect, it } from "vitest";
import { CLEAN_NOTHING_TEXT } from "../../shared/ports";
import { settledRow } from "../../shared/lifecycle";
import { makeServerThread, terminal } from "../testing/fakes";
import { MAX_STORED_PREVIEWS, PREVIEW_TTL_MS } from "./preview-store";
import { SETTLE_WAIT_MS } from "./clean";
import { createPortsWorld, settled, SETTLED_AT, type PortsWorld } from "./testing/world";
import { hostListener } from "./testing/fakes";

const SETTLED_ROW = settledRow(SETTLED_AT, "manual");

/** Two settled threads in their own environments, each with a terminal and an owned port, and an active thread in a third. */
function world(overrides: Parameters<typeof createPortsWorld>[0] = {}) {
  return createPortsWorld({
    threads: [settled("thr_a", "env-a", { title: "Alpha" }), settled("thr_b", "env-b", { title: "Beta", projectId: "project-2" }), settled("thr_c", "env-c", { title: "Gamma" })],
    rows: { thr_a: SETTLED_ROW, thr_b: SETTLED_ROW },
    locations: {
      "env-a": { hostId: "h1", path: "/work/a" },
      "env-b": { hostId: "h1", path: "/work/b" },
      "env-c": { hostId: "h1", path: "/work/c" },
    },
    machines: {
      h1: [
        hostListener({ port: 5173, pid: 10, startedAt: 111, workspace: "/work/a", ownerThreadId: "thr_a", process: "vite" }),
        hostListener({ port: 4000, pid: 20, startedAt: 222, workspace: "/work/b", ownerThreadId: "thr_b" }),
        hostListener({ port: 3000, pid: 30, startedAt: 333, workspace: "/work/c", ownerThreadId: "thr_c" }),
      ],
    },
    terminals: { thr_a: [terminal("t-a1"), terminal("t-a2", { lastUserInputAt: 5 }), terminal("t-a3", { status: "exited" })], thr_b: [terminal("t-b1")] },
    ...overrides,
  });
}

const idsIn = (preview: { threads: { threadId: string }[] }) => preview.threads.map((thread) => thread.threadId);

describe("previewClean (AC8)", () => {
  it("lists the settled threads' live terminals, typed into or not, and their owned ports with a process", async () => {
    const w = world();
    const preview = await w.clean.preview([]);
    expect(preview.token).toBe("token-1");
    expect(preview.expiresAt).toBe(w.clock.now + PREVIEW_TTL_MS);
    expect(preview.threads).toEqual([
      { threadId: "thr_a", title: "Alpha", terminals: 2, ports: [{ port: 5173, process: "vite" }] },
      { threadId: "thr_b", title: "Beta", terminals: 1, ports: [{ port: 4000, process: "node" }] },
    ]);
  });

  it("returns only threads that have something to close", async () => {
    const w = world({ terminals: {}, machines: { h1: [] } });
    expect((await w.clean.preview([])).threads).toEqual([]);
    expect(CLEAN_NOTHING_TEXT).toMatch(/No live terminals/);
  });

  it("limits the preview to the projects in scope", async () => {
    const w = world();
    expect(idsIn(await w.clean.preview(["project-2"]))).toEqual(["thr_b"]);
    expect(idsIn(await w.clean.preview(["project-1"]))).toEqual(["thr_a"]);
    expect(idsIn(await w.clean.preview(["project-1", "project-2"]))).toEqual(["thr_a", "thr_b"]);
  });

  it("leaves out an owned port that has no start time, and ports another thread owns", async () => {
    const w = world();
    w.host.machines.set("h1", {
      supported: true,
      listeners: [
        hostListener({ port: 8080, pid: null, startedAt: null, process: null, workspace: "/work/a", ownerThreadId: "thr_a", container: "web" }),
        hostListener({ port: 9000, pid: 90, startedAt: 9, workspace: "/work/a", ownerThreadId: null }),
      ],
    });
    expect(await w.clean.preview([])).toMatchObject({ threads: [{ threadId: "thr_a", ports: [] }, { threadId: "thr_b" }] });
  });

  describe("silently leaves out", () => {
    it.each([
      ["a pinned thread", { isPinned: true, pinnedAt: 1 }],
      ["a busy thread", { status: "active", runtimeStatus: "active" }],
      ["a thread with attention since it settled", { latestAttentionAt: SETTLED_AT + 1 }],
      ["a hidden thread", { hidden: true }],
    ] as const)("%s", async (_name, overrides) => {
      const w = world();
      w.threads.threads.set("thr_a", { ...w.threads.threads.get("thr_a")!, ...overrides });
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread with a question waiting below it, which lifts it off Settled", async () => {
      const w = world();
      w.threads.threads.set("thr_q", makeServerThread("thr_q", { parentThreadId: "thr_a", hasPendingInteraction: true }));
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread that is not settled", async () => {
      const w = world();
      w.lifecycle.putMany([["thr_a", null]]);
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread sharing its environment with a thread that fails the test", async () => {
      const w = world();
      w.threads.threads.set("thr_x", settled("thr_x", "env-a", { title: "Active neighbour" }));
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread sharing a path on the same machine with a thread in another environment that fails", async () => {
      const w = world();
      w.environments.locations.set("env-x", { hostId: "h1", path: "/work/a/" });
      w.threads.threads.set("thr_x", settled("thr_x", "env-x"));
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread sharing a workspace with a failing thread outside the project in scope, or a hidden one", async () => {
      const w = world();
      w.threads.threads.set("thr_x", settled("thr_x", "env-b", { projectId: "project-9" }));
      expect(idsIn(await w.clean.preview(["project-1"]))).toEqual(["thr_a"]);
      w.threads.threads.delete("thr_x");
      w.threads.threads.set("thr_h", settled("thr_h", "env-a", { hidden: true }));
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
    });

    it("a thread whose workspace cannot be resolved", async () => {
      const w = world();
      w.environments.locations.delete("env-a");
      w.threads.threads.set("thr_b", { ...w.threads.threads.get("thr_b")!, environmentId: null });
      expect(idsIn(await w.clean.preview([]))).toEqual([]);
    });

    it("keeps two settled threads that share a workspace with each other", async () => {
      const w = world();
      w.threads.threads.set("thr_d", settled("thr_d", "env-a", { title: "Delta" }));
      w.lifecycle.putMany([["thr_d", SETTLED_ROW]]);
      w.runtime.terminalsByThread.set("thr_d", [terminal("t-d1")]);
      expect(idsIn(await w.clean.preview([]))).toEqual(["thr_a", "thr_b", "thr_d"]);
    });

    it("a thread archived elsewhere is not among the threads, so it does not block", async () => {
      const w = world();
      expect(idsIn(await w.clean.preview([]))).toContain("thr_a");
    });
  });

  it("leaves out a thread whose environment bb could not resolve, unlike the others", async () => {
    const w = world();
    w.environments.failIds.add("env-a");
    expect(idsIn(await w.clean.preview([]))).toEqual(["thr_b"]);
  });

  it("lists terminals only for a thread whose machine cannot be scanned, and records no issue yet", async () => {
    const w = world({ machines: { h1: new Error("offline") } });
    const preview = await w.clean.preview([]);
    expect(preview.threads.map((thread) => [thread.threadId, thread.terminals, thread.ports])).toEqual([
      ["thr_a", 2, []],
      ["thr_b", 1, []],
    ]);
  });
});

describe("runClean (AC8)", () => {
  async function run(w: PortsWorld, projectIds: readonly string[] = []) {
    const preview = await w.clean.preview(projectIds);
    return w.clean.run(preview.token);
  }

  it("force-closes every live terminal, signals each owned port, waits 750 ms and reports", async () => {
    const w = world();
    w.host.signalResult = (signal) => {
      w.host.machines.set("h1", {
        supported: true,
        listeners: (w.host.machines.get("h1") as { listeners: ReturnType<typeof hostListener>[] }).listeners.filter((listener) => listener.port !== signal.port),
      });
      return "sent";
    };
    const result = await run(w);
    expect(result).toEqual({ expired: false, closedTerminals: 3, portRequests: 2, stillListening: [], issues: [] });
    expect(w.runtime.forceClosed).toEqual(["t-a1", "t-a2", "t-b1"]);
    expect(w.runtime.closed).toEqual([]);
    expect(w.host.signals.map((signal) => [signal.hostId, signal.port, signal.pid, signal.startedAt, signal.workspaces])).toEqual([
      ["h1", 5173, 10, 111, ["/work/a"]],
      ["h1", 4000, 20, 222, ["/work/b"]],
    ]);
    expect(w.waits).toEqual([SETTLE_WAIT_MS]);
  });

  it("reports a port that still listens after the request, from a new read", async () => {
    const w = world();
    const preview = await w.clean.preview([]);
    const scans = w.host.scans.length;
    // The processes ignore SIGTERM: the re-read still finds them.
    expect(await w.clean.run(preview.token)).toMatchObject({ portRequests: 2, stillListening: [4000, 5173] });
    expect(w.host.scans.length).toBeGreaterThan(scans);
  });

  it("leaves every thread on the Settled shelf", async () => {
    const w = world();
    await run(w);
    expect(w.lifecycle.get("thr_a")).toEqual(SETTLED_ROW);
    expect(w.lifecycle.get("thr_b")).toEqual(SETTLED_ROW);
    expect(w.runtime.stopped).toEqual([]);
  });

  it("answers expired for a preview 3 minutes old, and the next press for the same token too", async () => {
    const w = world();
    const preview = await w.clean.preview([]);
    w.clock.advance(3 * 60_000);
    const expired = { expired: true, closedTerminals: 0, portRequests: 0, stillListening: [], issues: [] };
    expect(await w.clean.run(preview.token)).toEqual(expired);
    expect(w.runtime.forceClosed).toEqual([]);
    expect(w.host.signals).toEqual([]);
    w.clock.advance(-3 * 60_000);
    expect(await w.clean.run(preview.token)).toEqual(expired);
  });

  it("answers expired for an unknown token", async () => {
    expect((await world().clean.run("nope")).expired).toBe(true);
  });

  it("runs a preview once", async () => {
    const w = world();
    const preview = await w.clean.preview([]);
    expect((await w.clean.run(preview.token)).expired).toBe(false);
    expect((await w.clean.run(preview.token)).expired).toBe(true);
  });

  it("runs a preview after a restart, from the plugin's database", async () => {
    const w = world();
    const preview = await w.clean.preview([]);
    const result = await w.restartedClean().run(preview.token);
    expect(result).toMatchObject({ expired: false, closedTerminals: 3, portRequests: 2 });
  });

  it("keeps a bounded number of previews, the newest", async () => {
    const w = world();
    const tokens: string[] = [];
    for (let index = 0; index < MAX_STORED_PREVIEWS + 2; index++) {
      tokens.push((await w.clean.preview([])).token);
      w.clock.advance(1);
    }
    expect((await w.clean.run(tokens[0])).expired).toBe(true);
    expect((await w.clean.run(tokens.at(-1)!)).expired).toBe(false);
  });

  it("stores nothing but ids, titles, terminal ids and port targets", async () => {
    const w = world();
    await w.clean.preview([]);
    const rows = w.db.prepare("SELECT token, data FROM clean_previews").all() as { token: string; data: string }[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(JSON.parse(rows[0].data))).toEqual(["threads"]);
  });

  describe("checks again before each terminal and port", () => {
    it("skips a thread that is no longer settled, naming it, and closes nothing of it", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.lifecycle.putMany([["thr_a", null]]);
      const result = await w.clean.run(preview.token);
      expect(result.issues).toEqual([{ threadId: "thr_a", title: "Alpha", text: "skipped, it is no longer settled or its workspace is shared" }]);
      expect(result.closedTerminals).toBe(1);
      expect(result.portRequests).toBe(1);
      expect(w.runtime.forceClosed).toEqual(["t-b1"]);
      expect(w.host.signals.map((signal) => signal.port)).toEqual([4000]);
    });

    it("stops mid-thread when it is un-settled between two terminals", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.runtime.onCall = (call) => {
        if (call === "force t-a1") w.lifecycle.putMany([["thr_a", null]]);
      };
      const result = await w.clean.run(preview.token);
      expect(w.runtime.forceClosed).toEqual(["t-a1", "t-b1"]);
      expect(result.issues).toEqual([{ threadId: "thr_a", title: "Alpha", text: "skipped, it is no longer settled or its workspace is shared" }]);
      expect(w.host.signals.map((signal) => signal.port)).toEqual([4000]);
    });

    it("skips a thread that became busy or whose workspace is now shared with an active thread", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.threads.threads.set("thr_a", { ...w.threads.threads.get("thr_a")!, status: "active", runtimeStatus: "active" });
      w.threads.threads.set("thr_x", settled("thr_x", "env-b", { title: "Newcomer" }));
      const result = await w.clean.run(preview.token);
      expect(result.issues.sort()).toEqual([
        { threadId: "thr_a", title: "Alpha", text: "skipped, it is no longer settled or its workspace is shared" },
        { threadId: "thr_b", title: "Beta", text: "skipped, it is no longer settled or its workspace is shared" },
      ]);
      expect(w.runtime.forceClosed).toEqual([]);
      expect(w.host.signals).toEqual([]);
    });

    it("does not signal a port the thread no longer owns, or a process the host finds changed", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.host.machines.set("h1", {
        supported: true,
        listeners: [hostListener({ port: 5173, pid: 99, startedAt: 999, workspace: "/work/a", ownerThreadId: "thr_a" }), hostListener({ port: 4000, pid: 20, startedAt: 222, workspace: "/work/b", ownerThreadId: "thr_b" })],
      });
      w.clock.advance(60_000);
      w.host.signalResult = () => "changed";
      const result = await w.clean.run(preview.token);
      expect(result.portRequests).toBe(0);
      expect(w.host.signals.map((signal) => signal.port)).toEqual([4000]);
      expect(result.issues).toEqual([]);
    });

    describe("a thread with owned ports", () => {
      /** Thread A has two ports and no terminal. */
      const portsOnly = () => world({ terminals: {} });
      const skip = { threadId: "thr_a", title: "Alpha", text: "skipped, it is no longer settled or its workspace is shared" };

      it("is not signalled when it is un-settled after the preview", async () => {
        const w = portsOnly();
        const preview = await w.clean.preview(["project-1"]);
        w.lifecycle.putMany([["thr_a", null]]);
        const result = await w.clean.run(preview.token);
        expect(result).toMatchObject({ portRequests: 0, issues: [skip] });
        expect(w.host.signals).toEqual([]);
      });

      it("is not signalled when an active thread now works in its workspace", async () => {
        const w = portsOnly();
        const preview = await w.clean.preview(["project-1"]);
        w.threads.threads.set("thr_x", settled("thr_x", "env-a", { status: "active", runtimeStatus: "active" }));
        const result = await w.clean.run(preview.token);
        expect(result).toMatchObject({ portRequests: 0, issues: [skip] });
        expect(w.host.signals).toEqual([]);
      });

      it("is not signalled when it is un-settled while its last terminal closes: the re-check before the port stops it", async () => {
        const w = world({ terminals: { thr_a: [terminal("t-a1")] } });
        const preview = await w.clean.preview(["project-1"]);
        w.runtime.onCall = (call) => {
          if (call === "force t-a1") w.lifecycle.putMany([["thr_a", null]]);
        };
        const result = await w.clean.run(preview.token);
        expect(w.runtime.forceClosed).toEqual(["t-a1"]);
        expect(result).toMatchObject({ closedTerminals: 1, portRequests: 0, issues: [skip] });
        expect(w.host.signals).toEqual([]);
      });
    });

    it("signals a process serving two ports once, and reports both ports while it listens", async () => {
      const w = world({ terminals: {} });
      w.host.machines.set("h1", {
        supported: true,
        listeners: [
          hostListener({ port: 5173, pid: 10, startedAt: 111, workspace: "/work/a", ownerThreadId: "thr_a" }),
          hostListener({ port: 24678, pid: 10, startedAt: 111, workspace: "/work/a", ownerThreadId: "thr_a" }),
        ],
      });
      const preview = await w.clean.preview([]);
      expect(preview.threads[0].ports.map((port) => port.port)).toEqual([5173, 24678]);
      const result = await w.clean.run(preview.token);
      expect(result).toMatchObject({ portRequests: 1, stillListening: [5173, 24678] });
      expect(w.host.signals).toHaveLength(1);
    });

    it("skips a terminal bb no longer lists as live", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.runtime.terminalsByThread.set("thr_a", [terminal("t-a1", { status: "exited" })]);
      const result = await w.clean.run(preview.token);
      expect(w.runtime.forceClosed).toEqual(["t-b1"]);
      expect(result.closedTerminals).toBe(1);
    });
  });

  describe("issues name the thread", () => {
    it("a terminal bb would not close", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.runtime.closeForce = async () => false;
      expect((await w.clean.run(preview.token)).issues).toContainEqual({ threadId: "thr_a", title: "Alpha", text: "a terminal could not be closed" });
    });

    it("a port that could not be stopped", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.host.signalResult = (signal) => (signal.port === 4000 ? "failed" : "sent");
      const result = await w.clean.run(preview.token);
      expect(result.issues).toEqual([{ threadId: "thr_b", title: "Beta", text: "port 4000 could not be stopped" }]);
      expect(result.portRequests).toBe(1);
    });

    it("a machine that cannot be scanned when the preview runs", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      w.clock.advance(60_000);
      w.host.machines.set("h1", new Error("offline"));
      const result = await w.clean.run(preview.token);
      expect(result.issues).toEqual([{ threadId: "thr_a", title: "Alpha", text: "its ports could not be checked" }, { threadId: "thr_b", title: "Beta", text: "its ports could not be checked" }]);
      expect(result.closedTerminals).toBe(3);
      expect(w.host.signals).toEqual([]);
    });

    it("a thread whose cleaning threw, without ending the rest", async () => {
      const w = world();
      const preview = await w.clean.preview([]);
      const original = w.runtime.terminal.bind(w.runtime);
      w.runtime.terminal = async (id) => {
        if (id === "t-a1") throw new Error("bb down");
        return original(id);
      };
      const result = await w.clean.run(preview.token);
      expect(result.issues).toEqual([{ threadId: "thr_a", title: "Alpha", text: "could not be cleaned" }]);
      expect(w.runtime.forceClosed).toEqual(["t-b1"]);
    });
  });
});
