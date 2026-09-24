import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import { hostContract } from "../../src/host/contract.js";
import { createHandlers } from "../../src/host/handlers.js";

const logs = join(import.meta.dirname, "..", "fixtures", "logs");
// `@get-bb/plugin-sdk/host` (0.5.9) cannot be imported by native ESM, so the
// entry object that `experimental_defineHostEntry` builds is written out here.
const entry = (roots = {
  claude: [join(logs, "claude", "projects")],
  pi: [join(logs, "pi", "sessions")],
  piBridge: [join(logs, "pi-bridge-sessions")],
  codex: [join(logs, "codex", "sessions")],
}) =>
  experimental_createHostEntryHarness(
    {
      experimental_apiVersion: 1,
      contract: hostContract,
      handlers: createHandlers(roots, "/home/demo"),
    },
  );

const base = { sinceMs: null, untilMs: null, includeSubagents: true, offset: 0, limit: 100 };

describe("probe", () => {
  it("reports which harness log roots exist", async () => {
    const h = entry();
    expect(await h.experimental_call("probe", null)).toEqual({
      home: "/home/demo",
      harnesses: { "claude-code": true, pi: true, codex: true },
    });
    const empty = entry({ claude: [join(logs, "x")], pi: [join(logs, "y")], piBridge: [], codex: [logs] });
    expect((await empty.experimental_call("probe", null)).harnesses).toEqual({
      "claude-code": false, pi: false, codex: true,
    });
  });
});

describe("readSessionLogs", () => {
  it("returns entries in ts order across main and subagent files", async () => {
    const out = await entry().experimental_call("readSessionLogs", {
      ...base, harness: "claude-code", sessionIds: ["claude-sess-1", "missing"],
    });
    expect(out.entries.map((e) => e.key)).toEqual([
      "msg_A:req_A", "msg_X:req_X", "msg_Y:req_Y", "msg_B:req_B", "msg_C:req_C",
    ]);
    expect(out.sessionsFound).toEqual(["claude-sess-1"]);
    expect(out.nextOffset).toBeNull();
  });

  it("excludes subagents when asked", async () => {
    const out = await entry().experimental_call("readSessionLogs", {
      ...base, harness: "claude-code", sessionIds: ["claude-sess-1"], includeSubagents: false,
    });
    expect(out.entries.map((e) => e.key)).toEqual(["msg_A:req_A", "msg_B:req_B", "msg_C:req_C"]);
  });

  it("pages stably with offset and limit", async () => {
    const h = entry();
    const keys: string[] = [];
    let offset = 0;
    for (let guard = 0; guard < 10; guard++) {
      const out = await h.experimental_call("readSessionLogs", {
        ...base, harness: "claude-code", sessionIds: ["claude-sess-1"], offset, limit: 2,
      });
      keys.push(...out.entries.map((e) => e.key));
      if (out.nextOffset === null) break;
      offset = out.nextOffset;
    }
    expect(keys).toEqual(["msg_A:req_A", "msg_X:req_X", "msg_Y:req_Y", "msg_B:req_B", "msg_C:req_C"]);
  });

  it("reads pi and codex sessions", async () => {
    const h = entry();
    const pi = await h.experimental_call("readSessionLogs", {
      ...base, harness: "pi", sessionIds: ["pi-sess-1"],
    });
    expect(pi.entries).toHaveLength(3);
    expect(pi.sessionsFound).toEqual(["pi-sess-1"]);
    const codex = await h.experimental_call("readSessionLogs", {
      ...base, harness: "codex", sessionIds: ["codex-sess-1"],
    });
    expect(codex.entries).toHaveLength(2);
    expect(codex.sessionsFound).toEqual(["codex-sess-1"]);
  });

  it("never lets a session id escape the log root", async () => {
    const out = await entry().experimental_call("readSessionLogs", {
      ...base, harness: "pi", sessionIds: ["../../claude/projects/-tmp-demo/claude-sess-1"],
    });
    expect(out).toEqual({ entries: [], nextOffset: null, sessionsFound: [] });
  });

  it("aborts when the caller's signal fires", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      entry().experimental_call(
        "readSessionLogs",
        { ...base, harness: "claude-code", sessionIds: ["claude-sess-1"] },
        { signal: ac.signal },
      ),
    ).rejects.toThrow();
  });
});

describe("bb's pi bridge sessions", () => {
  it("finds a session by bb's providerThreadId file name", async () => {
    const h = entry();
    const out = await h.experimental_call("readSessionLogs", {
      ...base, harness: "pi", sessionIds: ["pi_bridge-1"],
    });
    expect(out.sessionsFound).toEqual(["pi_bridge-1"]);
    expect(out.entries.length).toBeGreaterThan(0);
    expect(out.entries.every((e) => e.sessionId === "pi_bridge-1")).toBe(true);
  });
});
