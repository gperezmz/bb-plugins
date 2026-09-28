import { beforeEach, describe, expect, it } from "vitest";
import { AgentTools } from "./agent-tools";
import { busy, FakeBb, MIN, T0 } from "./fake-bb.test.helpers";
import { resetAfterReinstall, RESET_META } from "./reinstall";
import { DEFAULT_SETTINGS, Settings } from "./settings";
import { compactWhenIdle, rpcHandlers, type SurfaceDeps } from "./surfaces";

let h: FakeBb;
let deps: SurfaceDeps;
let flips: number;
beforeEach(async () => {
  h = new FakeBb();
  flips = 0;
  h.thread({ id: "t" });
  h.thread({ id: "pi", providerId: "pi" });
  h.transcript("t", T0, 300_000);
  await h.start();
  const settings = new Settings(h.store);
  deps = { engine: h.engine, store: h.store, agentTools: new AgentTools(h.store), now: () => h.now, settings: () => settings.get(), setSettings: (patch) => settings.set(patch), flipped: () => flips++ };
});

describe("the RPC handlers", () => {
  it("switch compact when idle, the setting, keep warm and skip, each counting as a flip", async () => {
    const rpc = rpcHandlers(deps);
    expect(await rpc.setCompact({ threadId: "t", on: true, setting: 4 })).toMatchObject({ compactOn: true, setting: 4 });
    expect(await rpc.setSetting({ threadId: "t", setting: 6 })).toMatchObject({ setting: 6 });
    expect(await rpc.setKeepWarm({ threadId: "t", on: true })).toMatchObject({ keptWarm: true });
    expect(await rpc.skip({ threadId: "t", what: "compaction", undo: false })).toMatchObject({ compactSkipped: true });
    expect(flips).toBe(4);
    expect((await rpc.view({ threadId: "t" }))?.compactOn).toBe(true);
  });

  it("carry the engine's refusals as plain errors with their message", async () => {
    const rpc = rpcHandlers(deps);
    await expect(rpc.setCompact({ threadId: "pi", on: true })).rejects.toThrow("Cache Keeper acts on Claude Code threads only");
    await expect(rpc.setKeepWarm({ threadId: "pi", on: true })).rejects.toThrow(/not a Claude Code thread/);
    expect(flips).toBe(0);
  });

  it("list row glyphs and the overview from memory, without listing bb's threads", async () => {
    const rpc = rpcHandlers(deps);
    await rpc.setCompact({ threadId: "t", on: true });
    const lists = h.calls.list;
    expect(await rpc.rowStatuses()).toEqual([{ threadId: "t", status: "compaction" }]);
    const overview = await rpc.overview();
    expect(overview.switchedOn.map((v) => v.threadId)).toEqual(["t"]);
    expect(overview.totals).toMatchObject({ compactions: 0, keepWarms: 0 });
    expect(h.calls.list).toBe(lists);
  });

  it("list the Agent tools rows, all off on a fresh install, and switch one", async () => {
    const rpc = rpcHandlers(deps);
    expect(await rpc.agentTools()).toEqual([{ key: "compactWhenIdle", name: "cache_keeper_compact_when_idle", label: "Compact when idle", on: false }]);
    expect(deps.agentTools.offered()).toEqual([]);
    expect(await rpc.setAgentTool({ name: "compactWhenIdle", on: true })).toMatchObject([{ on: true }]);
    expect(deps.agentTools.offered()).toEqual(["cache_keeper_compact_when_idle"]);
  });

  it("read the four settings, today's defaults on a fresh install, and change any of them, a change to check-ins alone counting as a flip", async () => {
    const rpc = rpcHandlers(deps);
    expect(await rpc.settings()).toEqual({ keepWarm: "switched", checkIns: false, waitMs: 15 * MIN, fetchPrices: true });
    expect(await rpc.setSettings({ keepWarm: "never", waitMs: 30 * MIN, fetchPrices: false })).toEqual({ keepWarm: "never", checkIns: false, waitMs: 30 * MIN, fetchPrices: false });
    expect(flips).toBe(0);
    expect(await rpc.setSettings({ checkIns: true })).toMatchObject({ keepWarm: "never", checkIns: true });
    expect(flips).toBe(1);
    // Stored: a later load reads them back.
    expect(new Settings(h.store).get()).toEqual({ keepWarm: "never", checkIns: true, waitMs: 30 * MIN, fetchPrices: false });
  });
});

