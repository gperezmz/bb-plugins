import { describe, expect, it } from "vitest";
import { crossingKey } from "../../src/core/budget";
import { EMPTY_CURSOR, type LedgerCursor } from "../../src/core/ledger";
import { costTotal } from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import type { EdgeExtra } from "../../src/server/store";
import { gatewayRow, logEntry, MIN, SEC, T0, tokens, turnRecord } from "../core/fixtures";
import { harness, TEST_SNAPSHOT, type Harness } from "./harness";
import { PriceBook } from "../../src/core/pricing";
import { UsageModel } from "../../src/server/model";

const NOW = T0 + 60 * MIN;

/** One thread with one turn of `input` input tokens (test-model: $1 per M). */
function addThread(
  h: Harness,
  threadId: string,
  edge: Partial<EdgeExtra> = {},
  opts: { input?: number; output?: number; startedAt?: number; cursor?: Partial<LedgerCursor>; firstSeenAt?: number } = {},
) {
  h.store.upsertEdge({ threadId, providerId: "claude-code", title: threadId, createdAt: T0, status: "idle", ...edge }, T0);
  h.store.putThread(
    {
      threadId,
      cursor: { ...EMPTY_CURSOR, ...opts.cursor },
      firstSeenAt: opts.firstSeenAt ?? T0,
      gaps: [],
      historyBackfilled: false,
      logsReadThrough: null,
      logsMissingHost: null,
      logsMissingSince: null,
      lastActivityAt: T0 + MIN,
    },
    T0,
  );
  const startedAt = opts.startedAt ?? T0 + MIN;
  h.store.putTurns(threadId, [
    turnRecord({
      turnId: `${threadId}-t1`,
      startedAt,
      completedAt: startedAt + MIN,
      model: "test-model",
      tokens: tokens({ input: opts.input ?? 1_000_000, output: opts.output ?? 0 }),
    }),
  ]);
}

/** Scenario 10's family: manager → child → grandchild, plus hidden, archived and Codex children, and a fork. */
function family(h: Harness) {
  addThread(h, "manager", {}, { input: 1_000_000 });
  addThread(h, "child", { parentThreadId: "manager", createdAt: T0 + 1 }, { input: 2_000_000 });
  addThread(h, "grandchild", { parentThreadId: "child", createdAt: T0 + 2 }, { input: 3_000_000 });
  addThread(h, "hidden", { parentThreadId: "manager", hidden: true, createdAt: T0 + 3 }, { input: 4_000_000 });
  addThread(h, "archived", { parentThreadId: "manager", archivedAt: T0 + 50, createdAt: T0 + 4 }, { input: 5_000_000 });
  addThread(h, "codex", { parentThreadId: "manager", providerId: "codex", createdAt: T0 + 5 }, { input: 6_000_000 });
  addThread(h, "fork", { parentThreadId: "manager", sourceThreadId: "manager", createdAt: T0 + 30 * MIN }, { input: 7_000_000, startedAt: T0 + 31 * MIN });
}

