/** The server entry's registrations, loaded with a fake bb. */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

type Spec = { commands: { usage: string }[]; run(argv: string[], ctx: object): Promise<{ exitCode: number }> };

/** Loads server.ts with a fake bb and returns what it registered with bb's CLI. */
async function load(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  const cli: Spec[] = [];
  const tools: string[] = [];
  let configure: (() => { tools: string[] }) | null = null;
  const db = new Database(":memory:");
  const bb = {
    pluginId: "cache-keeper",
    settings: { define: () => ({ get: async () => ({}), onChange: () => {}, experimental_set: async () => ({}) }) },
    storage: { database: () => db, migrate: (d: Database.Database, statements: string[]) => statements.forEach((s) => d.exec(s)) },
    hosts: { experimental_client: () => ({ call: async () => ({}) }) },
    realtime: { publish: () => {} },
    events: { on: () => {} },
    background: { service: () => {}, schedule: () => {} },
    rpc: { register: () => {} },
    cli: { register: (spec: Spec) => cli.push(spec) },
    agents: { registerTool: (t: { name: string }) => tools.push(t.name), configure: (fn: () => { tools: string[] }) => (configure = fn) },
    onInstall: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    sdk: {},
  };
  try {
    const { default: plugin } = await import("../../server");
    await plugin(bb as never);
  } finally {
    process.env = saved;
  }
  // Each command's usage reads "bb cache-keeper <path> …".
  const commands = cli[0]!.commands.map((c) => c.usage.replace(/^bb cache-keeper /, "").replace(/ [[<-].*$/, ""));
  /** What `bb cache-keeper <argv>` answers: its exit code, or the error it refuses with. */
  const run = async (argv: string[]) => {
    try {
      return (await cli[0]!.run(argv, {})).exitCode;
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
  };
  return { commands, run, tools, offered: configure!().tools };
}

afterEach(() => {
  delete process.env.CACHE_KEEPER_DRIVE_CLOCK;
});

describe("the server entry", () => {
  it("registers no command that moves the clock unless started with the drive harness's variable", async () => {
    const plain = await load({ CACHE_KEEPER_DRIVE_CLOCK: undefined });
    expect(plain.commands.filter((c) => c.startsWith("drive"))).toEqual([]);
    expect(plain.commands).toContain("compact-now");
    expect(plain.commands).not.toContain("now");
    expect(await plain.run(["drive", "advance", "4m"])).not.toBe(0);
    const other = await load({ CACHE_KEEPER_DRIVE_CLOCK: "yes" });
    expect(await other.run(["drive", "advance", "4m"])).not.toBe(0);
    const driven = await load({ CACHE_KEEPER_DRIVE_CLOCK: "1" });
    expect(await driven.run(["drive", "advance", "4m"])).toBe(0);
  });

  it("registers the agent tool but offers it to no thread on a fresh install", async () => {
    const { tools, offered } = await load({});
    expect(tools).toEqual(["cache_keeper_compact_when_idle"]);
    expect(offered).toEqual([]);
  });
});
