/**
 * The cost every surface reports, through the entry points a person or
 * another plugin uses: the RPC the Usage tab and the Thread usage page call,
 * `bb thread-usage` and the `thread_usage` agent tool. bb's events and the
 * models.dev document are the only things faked.
 */
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../server";
import { MODELS_DEV_URL } from "../../src/core/models-dev";
import type { ThreadReport, TopTrees } from "../../src/core/report-types";
import { claudeBreakdown as cb, accepted, completed, requested, started, usage, T0, SEC } from "../core/fixtures";

const THREAD = "thr_surf";
const NOW_ISO = /^\d{4}-\d\d-\d\dT/;

/** Claude Haiku 5.5 as models.dev published it on 2026-10-19, among enough other models to pass the truncation check. */
const HAIKU = { cost: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125, tiers: [{ input: 0.5, output: 2.5, cache_read: 0.05, cache_write: 0.625, tier: { type: "context", size: 100_000 } }] } };
const modelsDev = () => {
  const models: Record<string, unknown> = { "claude-haiku-5-5": HAIKU };
  for (let i = 0; i < 120; i++) models[`filler-${i}`] = { cost: { input: 1, output: 2 } };
  return { anthropic: { models } };
};
const fetchStub = vi.fn(async (input: string | URL | Request) => {
  if (String(input) === MODELS_DEV_URL) return new Response(JSON.stringify(modelsDev()));
  throw new Error(`unexpected ${String(input)}`);
});

/** One turn of two requests, the second 100,001 prompt tokens: 40,000 + (20,000 uncached + 70,000 read + 10,001 written). */
const events = (model: string) => [
  requested(1, T0, "r1", model),
  accepted(2, T0, "turn-1", "r1"),
  started(3, T0, "turn-1"),
  usage(4, T0 + SEC, "turn-1", cb({ input: 40_000, output: 100 }), cb({ input: 40_000, output: 100 })),
  usage(5, T0 + 2 * SEC, "turn-1", cb({ input: 20_000, output: 1_000, cacheRead: 70_000, cacheWrite: 10_001 }), cb({ input: 60_000, output: 1_100, cacheRead: 70_000, cacheWrite: 10_001 })),
  completed(6, T0 + 3 * SEC, "turn-1"),
];
const EXPECTED = 40_000 * 0.1e-6 + 100 * 0.5e-6 + 20_000 * 0.5e-6 + 1_000 * 2.5e-6 + 70_000 * 0.05e-6 + 10_001 * 0.625e-6;

let started_: FakePluginHost | null = null;
/** `others` are further threads, each with the model its turn ran on. */
async function load(model = "claude-haiku-5-5", settings: Record<string, boolean> = {}, others: Record<string, string> = {}, providerId = "codex") {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockClear();
  const models: Record<string, string> = { [THREAD]: model, ...others };
  const dtos = Object.keys(models).map((id) => ({ id, providerId, title: id === THREAD ? "Surfaces" : id, status: "idle", createdAt: T0 }));
  const host = createFakePluginHost({
    pluginId: "thread-usage",
    settings,
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => dtos.find((d) => d.id === threadId),
        list: async () => dtos,
        events: { list: async ({ threadId }: { threadId: string }) => events(models[threadId] ?? model) },
      },
      projects: { list: async () => [] },
    },
  });
  started_ = host;
  await plugin(host.bb);
  const b = host.harness.behavior;
  return {
    host,
    fetchPrices: async () => {
      b.runService("online-prices");
      await vi.waitFor(async () => expect(((await b.callRpc("status", null)) as { prices: { updatedAt: number | null } }).prices.updatedAt).not.toBeNull(), { timeout: 10_000 });
    },
    report: () => b.callRpc("report", { threadId: THREAD }) as Promise<ThreadReport>,
    show: async () => JSON.parse((await b.runCli(["show", THREAD, "--json"], { threadId: THREAD })).stdout ?? "null") as Record<string, unknown>,
    tool: async () => {
      const result = await b.callAgentTool("thread_usage", {}, { threadId: THREAD });
      return JSON.parse(String((result as { content?: { text?: string }[] }).content?.[0]?.text ?? result)) as Record<string, unknown>;
    },
    top: async () => JSON.parse((await b.runCli(["top", "--json", "--since", "3650d"], { threadId: THREAD })).stdout ?? "null") as { trees: unknown[]; notPriced: unknown[]; pricesUpdatedAt: string | null },
  };
}

afterEach(async () => {
  await started_?.harness.lifecycle.dispose();
  started_ = null;
  vi.unstubAllGlobals();
});

