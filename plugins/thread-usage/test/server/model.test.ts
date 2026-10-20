import { describe, expect, it } from "vitest";
import { crossingKey } from "../../src/core/budget";
import { EMPTY_CURSOR, type LedgerCursor } from "../../src/core/ledger";
import { costTotal } from "../../src/core/summary";
import { totalTokens } from "../../src/core/tokens";
import type { EdgeExtra } from "../../src/server/store";
import { logEntry, MIN, SEC, T0, tokens, turnRecord } from "../core/fixtures";
import { harness, TEST_PRICES, type Harness } from "./harness";

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

/** Scenario 10's tree: manager → child → grandchild, plus hidden, archived and Codex children, and a fork. */
function addTree(h: Harness) {
  addThread(h, "manager", {}, { input: 1_000_000 });
  addThread(h, "child", { parentThreadId: "manager", createdAt: T0 + 1 }, { input: 2_000_000 });
  addThread(h, "grandchild", { parentThreadId: "child", createdAt: T0 + 2 }, { input: 3_000_000 });
  addThread(h, "hidden", { parentThreadId: "manager", hidden: true, createdAt: T0 + 3 }, { input: 4_000_000 });
  addThread(h, "archived", { parentThreadId: "manager", archivedAt: T0 + 50, createdAt: T0 + 4 }, { input: 5_000_000 });
  addThread(h, "codex", { parentThreadId: "manager", providerId: "codex", createdAt: T0 + 5 }, { input: 6_000_000 });
  addThread(h, "fork", { parentThreadId: "manager", sourceThreadId: "manager", createdAt: T0 + 30 * MIN }, { input: 7_000_000, startedAt: T0 + 31 * MIN });
}

describe("tree totals (scenarios 10–13)", () => {
  it("scenario 10: With children equals the sum of all six thread totals; the tree nests, marks and dims", () => {
    const h = harness();
    h.clock.now = NOW;
    addTree(h);
    const r = h.model.report("manager");
    expect(costTotal(r.thread.figure.cost)).toBeCloseTo(1, 10);
    expect(costTotal(r.treeTotal.figure.cost)).toBeCloseTo(1 + 2 + 3 + 4 + 5 + 6, 10);
    expect(r.descendants).toBe(5);
    expect(r.hiddenDescendants).toBe(1);
    const rows = Object.fromEntries(r.tree.map((row) => [row.threadId, row]));
    expect(rows.grandchild).toMatchObject({ depth: 2, parentThreadId: "child" });
    expect(rows.child!.treeUsd).toBeCloseTo(5, 10);
    expect(rows.hidden!.hidden).toBe(true);
    expect(rows.archived!.archived).toBe(true);
    expect(rows.codex!.providerId).toBe("codex");
    expect(r.tree.reduce((n, row) => n + (row.depth === 1 ? row.share : 0), 0)).toBeCloseTo(20 / 21, 10);
  });

  it("scenario 11: a fork is listed under forks, not in With children, and its total skips copied history", () => {
    const h = harness();
    h.clock.now = NOW;
    addTree(h);
    // The fork's logs include a subagent request copied from before it existed.
    h.store.upsertLogEntries("fork", [
      logEntry({ key: "copied", agentId: "agent-x", ts: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 9_000_000 }) }),
      logEntry({ key: "own", agentId: "agent-y", ts: T0 + 31 * MIN + SEC, model: "test-model", tokens: tokens({ input: 500_000 }) }),
    ]);
    const r = h.model.report("manager");
    expect(r.tree.map((row) => row.threadId)).not.toContain("fork");
    expect(costTotal(r.treeTotal.figure.cost)).toBeCloseTo(21, 10);
    expect(r.forks).toEqual([expect.objectContaining({ threadId: "fork" })]);
    expect(r.forks[0]!.usd).toBeCloseTo(7.5, 10);
  });

  it("scenario 12: deleting a child that has a child leaves the parent's tree total unchanged", () => {
    const h = harness();
    h.clock.now = NOW;
    addTree(h);
    const before = costTotal(h.model.report("manager").treeTotal.figure.cost);
    h.store.upsertEdge({ threadId: "child", deletedAt: NOW }, NOW);
    h.model.invalidate(["child", "manager"]);
    const r = h.model.report("manager");
    expect(costTotal(r.treeTotal.figure.cost)).toBeCloseTo(before, 10);
    const rows = Object.fromEntries(r.tree.map((row) => [row.threadId, row]));
    expect(rows.child!.deleted).toBe(true);
    expect(rows.grandchild).toMatchObject({ parentThreadId: "child", depth: 2, deleted: false });
  });

  it("scenario 13: re-parenting changes both tree totals on the next read", () => {
    const h = harness();
    h.clock.now = NOW;
    addTree(h);
    expect(costTotal(h.model.report("codex").treeTotal.figure.cost)).toBeCloseTo(6, 10);
    expect(costTotal(h.model.report("child").treeTotal.figure.cost)).toBeCloseTo(5, 10);
    h.store.upsertEdge({ threadId: "grandchild", parentThreadId: "codex" }, NOW);
    expect(costTotal(h.model.report("codex").treeTotal.figure.cost)).toBeCloseTo(9, 10);
    expect(costTotal(h.model.report("child").treeTotal.figure.cost)).toBeCloseTo(2, 10);
    expect(costTotal(h.model.report("manager").treeTotal.figure.cost)).toBeCloseTo(21, 10);
  });
});

