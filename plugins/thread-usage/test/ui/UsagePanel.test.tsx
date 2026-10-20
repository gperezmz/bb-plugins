// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CURSOR } from "../../src/core/ledger";
import { Report } from "../../src/ui/UsagePanel";
import { logEntry, MIN, SEC, T0, tokens, turnRecord } from "../core/fixtures";
import { harness, type Harness } from "../server/harness";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: vi.fn() }),
  useBbNavigate: () => ({ toThread: vi.fn() }),
  useRealtime: () => {},
  experimental_Icon: () => <svg />,
  experimental_ProviderIcon: () => <svg />,
  experimental_useProviders: () => ({ providers: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The panel words ages against the clock, so a test of them sets the clock to the model's. */
const clockAt = (ms: number) => vi.useFakeTimers({ toFake: ["Date"], now: ms });

const NOW = T0 + 60 * MIN;

/** A Claude-style model with one context tier over 100,000 tokens, as models.dev publishes Haiku 5.5. */
const TIERED = { input: 1e-7, output: 5e-7, cacheRead: 1e-8, cacheWrite: 1.25e-7, claude: true as const, tiers: [{ above: 100_000, input: 5e-7, output: 2.5e-6, cacheRead: 5e-8, cacheWrite: 6.25e-7 }] };

function addThread(h: Harness, threadId: string, edge: Record<string, unknown> = {}) {
  h.store.upsertEdge({ threadId, providerId: "claude-code", title: threadId, createdAt: T0, status: "idle", ...edge }, T0);
  h.store.putThread(
    { threadId, cursor: { ...EMPTY_CURSOR, rateLimitKind: "spend-control" }, firstSeenAt: T0, gaps: [], historyBackfilled: false, logsReadThrough: null, logsMissingHost: null, logsMissingSince: null, lastActivityAt: T0 + MIN },
    T0,
  );
}

const req = (input: number, extra: Partial<{ output: number; cacheRead: number; cacheWrite: number }> = {}) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0, ...extra });

/**
 * A thread whose first turn made one request of 40,000 and one of 100,001 prompt tokens. With `asSum`, it
 * has a second turn that was stored only as a sum.
 */
function tieredReport({ asSum = false } = {}) {
  const h = harness();
  h.clock.now = NOW;
  h.prices.models = { "claude-haiku-5-5": TIERED };
  h.prices.origin = "models.dev";
  h.prices.meta = { ...h.prices.meta, modelsDevAt: NOW - 3 * 3_600_000 };
  addThread(h, "thr_t");
  const requests = [req(40_000), req(100_001)];
  h.store.putTurns("thr_t", [
    turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "claude-haiku-5-5", tokens: tokens({ input: 140_001 }), requests }),
    ...(asSum
      ? [turnRecord({ turnId: "b", startedAt: T0 + 5 * MIN, completedAt: T0 + 6 * MIN, model: "claude-haiku-5-5", tokens: tokens({ input: 250_000 }) })]
      : []),
  ]);
  return h.model.report("thr_t");
}

async function show(report: ReturnType<typeof tieredReport>) {
  await act(async () => {
    render(<Report report={report} />);
  });
}