describe("family totals (scenarios 10–13)", () => {
  it("scenario 10: With children equals the sum of all six thread totals; the tree nests, marks and dims", () => {
    const h = harness();
    h.clock.now = NOW;
    family(h);
    const r = h.model.report("manager");
    expect(costTotal(r.thread.figure.cost)).toBeCloseTo(1, 10);
    expect(costTotal(r.family.figure.cost)).toBeCloseTo(1 + 2 + 3 + 4 + 5 + 6, 10);
    expect(r.descendants).toBe(5);
    expect(r.hiddenDescendants).toBe(1);
    const rows = Object.fromEntries(r.tree.map((row) => [row.threadId, row]));
    expect(rows.grandchild).toMatchObject({ depth: 2, parentThreadId: "child" });
    expect(rows.child!.familyUsd).toBeCloseTo(5, 10);
    expect(rows.hidden!.hidden).toBe(true);
    expect(rows.archived!.archived).toBe(true);
    expect(rows.codex!.providerId).toBe("codex");
    expect(r.tree.reduce((n, row) => n + (row.depth === 1 ? row.share : 0), 0)).toBeCloseTo(20 / 21, 10);
  });

  it("scenario 11: a fork is listed under forks, not in With children, and its total skips copied history", () => {
    const h = harness();
    h.clock.now = NOW;
    family(h);
    // The fork's logs include a subagent request copied from before it existed.
    h.store.upsertLogEntries("fork", [
      logEntry({ key: "copied", agentId: "agent-x", ts: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 9_000_000 }) }),
      logEntry({ key: "own", agentId: "agent-y", ts: T0 + 31 * MIN + SEC, model: "test-model", tokens: tokens({ input: 500_000 }) }),
    ]);
    const r = h.model.report("manager");
    expect(r.tree.map((row) => row.threadId)).not.toContain("fork");
    expect(costTotal(r.family.figure.cost)).toBeCloseTo(21, 10);
    expect(r.forks).toEqual([expect.objectContaining({ threadId: "fork" })]);
    expect(r.forks[0]!.usd).toBeCloseTo(7.5, 10);
  });

  it("scenario 12: deleting a child that has a child leaves the parent's family total unchanged", () => {
    const h = harness();
    h.clock.now = NOW;
    family(h);
    const before = costTotal(h.model.report("manager").family.figure.cost);
    h.store.upsertEdge({ threadId: "child", deletedAt: NOW }, NOW);
    h.model.invalidate(["child", "manager"]);
    const r = h.model.report("manager");
    expect(costTotal(r.family.figure.cost)).toBeCloseTo(before, 10);
    const rows = Object.fromEntries(r.tree.map((row) => [row.threadId, row]));
    expect(rows.child!.deleted).toBe(true);
    expect(rows.grandchild).toMatchObject({ parentThreadId: "child", depth: 2, deleted: false });
  });

  it("scenario 13: re-parenting changes both family totals on the next read", () => {
    const h = harness();
    h.clock.now = NOW;
    family(h);
    expect(costTotal(h.model.report("codex").family.figure.cost)).toBeCloseTo(6, 10);
    expect(costTotal(h.model.report("child").family.figure.cost)).toBeCloseTo(5, 10);
    h.store.upsertEdge({ threadId: "grandchild", parentThreadId: "codex" }, NOW);
    expect(costTotal(h.model.report("codex").family.figure.cost)).toBeCloseTo(9, 10);
    expect(costTotal(h.model.report("child").family.figure.cost)).toBeCloseTo(2, 10);
    expect(costTotal(h.model.report("manager").family.figure.cost)).toBeCloseTo(21, 10);
  });
});

describe("gateway threads (scenario 3)", () => {
  const setup = (readLogs: boolean) => {
    const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test", readLogs });
    h.clock.now = NOW;
    addThread(h, "thr_gw", {}, { input: 1000, output: 100 });
    h.store.upsertGatewayRows([
      gatewayRow({ threadId: "thr_gw", requestId: "main", startTime: T0 + MIN + SEC, promptTokens: 1000, completionTokens: 100, spend: 0.02, durationMs: 1000 }),
      gatewayRow({ threadId: "thr_gw", requestId: "sub", startTime: T0 + MIN + 2 * SEC, promptTokens: 400, completionTokens: 50, spend: 0.01, durationMs: 500 }),
    ]);
    h.store.upsertLogEntries("thr_gw", [
      logEntry({ key: "s", agentId: "agent-a", ts: T0 + MIN + 2 * SEC, tokens: tokens({ input: 400, output: 50 }) }),
    ]);
    return h;
  };

  it("is tagged, billed by the gateway, with API time; logs off labels the remainder as subagents", () => {
    const h = setup(false);
    const r = h.model.report("thr_gw");
    expect(r.state).toBe("tagged");
    expect(r.billing).toBe("gateway");
    expect(costTotal(r.thread.figure.cost)).toBeCloseTo(0.03, 10);
    expect(r.thread.headline.detail).toContain("billed by the gateway");
    expect(r.thread.figure.apiMs).toBe(1500);
    const note = r.quality.find((q) => q.id === "untracked")!;
    expect(note.text).toMatch(/subagents/);
    expect(note.text).toContain("450");
  });

  it("with logs on, subagent rows sit under the turn and nothing is left unlabelled", () => {
    const h = setup(true);
    const r = h.model.report("thr_gw");
    expect(r.turns.find((t) => t.turnId === "thr_gw-t1")!.subagents).toHaveLength(1);
    expect(r.quality.find((q) => q.id === "untracked")).toBeUndefined();
  });

  it("a sweep failure (banner) does not change the state", () => {
    const h = setup(true);
    h.store.setMeta("gatewayBanner", { check: "reachable", message: "down", since: NOW });
    h.model.invalidateAll();
    const r = h.model.report("thr_gw");
    expect(r.state).toBe("tagged");
    expect(r.gatewayBanner).toMatchObject({ check: "reachable" });
    expect(costTotal(r.thread.figure.cost)).toBeCloseTo(0.03, 10);
  });
});