describe("subagent requests", () => {
  it("sit under the turn they ran in, with logs on, and are left out with logs off", () => {
    const setup = (readLogs: boolean) => {
      const h = harness({ readLogs });
      h.clock.now = NOW;
      addThread(h, "thr_sub", {}, { input: 1000, output: 100 });
      h.store.upsertLogEntries("thr_sub", [
        logEntry({ key: "s", agentId: "agent-a", ts: T0 + MIN + 2 * SEC, model: "test-model", tokens: tokens({ input: 400, output: 50 }) }),
      ]);
      return h;
    };
    const on = setup(true).model.report("thr_sub");
    expect(on.turns.find((t) => t.turnId === "thr_sub-t1")!.subagents).toHaveLength(1);
    expect(totalTokens(on.thread.figure.tokens)).toBe(1550);
    const off = setup(false).model.report("thr_sub");
    expect(off.turns.find((t) => t.turnId === "thr_sub-t1")!.subagents).toHaveLength(0);
    expect(totalTokens(off.thread.figure.tokens)).toBe(1100);
    expect(off.quality.map((q) => q.id)).toContain("subagents-off");
  });
});

describe("billing (scenario 14)", () => {
  it("subscription-window leads with tokens; account-pool says so; an api-key setting switches both to estimates", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "sub", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "pool", {}, { cursor: { routing: [{ name: "ANTHROPIC_BASE_URL", source: "plugin:account-pool", value: null }] } });
    let sub = h.model.report("sub");
    const pool = h.model.report("pool");
    expect(sub.billing).toBe("subscription");
    expect(sub.thread.headline.primaryKind).toBe("tokens");
    expect(sub.thread.headline.detail).toMatch(/list-price equivalent/);
    expect(pool.billing).toBe("subscription");
    expect(pool.quality.map((q) => q.id)).not.toContain("routing");

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

  it("reads a billing choice saved as gateway like auto", () => {
    const h = harness({ billingClaudeCode: "gateway" });
    h.clock.now = NOW;
    addThread(h, "sub", {}, { cursor: { rateLimitKind: "subscription-window" } });
    addThread(h, "api", {}, { cursor: { rateLimitKind: "spend-control" } });
    expect(h.model.report("sub").billing).toBe("subscription");
    expect(h.model.report("api").billing).toBe("api-key");
  });

  it("gives a thread no attribution state, and a Cursor thread no note of its own", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "cx", { providerId: "codex", idleSince: T0 + 3 * MIN }, { output: 10 });
    addThread(h, "cursor", { providerId: "acp-cursor" }, { input: 0 });
    for (const id of ["cx", "cursor"]) {
      const r = h.model.report(id) as unknown as Record<string, unknown>;
      expect(r).not.toHaveProperty("state");
      expect(r).not.toHaveProperty("stateMessage");
      expect(r).not.toHaveProperty("gatewayBanner");
      expect((r.quality as { id: string }[]).map((q) => q.id)).not.toEqual(expect.arrayContaining(["untagged", "routing", "pending", "cursor", "untracked"]));
    }
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
    addTree(h);
    expect(h.model.chip("manager").attention).toBe(false);
    h.store.addCrossing(crossingKey("manager", 5), { rootThreadId: "manager", amount: 5, crossedAt: NOW, totalAtCrossing: 21 });
    const chip = h.model.chip("manager");
    expect(chip.attention).toBe(true);
    expect(chip.toast).toMatchObject({ rootThreadId: "manager", title: "manager", total: "$21.00" });
    // A child's chip shows the ancestor tree's attention too.
    expect(h.model.chip("grandchild").attention).toBe(true);
    expect(h.store.claimToast("manager", 5, NOW)).toBe(true);
    expect(h.model.chip("manager").toast).toBeNull();
  });
});

