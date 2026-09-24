import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateClaudeSession, parseClaudeFile, readClaudeSession } from "../../src/host/claude.js";
import { LOCATION_TTL_MS, LogCache } from "../../src/host/log-cache.js";
import { parsePiFile } from "../../src/host/pi.js";

const open = { sinceMs: null, untilMs: null };
const signal = new AbortController().signal;

/** One Claude Code assistant line; `out` output tokens. */
const claudeLine = (id: string, out: number, at = "2026-06-01T10:00:00Z") =>
  `${JSON.stringify({
    type: "assistant",
    timestamp: at,
    requestId: `req_${id}`,
    message: { id: `msg_${id}`, model: "claude-x", usage: { input_tokens: 10, output_tokens: out } },
  })}\n`;
const piLine = (id: string, out: number) =>
  `${JSON.stringify({
    type: "message",
    id,
    timestamp: "2026-06-01T10:00:00Z",
    message: { role: "assistant", model: "pi-x", usage: { input: 1, output: out, cost: { total: 0.01 } } },
  })}\n`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tu-cache-"));
  const file = join(dir, "sess.jsonl");
  const cacheDir = join(dir, "cache");
  return { dir, file, cacheDir, cache: new LogCache(cacheDir) };
}

const outputs = (entries: { key: string; tokens: { output: number } }[]) =>
  Object.fromEntries(entries.map((e) => [e.key, e.tokens.output]));