describe("billing (scenario 14)", () => {
  it("subscription-window leads with tokens; account-pool says so; an api-key setting switches both to estimates", () => {
    const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test" });
    h.clock.now = NOW;
    addThread(h, "sub", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "pool", {}, { cursor: { routing: [{ name: "ANTHROPIC_BASE_URL", source: "plugin:account-pool", value: null }] } });
    let sub = h.model.report("sub");
    const pool = h.model.report("pool");
    expect(sub.billing).toBe("subscription");
    expect(sub.thread.headline.primaryKind).toBe("tokens");
    expect(sub.thread.headline.detail).toMatch(/list-price equivalent/);
    expect(pool.state).toBe("account-pool");
    expect(pool.stateMessage).toBe("Not via gateway: account pool");
    expect(pool.billing).toBe("subscription");

    h.settings.current = { ...h.settings.current, billing: { ...h.settings.current.billing, claudeCode: "api-key" } };
    h.model.invalidateAll();
    sub = h.model.report("sub");
    expect(sub.billing).toBe("api-key");
    expect(sub.thread.headline).toMatchObject({ primaryKind: "usd", primary: "$1.00" });
    expect(sub.thread.headline.detail).toMatch(/estimate/);
    expect(h.model.report("pool").thread.headline.detail).toMatch(/estimate/);
  });

  it("a thread with no rate-limit event takes its provider's latest kind", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "old", {}, {});
    addThread(h, "recent", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "pi-thread", { providerId: "pi" }, {});
    expect(h.model.report("old").billing).toBe("subscription");
    expect(h.model.report("pi-thread").billing).toBe("unknown");
  });

  it("scenario 4: an untagged Codex thread shows estimates and the Codex snippet", () => {
    const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test" });
    h.clock.now = NOW;
    addThread(h, "cx", { providerId: "codex", idleSince: T0 + 3 * MIN }, { output: 10 });
    const r = h.model.report("cx");
    expect(r.state).toBe("untagged");
    expect(r.thread.figure.cost.estimate).toBeGreaterThan(0);
    const note = r.quality.find((q) => q.id === "untagged")!;
    expect(note.snippet?.code).toContain("env_http_headers");
  });
});

describe("header chip and budget (scenarios 15, 17)", () => {
  it("is hidden for a thread with no turns and visible once a descendant has one", () => {
    const h = harness();
    h.store.upsertEdge({ threadId: "empty", createdAt: T0 }, T0);
    expect(h.model.chip("empty").visible).toBe(false);
    addThread(h, "kid", { parentThreadId: "empty" });
    expect(h.model.chip("empty")).toMatchObject({ visible: true, descendants: 1 });
  });

  it("tints and toasts once after a crossing", () => {
    const h = harness({ warnAbove: 5 });
    h.clock.now = NOW;
    family(h);
    expect(h.model.chip("manager").attention).toBe(false);
    h.store.addCrossing(crossingKey("manager", 5), { rootThreadId: "manager", amount: 5, crossedAt: NOW, totalAtCrossing: 21 });
    const chip = h.model.chip("manager");
    expect(chip.attention).toBe(true);
    expect(chip.toast).toMatchObject({ rootThreadId: "manager", title: "manager", total: "$21.00" });
    // A child's chip shows the ancestor family's attention too.
    expect(h.model.chip("grandchild").attention).toBe(true);
    expect(h.store.claimToast("manager", 5, NOW)).toBe(true);
    expect(h.model.chip("manager").toast).toBeNull();
  });
});

describe("surfaces agree (scenario 18)", () => {
  it("summary text, report and top list report the same family total, ordered by dollars", () => {
    const h = harness();
    h.clock.now = NOW;
    family(h);
    addThread(h, "other-root", { projectId: "proj_x" }, { input: 30_000_000 });
    const r = h.model.report("manager");
    expect(h.model.summaryText("manager", true)).toContain(r.family.headline.primary);
    const top = h.model.top(null, T0);
    expect(top.map((t) => t.threadId)).toEqual(["other-root", "manager", "fork"]);
    expect(top.find((t) => t.threadId === "manager")!.usd).toBeCloseTo(costTotal(r.family.figure.cost), 10);
    expect(h.model.top("proj_x", T0).map((t) => t.threadId)).toEqual(["other-root"]);
    expect(totalTokens(r.family.figure.tokens)).toBe(21_000_000);
  });
});

