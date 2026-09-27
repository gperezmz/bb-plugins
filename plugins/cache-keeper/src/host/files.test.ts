import { appendFile, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandActivity, lastToolIn, subagentActivity, TranscriptReader, type Roots } from "./files";

const SESSION = "7dfc9da6-b6a9-4955-9df9-530b2c0ccda6";
const SLUG = "-work-repo";

async function roots(): Promise<Roots> {
  const dir = await mkdtemp(join(tmpdir(), "cache-keeper-"));
  return { projects: [join(dir, "projects")], tasks: [join(dir, "tmpdir", "claude-1000"), join(dir, "claude-1000")] };
}

const request = (min: number, id: string, write1h: number) =>
  `${JSON.stringify({
    type: "assistant",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString(),
    requestId: id,
    message: { id, model: "claude-opus-5-5", usage: { input_tokens: 1, cache_creation: { ephemeral_1h_input_tokens: write1h } } },
  })}\n`;

describe("TranscriptReader", () => {
  it("finds the session under its working directory's slug and reads what is appended", async () => {
    const r = await roots();
    const dir = join(r.projects[0]!, SLUG);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${SESSION}.jsonl`);
    await writeFile(path, request(0, "a", 100));
    const reader = new TranscriptReader(r);
    const first = await reader.read(SESSION, null);
    expect(first).toMatchObject({ found: true, cwdSlug: SLUG, facts: { requests: 1, context: 101, lifetime: "1h" } });

    // A line still being written is left for the next read.
    const next = request(1, "b", 300);
    await appendFile(path, next.slice(0, 40));
    expect((await reader.read(SESSION, null)).facts.requests).toBe(1);
    await appendFile(path, next.slice(40));
    const second = await reader.read(SESSION, Date.UTC(2026, 0, 1, 0, 1));
    expect(second.facts).toMatchObject({ requests: 2, context: 301 });
    expect(second.requests).toHaveLength(1);
  });

  it("reports a session it cannot find", async () => {
    expect(await new TranscriptReader(await roots()).read(SESSION, null)).toMatchObject({ found: false, cwdSlug: null });
  });
});

describe("task activity", () => {
  it("reads a command's output time and a subagent's last tool", async () => {
    const r = await roots();
    // Written under the second root, as when $TMPDIR is set but Claude Code's process had none.
    const tasks = join(r.tasks[1]!, SLUG, SESSION, "tasks");
    await mkdir(tasks, { recursive: true });
    await writeFile(join(tasks, "b1.output"), "tick\n");
    await utimes(join(tasks, "b1.output"), 1000, 1000);
    expect(await commandActivity(r, SLUG, SESSION, "b1")).toEqual({ id: "b1", outputFile: join(tasks, "b1.output"), changedAt: 1_000_000 });
    expect((await commandActivity(r, SLUG, SESSION, "b2")).changedAt).toBeNull();

    const agents = join(r.projects[0]!, SLUG, SESSION, "subagents");
    await mkdir(agents, { recursive: true });
    const line = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
    await writeFile(
      join(agents, "agent-a1.jsonl"),
      [line([{ type: "tool_use", name: "Grep" }]), line([{ type: "tool_use", name: "Read" }]), line([{ type: "text", text: "done" }])].join("\n"),
    );
    expect(await subagentActivity(r, SLUG, SESSION, "a1")).toMatchObject({ id: "a1", lastTool: "Read" });
    expect(lastToolIn('{"cut":')).toBeNull();
  });
});