describe("incremental log reads", () => {
  it("reads only the bytes appended since the last read, with the same entries as a full read", async () => {
    const { file, cache } = setup();
    writeFileSync(file, claudeLine("a", 1) + claudeLine("b", 2));
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({ "msg_a:req_a": 1, "msg_b:req_b": 2 });
    const firstBytes = cache.stats.bytesRead;
    // A streamed response repeats its key; the last line wins, as in a full read.
    appendFileSync(file, claudeLine("b", 5) + claudeLine("c", 3));
    const incremental = await parseClaudeFile(file, "s", null, open, signal, cache);
    expect(cache.stats.bytesRead - firstBytes).toBe(claudeLine("b", 5).length + claudeLine("c", 3).length);
    expect(outputs(incremental)).toEqual({ "msg_a:req_a": 1, "msg_b:req_b": 5, "msg_c:req_c": 3 });
    expect(incremental).toEqual(await parseClaudeFile(file, "s", null, open, signal));
    // Nothing appended: nothing read.
    const bytes = cache.stats.bytesRead;
    await parseClaudeFile(file, "s", null, open, signal, cache);
    expect(cache.stats.bytesRead).toBe(bytes);
  });

  it("counts a last line without its newline when it parses, and reads it again once finished", async () => {
    const { file, cache } = setup();
    const done = claudeLine("a", 1);
    const partial = claudeLine("b", 2);
    writeFileSync(file, done + partial.slice(0, 40));
    expect(Object.keys(outputs(await parseClaudeFile(file, "s", null, open, signal, cache)))).toEqual(["msg_a:req_a"]);
    appendFileSync(file, partial.slice(40, -1));
    // Complete but unterminated: counted, as a full read would.
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({ "msg_a:req_a": 1, "msg_b:req_b": 2 });
    appendFileSync(file, "\n" + claudeLine("c", 3));
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({
      "msg_a:req_a": 1,
      "msg_b:req_b": 2,
      "msg_c:req_c": 3,
    });
  });

  it("reads a truncated, replaced or rewritten file again from the start", async () => {
    const { dir, file, cache } = setup();
    writeFileSync(file, claudeLine("a", 1) + claudeLine("b", 2));
    await parseClaudeFile(file, "s", null, open, signal, cache);
    // Truncated to something shorter.
    writeFileSync(file, claudeLine("z", 9));
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({ "msg_z:req_z": 9 });
    // Rewritten in place with other lines of the same length, then grown.
    writeFileSync(file, claudeLine("y", 8) + claudeLine("x", 7));
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({ "msg_y:req_y": 8, "msg_x:req_x": 7 });
    // Replaced by another file (new inode) that starts with the same bytes.
    const other = join(dir, "other.jsonl");
    writeFileSync(other, claudeLine("y", 8) + claudeLine("x", 7) + claudeLine("w", 6));
    renameSync(other, file);
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({
      "msg_y:req_y": 8,
      "msg_x:req_x": 7,
      "msg_w:req_w": 6,
    });
    expect(cache.stats.fullReads).toBe(4);
  });

  it("keeps its state across workers in the data directory", async () => {
    const { file, cacheDir } = setup();
    writeFileSync(file, claudeLine("a", 1));
    await parseClaudeFile(file, "s", null, open, signal, new LogCache(cacheDir));
    appendFileSync(file, claudeLine("b", 2));
    const next = new LogCache(cacheDir);
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, next))).toEqual({ "msg_a:req_a": 1, "msg_b:req_b": 2 });
    expect(next.stats.fullReads).toBe(0);
    expect(next.stats.bytesRead).toBe(claudeLine("b", 2).length);
  });

  it("keeps a file read for another session or agent apart", async () => {
    const { file, cache } = setup();
    writeFileSync(file, claudeLine("a", 1));
    const main = await parseClaudeFile(file, "s", null, open, signal, cache);
    const sub = await parseClaudeFile(file, "s", "agent-1", open, signal, cache);
    expect(main[0]!.agentId).toBeNull();
    expect(sub[0]!.agentId).toBe("agent-1");
  });

  it("keeps every pi entry (no dedup), incrementally", async () => {
    const { file, cache } = setup();
    writeFileSync(file, piLine("m1", 1));
    await parsePiFile(file, "p", open, signal, cache);
    appendFileSync(file, piLine("m2", 2));
    const entries = await parsePiFile(file, "p", open, signal, cache);
    expect(entries.map((e) => e.key)).toEqual(["m1", "m2"]);
    expect(entries).toEqual(await parsePiFile(file, "p", open, signal));
  });

  it("filters by window after reading, so a narrower window loses nothing later", async () => {
    const { file, cache } = setup();
    writeFileSync(file, claudeLine("a", 1, "2026-06-01T10:00:00Z") + claudeLine("b", 2, "2026-06-01T12:00:00Z"));
    const late = { sinceMs: Date.parse("2026-06-01T11:00:00Z"), untilMs: null };
    expect(Object.keys(outputs(await parseClaudeFile(file, "s", null, late, signal, cache)))).toEqual(["msg_b:req_b"]);
    expect(Object.keys(outputs(await parseClaudeFile(file, "s", null, open, signal, cache)))).toEqual(["msg_a:req_a", "msg_b:req_b"]);
  });
});

describe("where a Claude Code session's files are", () => {
  it("is remembered, and searched again when the files moved or the memory is an hour old", async () => {
    const { dir } = setup();
    const root = join(dir, "projects");
    for (const p of ["p1", "p2", "p3"]) mkdirSync(join(root, p), { recursive: true });
    writeFileSync(join(root, "p2", "sess.jsonl"), claudeLine("a", 1));
    const clock = { now: 0 };
    const cache = new LogCache(join(dir, "cache"), () => clock.now);
    expect((await locateClaudeSession([root], "sess", cache)).main).toEqual([join(root, "p2", "sess.jsonl")]);
    expect(await cache.location("sess")).toEqual({ dirs: [join(root, "p2")], appeared: [], fresh: true });
    // Moved: the remembered directory is empty, so every project is searched.
    renameSync(join(root, "p2", "sess.jsonl"), join(root, "p3", "sess.jsonl"));
    expect((await locateClaudeSession([root], "sess", cache)).main).toEqual([join(root, "p3", "sess.jsonl")]);
    // A second copy appears elsewhere: found once the memory is an hour old.
    writeFileSync(join(root, "p1", "sess.jsonl"), claudeLine("b", 1));
    expect((await locateClaudeSession([root], "sess", cache)).main).toHaveLength(1);
    clock.now += LOCATION_TTL_MS;
    expect((await locateClaudeSession([root], "sess", cache)).main).toHaveLength(2);
  });

  it("remembers a session found nowhere for as long, then searches again", async () => {
    const { dir } = setup();
    const root = join(dir, "projects");
    mkdirSync(join(root, "p1"), { recursive: true });
    const clock = { now: 0 };
    const cache = new LogCache(join(dir, "cache"), () => clock.now);
    expect(await locateClaudeSession([root], "later", cache)).toMatchObject({ main: [], subagents: [] });
    writeFileSync(join(root, "p1", "later.jsonl"), claudeLine("a", 1));
    expect((await locateClaudeSession([root], "later", cache)).main).toHaveLength(0);
    // Under the server's 10-minute overlap: the first entry is still asked for.
    expect(LOCATION_TTL_MS).toBeLessThan(10 * 60_000);
    clock.now += LOCATION_TTL_MS;
    expect((await locateClaudeSession([root], "later", cache)).main).toHaveLength(1);
  });
});