describe("list-price equivalent", () => {
  it("prices a subscription thread at list prices even when the gateway's price map is cheaper", () => {
    const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test" });
    h.clock.now = NOW;
    const gatewayCheap = new PriceBook({
      snapshot: TEST_SNAPSHOT,
      gateway: { "test-model": { input: 1e-9, output: 1e-9 } },
    });
    const model = new UsageModel({
      store: h.store,
      settings: () => h.settings.current,
      prices: () => gatewayCheap,
      listPrices: () => new PriceBook({ snapshot: TEST_SNAPSHOT }),
      pricesMeta: () => ({ litellmAt: null, modelsDevAt: null, bundledDate: null, refreshOn: true, lastError: null }),
      now: () => h.clock.now,
      gatewayBanner: () => null,
      gatewayPricesUsed: () => true,
    });
    addThread(h, "sub", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "api", {}, { cursor: { rateLimitKind: "spend-control" } });
    expect(costTotal(model.report("sub").thread.figure.cost)).toBeCloseTo(1, 6);
    expect(costTotal(model.report("api").thread.figure.cost)).toBeLessThan(0.01);
  });
});

describe("price freshness", () => {
  const DAY = 86_400_000;

  it("reports the last refresh, and stale after seven days or when nothing was ever fetched", () => {
    const h = harness();
    h.clock.now = NOW;
    expect(h.model.pricesInfo()).toMatchObject({ updatedAt: null, stale: true, bundledDate: "2026-05-01" });
    h.prices.meta = { ...h.prices.meta, litellmAt: NOW - 3 * 3_600_000 };
    expect(h.model.pricesInfo()).toMatchObject({ updatedAt: NOW - 3 * 3_600_000, stale: false });
    h.prices.meta = { ...h.prices.meta, litellmAt: NOW - 8 * DAY, lastError: "LiteLLM: HTTP 503" };
    expect(h.model.pricesInfo()).toMatchObject({ stale: true, lastError: "LiteLLM: HTTP 503" });
  });

  it("names, per model, the list that priced it and when that list was fetched", () => {
    const h = harness();
    h.clock.now = NOW;
    h.prices.snapshot = { ...TEST_SNAPSHOT, "test-model": TEST_SNAPSHOT["test-model"] };
    h.prices.modelsDev = { "dev-only": { input_cost_per_token: 2e-6, output_cost_per_token: 2e-6 } };
    h.prices.meta = { ...h.prices.meta, litellmAt: NOW - 1000, modelsDevAt: NOW - 2000 };
    addThread(h, "t");
    h.store.putTurns("t", [
      turnRecord({ turnId: "t-2", startedAt: T0 + 5 * MIN, completedAt: T0 + 6 * MIN, model: "dev-only", tokens: tokens({ input: 1_000_000 }) }),
      turnRecord({ turnId: "t-3", startedAt: T0 + 7 * MIN, completedAt: T0 + 8 * MIN, model: "nobody-knows", tokens: tokens({ input: 10 }) }),
    ]);
    const { models } = h.model.report("t").prices;
    expect(models["test-model"]).toEqual({ source: "snapshot", as: "test-model", fetchedAt: null });
    expect(models["dev-only"]).toEqual({ source: "models.dev", as: "dev-only", fetchedAt: NOW - 2000 });
    expect(models["nobody-knows"]).toBeUndefined();
  });

  it("names the public list, not the gateway's map, for a figure of subscription use only", () => {
    const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test" });
    h.clock.now = NOW;
    addThread(h, "sub", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "api", {}, { cursor: { rateLimitKind: "spend-control" } });
    const gateway = new PriceBook({ snapshot: TEST_SNAPSHOT, gateway: { "test-model": { input: 1e-9, output: 1e-9 } } });
    const model = new UsageModel({
      store: h.store,
      settings: () => h.settings.current,
      prices: () => gateway,
      listPrices: () => new PriceBook({ snapshot: TEST_SNAPSHOT }),
      pricesMeta: () => h.prices.meta,
      now: () => h.clock.now,
      gatewayBanner: () => null,
      gatewayPricesUsed: () => true,
    });
    expect(model.report("sub").prices.models["test-model"]!.source).toBe("snapshot");
    expect(model.report("api").prices.models["test-model"]!.source).toBe("gateway");
  });

  it("re-prices past turns with the current prices (estimates, not bills)", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "t");
    expect(costTotal(h.model.report("t").thread.figure.cost)).toBeCloseTo(1, 6);
    h.prices.snapshot = { "test-model": { input_cost_per_token: 3e-6, output_cost_per_token: 3e-6 } };
    h.model.invalidateAll();
    expect(costTotal(h.model.report("t").thread.figure.cost)).toBeCloseTo(3, 6);
  });
});