describe("a thread's dollars are the models.dev estimate, request by request", () => {
  it("shows the same amount on the Usage tab's report, `bb thread-usage show` and the agent tool, from the fetched list", async () => {
    const t = await load();
    await t.fetchPrices();
    const report = await t.report();
    expect(report.thread.figure.cost.estimate).toBeCloseTo(EXPECTED, 12);
    const shown = await t.show();
    expect(shown.usd).toBeCloseTo(EXPECTED, 12);
    const tool = await t.tool();
    expect(tool.usd).toBeCloseTo(EXPECTED, 12);
    // The models.dev fetch time, not the time of anything else.
    expect(shown.pricesUpdatedAt).toMatch(NOW_ISO);
    expect(tool.pricesUpdatedAt).toBe(shown.pricesUpdatedAt);
    expect(report.prices.models["claude-haiku-5-5"]).toMatchObject({ source: "models.dev", as: "claude-haiku-5-5" });
    expect(report.prices.updatedAt).toBe(Date.parse(shown.pricesUpdatedAt as string));
  });

  it("prices a tier at the size models.dev published, which the plugin does not carry", async () => {
    const t = await load();
    await t.fetchPrices();
    const report = await t.report();
    expect(report.turns[0]!.tierDetail).toMatchObject({ requests: 2, tiered: [{ number: 2, prompt: 100_001, tierAbove: 100_000 }] });
  });

  it("keeps the report's three cost amounts, gateway and harness at zero, and says where each turn's cost came from", async () => {
    const t = await load();
    await t.fetchPrices();
    const report = await t.report();
    const cost = report.treeTotal.figure.cost;
    expect(cost.gateway).toBe(0);
    expect(cost.harness).toBe(0);
    expect(cost.gateway + cost.harness + cost.estimate).toBeCloseTo(EXPECTED, 12);
    expect(report.turns.map((turn) => turn.source)).toEqual(["estimate"]);
    expect(report).not.toHaveProperty("gatewayBanner");
    const tool = await t.tool();
    expect(tool.costBySource).toEqual({ gateway: 0, harness: 0, estimate: expect.closeTo(EXPECTED, 12) });
    expect(await t.show()).toMatchObject({ cost: { gateway: 0, harness: 0 } });
  });

  it("carries no API time, tokens outside bb's view or attribution state on any surface", async () => {
    const t = await load();
    const shown = await t.show();
    for (const field of ["apiMs", "untrackedTokens", "state"]) expect(shown).not.toHaveProperty(field);
    const report = (await t.report()) as unknown as { treeTotal: { figure: Record<string, unknown> } };
    for (const field of ["apiMs", "untrackedTokens"]) expect(report.treeTotal.figure).not.toHaveProperty(field);
  });

  it("uses the bundled models.dev copy until a fetch succeeds, with no fetch time, and says `snapshot`", async () => {
    const t = await load("claude-haiku-5-5", { refreshPrices: false });
    const report = await t.report();
    expect(report.prices.updatedAt).toBeNull();
    expect(report.prices.models["claude-haiku-5-5"]!.source).toBe("snapshot");
    expect(report.prices.models["claude-haiku-5-5"]!.fetchedAt).toBeNull();
    expect((await t.show()).pricesUpdatedAt).toBeNull();
    expect((await t.tool()).pricesUpdatedAt).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("Claude Code reports one usage event for a whole turn", () => {
  it("keeps no per-request sizes for its turns, prices them at the base rates and says so", async () => {
    const t = await load("claude-haiku-5-5", {}, {}, "claude-code");
    await t.fetchPrices();
    const report = await t.report();
    // The turn's two requests are one summed event: no tier is guessed.
    expect(report.turns[0]).toMatchObject({ tierDetail: null, approximate: true, tierUnsized: true, requests: 0 });
    expect(report.thread.figure.cost.estimate).toBeCloseTo(60_000 * 0.1e-6 + 1_100 * 0.5e-6 + 70_000 * 0.01e-6 + 10_001 * 0.125e-6, 12);
    const note = report.quality.find((q) => q.id === "tier-unsized")!;
    expect(note.text).toContain("Claude Code adapter reports one usage event for a whole turn");
  });
});

describe("a model models.dev does not list is unpriced, not free", () => {
  it("leads every surface with the token count and says the tokens are not priced", async () => {
    const t = await load("my-internal-model");
    const report = await t.report();
    expect(report.thread.headline).toMatchObject({ primary: "141k tokens", primaryKind: "tokens", detail: "The tokens are not priced" });
    const shown = (await t.show()) as { headline: { primary: string; chip: string }; unpricedTokens: number };
    expect(shown.headline).toMatchObject({ primary: "141k tokens", chip: "141k" });
    expect(shown.unpricedTokens).toBe(141_101);
    const tool = await t.tool();
    expect(tool.headline).toContain("141k tokens");
    expect(tool.unpricedTokens).toBe(141_101);
    const chip = (await started_!.harness.behavior.callRpc("chip", { threadId: THREAD })) as { chip: string };
    expect(chip.chip).toBe("141k");
  });

  it("lists the tree apart from the dollar ranking, under Not priced", async () => {
    const t = await load("my-internal-model");
    await t.show();
    const top = await t.top();
    expect(top.trees).toEqual([]);
    expect(top.notPriced).toEqual([expect.objectContaining({ threadId: THREAD, tokens: 141_101, usd: 0 })]);
    const text = (await started_!.harness.behavior.runCli(["top", "--since", "3650d"], { threadId: THREAD })).stdout ?? "";
    expect(text).toMatch(/^Not priced\n 1\. +141k tokens +Surfaces .*\n +.*not priced$/);
  });
});

describe("the limit of `bb thread-usage top`", () => {
  it("applies to each list, so a full dollar ranking does not hide the Not priced list", async () => {
    const t = await load("claude-haiku-5-5", {}, { thr_two: "claude-haiku-5-5", thr_odd1: "my-internal-model", thr_odd2: "my-internal-model" });
    await t.fetchPrices();
    // Opening each thread reads its events into the ledger.
    for (const id of [THREAD, "thr_two", "thr_odd1", "thr_odd2"]) await started_!.harness.behavior.runCli(["show", id, "--json"], { threadId: id });
    const all = await started_!.harness.behavior.runCli(["top", "--json", "--since", "3650d"], { threadId: THREAD });
    const full = JSON.parse(all.stdout ?? "null") as { trees: unknown[]; notPriced: unknown[] };
    expect([full.trees.length, full.notPriced.length]).toEqual([2, 2]);
    const limited = JSON.parse((await started_!.harness.behavior.runCli(["top", "--json", "--since", "3650d", "--limit", "1"], { threadId: THREAD })).stdout ?? "null") as { trees: unknown[]; notPriced: unknown[] };
    expect([limited.trees.length, limited.notPriced.length]).toEqual([1, 1]);
  });
});
