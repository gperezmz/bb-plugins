/** The server entry's registrations, loaded with a fake bb. */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

type Spec = { commands: { usage: string }[]; run(argv: string[], ctx: object): Promise<{ exitCode: number }> };

/** What bb holds for the plugin across loads: its data.db and the declared settings' values. */
interface Install {
  db: Database.Database;
  declared: Record<string, unknown>;
  /** Makes reading the declared settings fail. */
  unreadable?: boolean;
  /** Makes the reload fail. */
  reloadFails?: boolean;
  defines: number;
  reloads: number;
  warnings: string[];
}

const install = (declared: Record<string, unknown> = {}, over: Partial<Install> = {}): Install => ({ db: new Database(":memory:"), declared, defines: 0, reloads: 0, warnings: [], ...over });

type Handlers = Record<string, (input: unknown) => Promise<unknown>>;

/** Loads server.ts with a fake bb and returns what it registered with bb's CLI. */
async function load(env: Record<string, string | undefined>, on: Install = install()) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  const cli: Spec[] = [];
  const tools: string[] = [];
  let configure: (() => { tools: string[] }) | null = null;
  let service: ((signal: AbortSignal) => Promise<void>) | null = null;
  let installed: (() => Promise<void>) | null = null;
  let rpc: Handlers = {};
  const bb = {
    pluginId: "cache-keeper",
    settings: {
      define: () => {
        on.defines++;
        return { get: async () => (on.unreadable ? Promise.reject(new Error("no such setting")) : { ...on.declared }), onChange: () => {}, experimental_set: async () => ({}) };
      },
    },
    storage: { database: () => on.db, migrate: (d: Database.Database, statements: string[]) => (migrated(d) ? [] : statements).forEach((s) => d.exec(s)) },
    hosts: { experimental_client: () => ({ call: async () => ({}) }) },
    realtime: { publish: () => {} },
    events: { on: () => {} },
    background: { service: (_: string, s: { start(signal: AbortSignal): Promise<void> }) => (service = s.start), schedule: () => {} },
    rpc: { register: (_: unknown, handlers: Handlers) => (rpc = handlers) },
    cli: { register: (spec: Spec) => cli.push(spec) },
    agents: { registerTool: (t: { name: string }) => tools.push(t.name), configure: (fn: () => { tools: string[] }) => (configure = fn) },
    onInstall: (fn: () => Promise<void>) => (installed = fn),
    log: { info: () => {}, warn: (m: string) => on.warnings.push(m), error: () => {}, debug: () => {} },
    sdk: {
      threads: { list: async () => [] },
      plugins: {
        reload: async ({ pluginId }: { pluginId: string }) => {
          expect(pluginId).toBe("cache-keeper");
          on.reloads++;
          if (on.reloadFails) throw new Error("HTTP 422");
        },
      },
    },
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
  /** Starts the background service, as bb does once the plugin is loaded, and stops it. */
  const start = async () => {
    const stop = new AbortController();
    const running = service!(stop.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop.abort();
    await running;
  };
  return { commands, run, tools, offered: configure!().tools, rpc, start, install: () => installed!() };
}

/** Whether an earlier load already ran the store's migrations on this database, which bb's migration table records. */
const migrated = (d: Database.Database) => d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get() !== undefined;

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

describe("the settings bb held up to 0.2.0", () => {
  const held = { keepWarm: "Every waiting thread", stalledCheckIns: true, noOutputWait: "30 min", fetchPrices: false };
  const copied = { keepWarm: "every", checkIns: true, waitMs: 30 * 60_000, fetchPrices: false };
  const defaults = { keepWarm: "switched", checkIns: false, waitMs: 15 * 60_000, fetchPrices: true };

  it("are copied on the first load after upgrading, which then reloads the plugin once; later loads neither declare them nor reload", async () => {
    const on = install(held);
    const first = await load({}, on);
    expect(on.defines).toBe(1);
    expect(await first.rpc.settings!(null)).toEqual(copied);
    expect(on.reloads).toBe(0);
    await first.start();
    expect(on.reloads).toBe(1);

    // bb's reload, a restart and an update all load the entry again over the same data.db.
    on.declared = {};
    for (let i = 0; i < 2; i++) {
      const again = await load({}, on);
      await again.start();
      expect(await again.rpc.settings!(null)).toEqual(copied);
    }
    expect(on.defines).toBe(1);
    expect(on.reloads).toBe(1);
    expect(on.warnings).toEqual([]);
  });

  it("start at today's defaults on a fresh install, which takes the same path", async () => {
    const on = install();
    const first = await load({}, on);
    await first.start();
    await first.install();
    expect(await first.rpc.settings!(null)).toEqual(defaults);
    expect([on.defines, on.reloads]).toEqual([1, 1]);
  });

  it("start at their defaults when they cannot be read, logged once and never tried again", async () => {
    const on = install(held, { unreadable: true });
    await (await load({}, on)).start();
    on.unreadable = false;
    const again = await load({}, on);
    await again.start();
    expect(await again.rpc.settings!(null)).toEqual(defaults);
    expect([on.defines, on.reloads]).toEqual([1, 1]);
    expect(on.warnings).toHaveLength(1);
    expect(on.warnings[0]).toMatch(/could not read the settings bb held/);
  });

  it("are not copied again when the reload fails: it is logged once and the plugin carries on with them", async () => {
    const on = install(held, { reloadFails: true });
    const first = await load({}, on);
    await first.start();
    expect(await first.rpc.settings!(null)).toEqual(copied);
    await (await load({}, on)).start();
    expect([on.defines, on.reloads]).toEqual([1, 1]);
    expect(on.warnings).toEqual([expect.stringMatching(/could not reload after copying the settings bb held: HTTP 422/)]);
  });

  it("go back to their defaults on a reinstall, which bb runs onInstall for, and not on an update, which it does not", async () => {
    const on = install(held);
    await (await load({}, on)).start();
    const updated = await load({}, on);
    await updated.rpc.setSettings!({ keepWarm: "never" });
    expect(await (await load({}, on)).rpc.settings!(null)).toMatchObject({ keepWarm: "never", checkIns: true });

    // Uninstalled: bb deletes the declared settings and keeps data.db.
    on.declared = {};
    const reinstalled = await load({}, on);
    await reinstalled.install();
    expect(await reinstalled.rpc.settings!(null)).toEqual(defaults);
    expect(on.defines).toBe(1);
  });
});