describe("surfaces agree (scenario 18)", () => {
  it("summary text, report and top list report the same tree total, ordered by dollars", () => {
    const h = harness();
    h.clock.now = NOW;
    addTree(h);
    addThread(h, "other-root", { projectId: "proj_x" }, { input: 30_000_000 });
    const r = h.model.report("manager");
    expect(h.model.summaryText("manager", true)).toContain(r.treeTotal.headline.primary);
    const top = h.model.top(null, T0);
    expect(top.priced.map((t) => t.threadId)).toEqual(["other-root", "manager", "fork"]);
    expect(top.notPriced).toEqual([]);
    expect(top.priced.find((t) => t.threadId === "manager")!.usd).toBeCloseTo(costTotal(r.treeTotal.figure.cost), 10);
    expect(h.model.top("proj_x", T0).priced.map((t) => t.threadId)).toEqual(["other-root"]);
    expect(totalTokens(r.treeTotal.figure.tokens)).toBe(21_000_000);
  });
});

describe("trees no price covers", () => {
  /** A thread whose one turn ran on a model models.dev does not list. */
  function addUnpriced(h: Harness, threadId: string, tokenCount: number, edge: Partial<EdgeExtra> = {}) {
    addThread(h, threadId, edge, { input: tokenCount });
    h.store.putTurns(threadId, [
      turnRecord({ turnId: `${threadId}-t1`, startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "my-internal-model", tokens: tokens({ input: tokenCount }) }),
    ]);
  }

  it("leads with the token count on the chip and the report, and says the tokens are not priced", () => {
    const h = harness();
    h.clock.now = NOW;
    addUnpriced(h, "odd", 45_000);
    expect(h.model.chip("odd")).toMatchObject({ visible: true, chip: "45k" });
    expect(h.model.chip("odd").headline).toMatchObject({ primary: "45k tokens", primaryKind: "tokens", detail: "The tokens are not priced" });
    const r = h.model.report("odd");
    expect(r.thread.headline).toMatchObject({ primary: "45k tokens", primaryKind: "tokens" });
    const note = r.quality.find((q) => q.id === "unpriced")!;
    expect(note.text).toBe("my-internal-model has no price: its tokens are counted and not priced. A price would come from models.dev, which does not list it.");
    expect(note.text).not.toMatch(/override/i);
    expect(h.model.summaryText("odd", true)).toContain("45k tokens");
  });

  it("ranks trees with dollars apart from trees whose every token is unpriced, each list from its own order", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "cheap", {}, { input: 1_000_000 });
    addThread(h, "dear", {}, { input: 9_000_000 });
    addUnpriced(h, "odd-small", 5_000);
    addUnpriced(h, "odd-big", 45_000);
    // A tree with some priced dollars stays in the dollar ranking, with its unpriced tokens named.
    addThread(h, "partly", {}, { input: 2_000_000 });
    h.store.putTurns("partly", [
      turnRecord({ turnId: "partly-t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 2_000_000 }) }),
      turnRecord({ turnId: "partly-t2", startedAt: T0 + 3 * MIN, completedAt: T0 + 4 * MIN, model: "my-internal-model", tokens: tokens({ input: 500 }) }),
    ]);
    // A tree with no tokens is listed in neither.
    h.store.upsertEdge({ threadId: "empty", createdAt: T0 }, T0);
    h.store.putThread({ ...h.store.getThread("cheap")!, threadId: "empty" }, T0);
    h.store.putTurns("empty", [turnRecord({ turnId: "empty-t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model" })]);
    const top = h.model.top(null, T0);
    expect(top.priced.map((t) => t.threadId)).toEqual(["dear", "partly", "cheap"]);
    expect(top.notPriced.map((t) => t.threadId)).toEqual(["odd-big", "odd-small"]);
    expect(top.priced.find((t) => t.threadId === "partly")!.headline.unpricedNote).toBe("+ 500 unpriced tokens");
    expect(top.notPriced[0]).toMatchObject({ tokens: 45_000, usd: 0 });
  });

  it("keeps a thread with no tokens a dash, with no usage recorded", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "none", {}, { input: 0 });
    expect(h.model.report("none").thread.headline).toMatchObject({ primary: "—", detail: "No usage recorded" });
  });
});