const openTurn = (n: number) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Turn ${n}:`) }));

describe("a turn's tier on the Usage tab", () => {
  it("names no tier until a turn is opened", async () => {
    await show(tieredReport());
    expect(document.body.textContent).not.toMatch(/tier/i);
  });

  it("says how many of the opened turn's requests used the tier, lists the one that did in order, and lumps the rest", async () => {
    await show(tieredReport());
    openTurn(1);
    expect(screen.getByText("1 of 2 requests used the tier over 100,000 tokens")).toBeTruthy();
    const item = screen.getByText("Request 2").closest("li")!;
    expect(within(item).getByText("100,001 prompt tokens")).toBeTruthy();
    expect(within(item).getByText("tier over 100,000")).toBeTruthy();
    // 100,001 × $0.50/M of input at the tier's rate.
    expect(within(item).getByText("$0.05")).toBeTruthy();
    expect(screen.queryByText("Request 1")).toBeNull();
    expect(screen.getByText("1 request without a tier")).toBeTruthy();
    expect(screen.getByText("$0.0040")).toBeTruthy();
  });

  it("explains the mark on hover or focus: the whole request is charged at the tier's rates, output included", async () => {
    await show(tieredReport());
    openTurn(1);
    const mark = screen.getByText("tier over 100,000");
    // The tooltip opens on focus reached from the keyboard.
    await act(async () => {
      fireEvent.keyDown(document, { key: "Tab" });
      fireEvent.focus(mark);
    });
    expect((await screen.findAllByText("A prompt over 100,000 tokens is charged at that tier's rates for the whole request, output included.")).length).toBeGreaterThan(0);
  });

  it("keeps an approximate turn's details as they were: no request list and no tier mark", async () => {
    await show(tieredReport({ asSum: true }));
    openTurn(2);
    expect(screen.getByText(/approximate/)).toBeTruthy();
    expect(screen.queryByText(/requests used/)).toBeNull();
    expect(screen.queryByText(/tier over/)).toBeNull();
    expect(screen.queryByText(/Request \d/)).toBeNull();
  });

  it("keeps the By-model cost free of any tier, naming models.dev as where its price came from", async () => {
    clockAt(NOW);
    await show(tieredReport({ asSum: true }));
    const row = screen.getByTitle("claude-haiku-5-5").closest("tr")!;
    expect(row.textContent).not.toMatch(/tier/i);
    expect(within(row).getByText("models.dev")).toBeTruthy();
    expect(screen.getByText("Estimated with models.dev prices, fetched 3 hours ago")).toBeTruthy();
  });
});

describe("a turn's 1-hour cache writes on the Usage tab", () => {
  it("shows them as a line of their own on an opened turn that used no tier", async () => {
    const h = harness();
    h.clock.now = NOW;
    h.prices.models = { "claude-haiku-5-5": TIERED };
    addThread(h, "thr_h");
    h.store.upsertLogEntries("thr_h", [logEntry({ key: "w", ts: T0 + MIN + SEC, model: "claude-haiku-5-5", tokens: tokens({ cacheWrite: 1_000, cacheWrite1h: 500 }) })]);
    h.store.putTurns("thr_h", [
      turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "claude-haiku-5-5", tokens: tokens({ input: 10_000, cacheWrite: 1_000 }), requests: [req(10_000, { cacheWrite: 1_000 })] }),
    ]);
    await show(h.model.report("thr_h"));
    openTurn(1);
    const line = screen.getByText("1-hour cache writes, 500 tokens").parentElement!;
    // Twice the base input rate: 500 × $0.20 per M.
    expect(within(line).getByText("$0.0001")).toBeTruthy();
    expect(screen.queryByText(/requests used/)).toBeNull();
  });
});

describe("Data quality for turns with no per-request prompt sizes", () => {
  it("says a long-context tier cannot be applied to them, and that turns whose sizes are known are priced per request", async () => {
    await show(tieredReport({ asSum: true }));
    expect(screen.getByText(/have no per-request prompt sizes, because they were stored as a sum, filled from bb's running total, or are an opening balance, so a long-context tier cannot be applied and their dollars may be low\. Turns whose per-request sizes are known are priced per request\./)).toBeTruthy();
  });

  it("says nothing of it where every turn's request sizes are known", async () => {
    await show(tieredReport());
    expect(screen.queryByText(/per-request prompt sizes/)).toBeNull();
  });
});

describe("what the Usage tab no longer says", () => {
  it("shows no gateway banner, API time, tokens outside bb's view, attribution line or LiteLLM text", async () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "thr_s");
    h.store.putTurns("thr_s", [turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 5_000 }) })]);
    h.store.upsertLogEntries("thr_s", [logEntry({ key: "s", agentId: "agent-a", ts: T0 + 10 * MIN, model: "test-model", tokens: tokens({ input: 10 }) })]);
    await show(h.model.report("thr_s"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/API time|outside bb's view|gateway|litellm|tagged|attribution|price override/i);
    // The subagent request outside every turn is still a bar, named Outside turns.
    expect(screen.getByRole("button", { name: /^Outside turns:/ })).toBeTruthy();
  });

  it("names the bundled copy as the source, and says it has not been fetched yet, until a fetch succeeded", async () => {
    clockAt(NOW);
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "thr_b");
    h.store.putTurns("thr_b", [turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 5_000 }) })]);
    await show(h.model.report("thr_b"));
    expect(within(screen.getByTitle("test-model").closest("tr")!).getByText("models.dev, bundled")).toBeTruthy();
    expect(screen.getByText(/Estimated with the models.dev list bundled with the plugin \(2026-05-01\); it has not been fetched yet/)).toBeTruthy();
  });

  it("leads with the token count and says the tokens are not priced when the model has no price", async () => {
    const h = harness();
    h.clock.now = NOW;
    addThread(h, "thr_u");
    h.store.putTurns("thr_u", [turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "my-internal-model", tokens: tokens({ input: 45_000 }) })]);
    await show(h.model.report("thr_u"));
    expect(screen.getByText("45k tokens", { selector: "div.text-3xl" })).toBeTruthy();
    expect(screen.getByText("The tokens are not priced")).toBeTruthy();
    const note = screen.getByText(/my-internal-model has no price/);
    expect(note.textContent).toContain("models.dev");
    expect(note.textContent).not.toMatch(/override/i);
  });

  it("says that the last refresh failed, and why", async () => {
    clockAt(NOW);
    const h = harness();
    h.clock.now = NOW;
    h.prices.meta = { ...h.prices.meta, modelsDevAt: NOW - 9 * 24 * 3_600_000, lastError: "HTTP 503" };
    addThread(h, "thr_f");
    h.store.putTurns("thr_f", [turnRecord({ turnId: "a", startedAt: T0 + MIN, completedAt: T0 + 2 * MIN, model: "test-model", tokens: tokens({ input: 5_000 }) })]);
    await show(h.model.report("thr_f"));
    expect(screen.getByText(/fetched 9 days ago.*more than a week old.*The last refresh failed: HTTP 503/)).toBeTruthy();
  });
});
