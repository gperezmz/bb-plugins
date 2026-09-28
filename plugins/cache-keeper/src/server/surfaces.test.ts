import { beforeEach, describe, expect, it } from "vitest";
import { AgentTools } from "./agent-tools";
import { FakeBb, T0 } from "./fake-bb.test.helpers";
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
  deps = { engine: h.engine, store: h.store, agentTools: new AgentTools(h.store), now: () => h.now, flipped: () => flips++ };
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
});

describe("the agent tool", () => {
  const call = async (above?: string) => JSON.parse(await compactWhenIdle(deps, "t", above)) as { on: boolean; error?: string; line?: string };

  it("is refused while its Agent tools row is off, and changes nothing", async () => {
    expect(await call()).toMatchObject({ on: false, error: expect.stringMatching(/switched off in Settings/) });
    expect(h.store.get("t").compactOn).toBe(false);
  });

  it("switches compact when idle on for the calling thread, snapping above to the nearest line", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(await call("300k")).toMatchObject({ on: true, line: "329k" });
    expect(h.store.get("t").setting).toBe(5);
  });

  it("refuses a size that is not one, one above the highest line, and any while the window is unknown", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(await call("lots")).toMatchObject({ on: false, error: expect.stringMatching(/not a size/) });
    expect(await call("990k")).toMatchObject({ on: false, error: expect.stringMatching(/above this thread's highest line, 840k, in its 1M window/) });
    expect(h.store.get("t").compactOn).toBe(false);

    h.thread({ id: "fresh" });
    h.side("fresh").window = null;
    h.transcript("fresh", T0, 50_000);
    const refused = JSON.parse(await compactWhenIdle(deps, "fresh", "300k")) as { on: boolean; error: string };
    expect(refused).toMatchObject({ on: false, error: expect.stringMatching(/window isn't known yet.*first turn ends/) });
    expect(h.store.has("fresh") && h.store.get("fresh").compactOn).toBe(false);
  });

  it("refuses on a thread that is not Claude Code", async () => {
    deps.agentTools.set("compactWhenIdle", true);
    expect(JSON.parse(await compactWhenIdle(deps, "pi", undefined))).toMatchObject({ on: false, error: "Cache Keeper acts on Claude Code threads only" });
  });
});