describe("tiers", () => {
  const tiered = { input: 1e-6, output: 4e-6, tiers: [{ above: 100_000, input: 5e-6 }] };

  it("notes turns that have no per-request prompt sizes, only on a model with a tier", () => {
    const h = harness();
    h.clock.now = NOW;
    h.prices.models = { ...TEST_PRICES, "tier-model": tiered };
    addThread(h, "plain", { providerId: "codex" }, { input: 300_000 });
    addThread(h, "sum", { providerId: "codex" }, {});
    h.store.putTurns("sum", [turnRecord({ turnId: "sum-t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "tier-model", tokens: tokens({ input: 300_000 }) })]);
    expect(h.model.report("plain").quality.map((q) => q.id)).not.toContain("tier-unsized");
    const note = h.model.report("sum").quality.find((q) => q.id === "tier-unsized")!;
    expect(note.text).toBe(
      "Some turns have no per-request prompt sizes, because they were stored as a sum, filled from bb's running total, or are an opening balance, so a long-context tier cannot be applied and their dollars may be low. Turns whose per-request sizes are known are priced per request.",
    );
  });

  it("says why a Claude Code thread's turns have no per-request sizes", () => {
    const h = harness();
    h.clock.now = NOW;
    h.prices.models = { ...TEST_PRICES, "tier-model": tiered };
    addThread(h, "cc", {}, {});
    h.store.putTurns("cc", [turnRecord({ turnId: "cc-t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "tier-model", tokens: tokens({ input: 300_000 }) })]);
    expect(h.model.report("cc").quality.find((q) => q.id === "tier-unsized")!.text).toMatch(/Claude Code adapter reports one usage event for a whole turn, so its turns have none\.$/);
  });

  it("prices a turn recorded after the change request by request, with no such note", () => {
    const h = harness();
    h.clock.now = NOW;
    h.prices.models = { ...TEST_PRICES, "tier-model": tiered };
    addThread(h, "rec", {}, {});
    const requests = [{ input: 40_000, output: 0, cacheRead: 0, cacheWrite: 0 }, { input: 120_000, output: 0, cacheRead: 0, cacheWrite: 0 }];
    h.store.putTurns("rec", [
      turnRecord({ turnId: "rec-t1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "tier-model", tokens: tokens({ input: 160_000 }), requests }),
    ]);
    const r = h.model.report("rec");
    expect(costTotal(r.thread.figure.cost)).toBeCloseTo(40_000 * 1e-6 + 120_000 * 5e-6, 10);
    expect(r.quality.map((q) => q.id)).not.toContain("tier-unsized");
    expect(r.turns[0]!.tierDetail).toMatchObject({ requests: 2, tiered: [{ number: 2, tierAbove: 100_000 }] });
  });

  it("keeps a turn's requests across a stored round trip", () => {
    const h = harness();
    addThread(h, "rt", {}, {});
    const requests = [{ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }];
    h.store.putTurns("rt", [turnRecord({ turnId: "rt-t1", startedAt: T0, completedAt: T0 + 1, model: "test-model", requests })]);
    expect(h.store.getTurns("rt")[0]!.requests).toEqual(requests);
  });
});

describe("price freshness", () => {
  const DAY = 86_400_000;

  it("reports the last refresh, and stale after seven days or when nothing was ever fetched", () => {
    const h = harness();
    h.clock.now = NOW;
    expect(h.model.pricesInfo()).toMatchObject({ updatedAt: null, stale: true, bundledDate: "2026-05-01" });
    h.prices.meta = { ...h.prices.meta, modelsDevAt: NOW - 3 * 3_600_000 };
    expect(h.model.pricesInfo()).toMatchObject({ updatedAt: NOW - 3 * 3_600_000, stale: false });
    h.prices.meta = { ...h.prices.meta, modelsDevAt: NOW - 8 * DAY, lastError: "HTTP 503" };
    expect(h.model.pricesInfo()).toMatchObject({ stale: true, lastError: "HTTP 503" });
  });

  it("names, per model, the models.dev copy that priced it and when it was fetched", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "t");
    h.store.putTurns("t", [
      turnRecord({ turnId: "t-3", startedAt: T0 + 7 * MIN, completedAt: T0 + 8 * MIN, model: "nobody-knows", tokens: tokens({ input: 10 }) }),
    ]);
    h.store.putTurns("t", [turnRecord({ turnId: "t-1", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 1_000_000 }) })]);
    expect(h.model.report("t").prices.models["test-model"]).toEqual({ source: "snapshot", as: "test-model", fetchedAt: null });
    h.prices.origin = "models.dev";
    h.prices.meta = { ...h.prices.meta, modelsDevAt: NOW - 2000 };
    h.model.invalidateAll();
    const { models } = h.model.report("t").prices;
    expect(models["test-model"]).toEqual({ source: "models.dev", as: "test-model", fetchedAt: NOW - 2000 });
    expect(models["nobody-knows"]).toBeUndefined();
  });

  it("re-prices past turns with the current prices (estimates, not bills)", () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "t");
    expect(costTotal(h.model.report("t").thread.figure.cost)).toBeCloseTo(1, 6);
    h.prices.models = { "test-model": { input: 3e-6, output: 3e-6 } };
    h.model.invalidateAll();
    expect(costTotal(h.model.report("t").thread.figure.cost)).toBeCloseTo(3, 6);
  });
});