describe("the cache's own upkeep", () => {
  it("never fails a read because its directory is unusable", async () => {
    const { dir, file } = setup();
    const notADir = join(dir, "plain-file");
    writeFileSync(notADir, "x");
    const cache = new LogCache(join(notADir, "cache"));
    writeFileSync(file, claudeLine("a", 1));
    expect(outputs(await parseClaudeFile(file, "s", null, open, signal, cache))).toEqual({ "msg_a:req_a": 1 });
    expect(await parseClaudeFile(join(dir, "gone.jsonl"), "s", null, open, signal, cache)).toEqual([]);
  });

  it("deletes states unused for 30 days, once a day, and keeps the rest", async () => {
    const { dir, file, cacheDir } = setup();
    writeFileSync(file, claudeLine("a", 1));
    const other = join(dir, "other.jsonl");
    writeFileSync(other, claudeLine("b", 1));
    const day = 86_400_000;
    await parseClaudeFile(file, "s", null, open, signal, new LogCache(cacheDir, () => 40 * day));
    await parseClaudeFile(other, "s", null, open, signal, new LogCache(cacheDir, () => 40 * day));
    const states = () => readdirSync(cacheDir).filter((n) => n.endsWith(".json") && n !== "locations.json");
    expect(states()).toHaveLength(2);
    // The other file's state was last used 35 days before the next worker starts.
    const stale = states().find((n) => readFileSync(join(cacheDir, n), "utf8").includes("other.jsonl"))!;
    utimesSync(join(cacheDir, stale), new Date(5 * day), new Date(5 * day));
    writeFileSync(join(cacheDir, "pruned-at"), "0");
    const worker = new LogCache(cacheDir, () => 40 * day);
    await parseClaudeFile(file, "s", null, open, signal, worker);
    await worker.pruned();
    expect(states()).toHaveLength(1);
    expect(states()).not.toContain(stale);
    expect(existsSync(join(cacheDir, "pruned-at"))).toBe(true);
  });
});