describe("the agent tool", () => {
  const call = async (above?: string) => JSON.parse(await compactWhenIdle(deps, "t", above)) as { on: boolean; error?: string; line?: string };

  it("is refused while its Agent tools row is off, and changes nothing", async () => {
    expect(await call()).toMatchObject({ on: false, error: expect.stringMatching(/switched off in Settings/) });
    expect(h.engine.record("t").compactOn).toBe(false);
  });

  it("switches compact when idle on for the calling thread, snapping above to the nearest line", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(await call("300k")).toMatchObject({ on: true, line: "329k" });
    expect(h.engine.record("t").setting).toBe(5);
  });

  it("refuses a size that is not one, one above the highest line, and any while the window is unknown", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(await call("lots")).toMatchObject({ on: false, error: expect.stringMatching(/not a size/) });
    expect(await call("990k")).toMatchObject({ on: false, error: expect.stringMatching(/above this thread's highest line, 840k, in its 1M window/) });
    expect(h.engine.record("t").compactOn).toBe(false);

    h.thread({ id: "fresh" });
    h.side("fresh").window = null;
    h.transcript("fresh", T0, 50_000);
    const refused = JSON.parse(await compactWhenIdle(deps, "fresh", "300k")) as { on: boolean; error: string };
    expect(refused).toMatchObject({ on: false, error: expect.stringMatching(/window isn't known yet.*first turn ends/) });
    expect(h.engine.record("fresh").compactOn).toBe(false);
  });

  it("refuses on a thread that is not Claude Code", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(JSON.parse(await compactWhenIdle(deps, "pi", undefined))).toMatchObject({ on: false, error: "Cache Keeper acts on Claude Code threads only" });
  });
});

describe("a reinstall", () => {
  it("switches every thread, tree top, Skip, Agent tools row and check-ins off, and says so until a switch is flipped", async () => {
    h.thread({ id: "w", activity: busy });
    h.transcript("w", T0, 100_000);
    await h.engine.setCompact("t", true);
    await h.engine.setKeepWarm("w", true);
    await h.engine.skip("w", "warm", false);
    deps.agentTools.set("compactWhenIdle", true);
    deps.setSettings({ keepWarm: "every", checkIns: true, waitMs: 30 * MIN, fetchPrices: false });
    const notice = await resetAfterReinstall({ store: h.store, engine: h.engine, agentTools: deps.agentTools, now: T0 + MIN, resetSettings: () => deps.setSettings(DEFAULT_SETTINGS) });
    expect(notice).toEqual({ at: T0 + MIN, threads: 2 });
    expect(h.engine.record("t").compactOn).toBe(false);
    expect(h.engine.record("w").keepWarm).toBe(false);
    expect(h.engine.record("w").stretch?.warmSkipped).toBe(false);
    expect(deps.agentTools.offered()).toEqual([]);
    expect(deps.settings()).toEqual(DEFAULT_SETTINGS);
    expect(new Settings(h.store).get()).toEqual(DEFAULT_SETTINGS);
    expect(h.store.getMeta(RESET_META)).toEqual(notice);
    await rpcHandlers({ ...deps, flipped: () => h.store.deleteMeta(RESET_META) }).setCompact({ threadId: "t", on: true });
    expect(h.store.getMeta(RESET_META)).toBeNull();
  });

  it("does nothing on a first install but put the settings at their defaults", async () => {
    const fresh = new FakeBb();
    let reset = 0;
    const notice = await resetAfterReinstall({ store: fresh.store, engine: fresh.engine, agentTools: new AgentTools(fresh.store), now: T0, resetSettings: () => reset++ });
    expect(notice).toBeNull();
    expect(reset).toBe(1);
  });
});
