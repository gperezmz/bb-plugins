import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeFile, readClaudeSession } from "../../src/host/claude.js";
import { locateCodexSessions, parseCodexFile } from "../../src/host/codex.js";
import { resolveRoots } from "../../src/host/files.js";
import { parsePiFile, readPiSession } from "../../src/host/pi.js";

const logs = join(import.meta.dirname, "..", "fixtures", "logs");
const claudeRoot = join(logs, "claude", "projects");
const piRoot = join(logs, "pi", "sessions");
const codexRoot = join(logs, "codex", "sessions");
const open = { sinceMs: null, untilMs: null };
const signal = new AbortController().signal;
const ms = (iso: string) => Date.parse(iso);

describe("claude", () => {
  const main = join(claudeRoot, "-tmp-demo", "claude-sess-1.jsonl");

  it("keeps the last line of a multi-line response and skips synthetic/usage-less lines", async () => {
    const entries = await parseClaudeFile(main, "claude-sess-1", null, open, signal);
    expect(entries.map((e) => e.key)).toEqual(["msg_A:req_A", "msg_B:req_B", "msg_C:req_C"]);
    expect(entries[0]).toEqual({
      key: "msg_A:req_A",
      sessionId: "claude-sess-1",
      agentId: null,
      ts: ms("2026-01-01T10:00:01.400Z"),
      model: "claude-sonnet-5",
      tokens: { input: 2, output: 80, cacheRead: 0, cacheWrite: 1000, cacheWrite1h: 1000, reasoning: 3 },
      costUsd: null,
    });
    expect(entries[1]!.tokens).toEqual({
      input: 1, output: 50, cacheRead: 1000, cacheWrite: 200, cacheWrite1h: 0, reasoning: 0,
    });
  });

  it("applies a half-open time window", async () => {
    const entries = await parseClaudeFile(
      main,
      "claude-sess-1",
      null,
      { sinceMs: ms("2026-01-01T10:00:05.000Z"), untilMs: ms("2026-01-01T11:00:00.000Z") },
      signal,
    );
    expect(entries.map((e) => e.key)).toEqual(["msg_B:req_B"]);
  });

  it("finds subagent files and takes the agent id from the filename", async () => {
    const withSubs = await readClaudeSession([claudeRoot], "claude-sess-1", true, open, signal);
    expect(withSubs.found).toBe(true);
    const subs = withSubs.entries.filter((e) => e.agentId !== null);
    expect(subs.map((e) => [e.key, e.agentId])).toEqual([
      ["msg_X:req_X", "a1b2c3"],
      ["msg_Y:req_Y", "a1b2c3"],
    ]);
    const without = await readClaudeSession([claudeRoot], "claude-sess-1", false, open, signal);
    expect(without.entries.every((e) => e.agentId === null)).toBe(true);
    expect(without.entries).toHaveLength(3);
  });

  it("reports a missing session as not found", async () => {
    expect(await readClaudeSession([claudeRoot], "nope", true, open, signal)).toEqual({
      found: false,
      entries: [],
    });
  });

  it("treats a missing file as empty", async () => {
    expect(await parseClaudeFile(join(logs, "gone.jsonl"), "s", null, open, signal)).toEqual([]);
  });

  it("aborts a scan", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(parseClaudeFile(main, "claude-sess-1", null, open, ac.signal)).rejects.toThrow();
  });
});

describe("pi", () => {
  it("maps usage and cost, skips zero-usage turns, keeps 0 cost as 0", async () => {
    const { found, entries } = await readPiSession([piRoot], "pi-sess-1", open, signal);
    expect(found).toBe(true);
    expect(entries.map((e) => [e.key, e.model, e.costUsd])).toEqual([
      ["p1", "model-a", 0.0123],
      ["p2", "model-b", 0],
      ["p4", "model-a", null],
    ]);
    expect(entries[0]!.tokens).toEqual({
      input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cacheWrite1h: 15, reasoning: 5,
    });
    expect(entries[0]!.ts).toBe(ms("2026-01-01T09:00:02.000Z"));
    expect(entries[0]!.agentId).toBeNull();
  });

  it("filters by window", async () => {
    const file = join(piRoot, "--tmp-demo--", "2026-01-01T09-00-00-000Z_pi-sess-1.jsonl");
    const entries = await parsePiFile(
      file, "pi-sess-1", { sinceMs: null, untilMs: ms("2026-01-01T09:00:03.000Z") }, signal,
    );
    expect(entries.map((e) => e.key)).toEqual(["p1"]);
  });

  it("does not match a session id that is only a suffix of another", async () => {
    expect((await readPiSession([piRoot], "sess-1", open, signal)).found).toBe(false);
  });
});

describe("codex", () => {
  it("subtracts cached tokens from input, tracks the model, drops repeated events", async () => {
    const files = await locateCodexSessions([codexRoot], ["codex-sess-1", "nope"], signal);
    expect(files.get("nope")).toEqual([]);
    const [file] = files.get("codex-sess-1")!;
    const entries = await parseCodexFile(file!, "codex-sess-1", open, signal);
    expect(entries.map((e) => [e.model, e.ts])).toEqual([
      ["model-x", ms("2026-01-02T08:00:03.000Z")],
      ["model-y", ms("2026-01-02T08:00:05.000Z")],
    ]);
    expect(entries[0]!.tokens).toEqual({
      input: 400, output: 100, cacheRead: 600, cacheWrite: 0, cacheWrite1h: 0, reasoning: 40,
    });
    expect(entries[1]!.tokens).toEqual({
      input: 200, output: 50, cacheRead: 1500, cacheWrite: 300, cacheWrite1h: 0, reasoning: 0,
    });
    expect(new Set(entries.map((e) => e.key)).size).toBe(2);
  });
});

describe("resolveRoots", () => {
  it("honours the harnesses' own env overrides", () => {
    const roots = resolveRoots(
      { CLAUDE_CONFIG_DIR: "/c", PI_CODING_AGENT_DIR: "/p", CODEX_HOME: "/x", BB_DATA_DIR: "/b" },
      "/home/u",
    );
    expect(roots).toEqual({
      claude: ["/c/projects"],
      pi: ["/p/sessions"],
      piBridge: ["/b/pi-bridge-sessions"],
      codex: ["/x/sessions"],
    });
  });

  it("defaults under the home directory", () => {
    const roots = resolveRoots({}, "/home/u");
    expect(roots.claude).toEqual(["/home/u/.config/claude/projects", "/home/u/.claude/projects"]);
    expect(roots.pi).toEqual(["/home/u/.pi/agent/sessions"]);
    expect(roots.piBridge).toEqual(["/home/u/.bb/pi-bridge-sessions"]);
    expect(roots.codex).toEqual(["/home/u/.codex/sessions"]);
  });
});