describe("clock skew between this machine and the server", () => {
  it("reads a file that appeared while the location was trusted from its first entry, whatever the lower bound", async () => {
    const { dir } = setup();
    const root = join(dir, "projects");
    for (const p of ["p1", "p2"]) mkdirSync(join(root, p), { recursive: true });
    writeFileSync(join(root, "p1", "sess.jsonl"), claudeLine("a", 1, "2026-06-01T10:00:00Z"));
    const clock = { now: 0 };
    const cache = new LogCache(join(dir, "cache"), () => clock.now);
    await readClaudeSession([root], "sess", true, open, signal, cache);
    // A subagent file appears in another project directory, stamped by a clock 20 minutes behind.
    mkdirSync(join(root, "p2", "sess", "subagents"), { recursive: true });
    writeFileSync(join(root, "p2", "sess", "subagents", "agent-x.jsonl"), claudeLine("s", 4, "2026-06-01T10:40:00Z"));
    clock.now += LOCATION_TTL_MS;
    // The server asks from 10 minutes before its last read, by its own clock: 10:50.
    const bound = { sinceMs: Date.parse("2026-06-01T10:50:00Z"), untilMs: null };
    const { entries } = await readClaudeSession([root], "sess", true, bound, signal, cache);
    expect(entries.map((e) => e.key)).toEqual(["msg_s:req_s"]);
    // Every page of the same paged read (the location still trusted) sees it whole too.
    const page2 = await readClaudeSession([root], "sess", true, bound, signal, cache);
    expect(page2.entries.map((e) => e.key)).toEqual(["msg_s:req_s"]);
    // After the next search it is windowed like any other file.
    clock.now += LOCATION_TTL_MS;
    const again = await readClaudeSession([root], "sess", true, bound, signal, cache);
    expect(again.entries).toEqual([]);
  });

  it("prunes again after the clock was set back past its marker", async () => {
    const { file, cacheDir } = setup();
    const day = 86_400_000;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "pruned-at"), String(100 * day));
    const old = join(cacheDir, "0".repeat(40) + ".json");
    writeFileSync(old, "{}");
    utimesSync(old, new Date(day), new Date(day));
    writeFileSync(file, claudeLine("a", 1));
    const worker = new LogCache(cacheDir, () => 40 * day);
    await parseClaudeFile(file, "s", null, open, signal, worker);
    await worker.pruned();
    expect(existsSync(old)).toBe(false);
  });

  it("keeps explicit backfill windows as asked", async () => {
    const { dir } = setup();
    const root = join(dir, "projects");
    mkdirSync(join(root, "p1"), { recursive: true });
    const clock = { now: 0 };
    const cache = new LogCache(join(dir, "cache"), () => clock.now);
    await readClaudeSession([root], "late", true, open, signal, cache);
    writeFileSync(join(root, "p1", "late.jsonl"), claudeLine("a", 1, "2026-06-01T10:00:00Z"));
    clock.now += LOCATION_TTL_MS;
    const window = { sinceMs: Date.parse("2026-06-01T11:00:00Z"), untilMs: Date.parse("2026-06-01T12:00:00Z") };
    expect((await readClaudeSession([root], "late", true, window, signal, cache)).entries).toEqual([]);
  });
});

describe("pruning in a long-lived worker", () => {
  it("prunes again a day later, removes leftover temporary files, and keeps states it holds in memory", async () => {
    const { dir, file, cacheDir } = setup();
    const day = 86_400_000;
    const clock = { now: 40 * day };
    const cache = new LogCache(cacheDir, () => clock.now);
    writeFileSync(file, claudeLine("a", 1));
    await parseClaudeFile(file, "s", null, open, signal, cache);
    const [held] = readdirSync(cacheDir).filter((n) => n.endsWith(".json") && n !== "locations.json");
    // Written by another worker 35 days ago, and a temporary file left 2 hours ago.
    const old = join(cacheDir, "0".repeat(40) + ".json");
    writeFileSync(old, "{}");
    utimesSync(old, new Date(5 * day), new Date(5 * day));
    const tmp = join(cacheDir, "x.json.123.tmp");
    writeFileSync(tmp, "{");
    utimesSync(tmp, new Date(40 * day - 2 * 3_600_000), new Date(40 * day - 2 * 3_600_000));
    // The state this worker reads from memory looks as old.
    utimesSync(join(cacheDir, held!), new Date(5 * day), new Date(5 * day));
    await parseClaudeFile(file, "s", null, open, signal, cache);
    await cache.pruned();
    expect(existsSync(old)).toBe(true); // not a day yet
    clock.now += day;
    await parseClaudeFile(file, "s", null, open, signal, cache);
    await cache.pruned();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(join(cacheDir, held!))).toBe(true);
  });
});
