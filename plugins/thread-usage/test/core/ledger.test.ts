import { describe, expect, it } from "vitest";
import {
  countDiffLines,
  EMPTY_CURSOR,
  ingestEvents,
  OPENING_TURN_ID,
  slimEvent,
  type IngestResult,
  type LedgerCursor,
  type LedgerEvent,
  type TurnRecord,
} from "../../src/core/ledger";
import { addTokens, fromBbBreakdown, ZERO_TOKENS, type Tokens } from "../../src/core/tokens";
import {
  accepted,
  claudeBreakdown as cb,
  completed,
  ev,
  fileChange,
  identity,
  MIN,
  requested,
  SEC,
  started,
  T0,
  tokens,
  usage,
} from "./fixtures";

/** Runs one read and merges the changed turns into `store`. */
function read(
  cursor: LedgerCursor,
  store: Map<string, TurnRecord>,
  events: LedgerEvent[],
  now: number,
  latestSeq = Math.max(cursor.lastSeq, ...events.map((e) => e.seq)),
): IngestResult {
  const result = ingestEvents({ cursor, turns: store, events, latestSeq, now });
  for (const [id, t] of result.turns) store.set(id, t);
  return result;
}

function sum(store: Map<string, TurnRecord>): Tokens {
  return [...store.values()].reduce((acc, t) => addTokens(acc, t.tokens), ZERO_TOKENS);
}

/** A complete turn with one usage event: 5 events starting at `seq`. */
function turn(seq: number, at: number, id: string, last: ReturnType<typeof cb>, total: ReturnType<typeof cb>) {
  return [
    requested(seq, at, `req-${id}`, "claude-opus-5-5"),
    accepted(seq + 1, at + 10, id, `req-${id}`),
    started(seq + 2, at + 20, id),
    usage(seq + 3, at + 5 * SEC, id, last, total),
    completed(seq + 4, at + 6 * SEC, id),
  ];
}

describe("ingestEvents: per-turn tokens", () => {
  it("sums each usage event's last per turn", () => {
    const store = new Map<string, TurnRecord>();
    const events = [
      started(1, T0, "t1"),
      usage(2, T0 + 1, "t1", cb({ input: 10, output: 5, cacheRead: 100 }), cb({ input: 10, output: 5, cacheRead: 100 })),
      usage(3, T0 + 2, "t1", cb({ input: 20, output: 7, cacheWrite: 50 }), cb({ input: 30, output: 12, cacheRead: 100, cacheWrite: 50 })),
      completed(4, T0 + 3, "t1"),
    ];
    read(EMPTY_CURSOR, store, events, T0 + MIN);
    const t1 = store.get("t1")!;
    expect(t1.tokens).toEqual(tokens({ input: 30, output: 12, cacheRead: 100, cacheWrite: 50 }));
    expect(t1.usageEvents).toBe(2);
    expect(t1.status).toBe("completed");
    expect(t1.startedAt).toBe(T0);
    expect(t1.completedAt).toBe(T0 + 3);
  });

  it("scenario 1: a harness restart resets bb's total, but the sum of lasts stays right", () => {
    const store = new Map<string, TurnRecord>();
    const events = [
      identity(1, T0, "sess-a"),
      ...turn(2, T0 + SEC, "t1", cb({ input: 100, output: 50 }), cb({ input: 100, output: 50 })),
      ...turn(7, T0 + MIN, "t2", cb({ input: 200, output: 60 }), cb({ input: 300, output: 110 })),
      identity(12, T0 + 2 * MIN, "sess-b"),
      // After the restart bb's running total starts again from zero.
      ...turn(13, T0 + 3 * MIN, "t3", cb({ input: 400, output: 70 }), cb({ input: 400, output: 70 })),
    ];
    const result = read(EMPTY_CURSOR, store, events, T0 + 10 * MIN);
    expect(sum(store)).toEqual(tokens({ input: 700, output: 180 }));
    expect(result.cursor.lastTotal).toEqual(tokens({ input: 400, output: 70 }));
    expect(result.cursor.sessionIds).toEqual(["sess-a", "sess-b"]);
    expect(result.opened).toBe(false);
    expect(result.gaps).toEqual([]);
  });

  it("gives the same totals when the same events arrive one notification at a time", () => {
    const events = [
      identity(1, T0, "sess-a"),
      ...turn(2, T0 + SEC, "t1", cb({ input: 100, output: 50 }), cb({ input: 100, output: 50 })),
      identity(7, T0 + MIN, "sess-b"),
      ...turn(8, T0 + 2 * MIN, "t2", cb({ input: 200, output: 60 }), cb({ input: 200, output: 60 })),
    ];
    const store = new Map<string, TurnRecord>();
    let cursor = EMPTY_CURSOR;
    for (const e of events) cursor = read(cursor, store, [e], e.createdAt).cursor;
    expect(sum(store)).toEqual(tokens({ input: 300, output: 110 }));
  });

  it("skips events at or below the cursor, so a re-read never double counts", () => {
    const store = new Map<string, TurnRecord>();
    const events = turn(1, T0, "t1", cb({ input: 100, output: 50 }), cb({ input: 100, output: 50 }));
    const first = read(EMPTY_CURSOR, store, events, T0 + MIN);
    const again = read(first.cursor, store, events, T0 + 2 * MIN);
    expect(again.turns.size).toBe(0);
    expect(sum(store)).toEqual(tokens({ input: 100, output: 50 }));
  });
});

describe("ingestEvents: plugin downtime gap (scenario 2)", () => {
  // First read: turn t1 with bb total {100 in, 50 out}.
  const firstRead = () => {
    const store = new Map<string, TurnRecord>();
    const r = read(EMPTY_CURSOR, store, turn(1, T0, "t1", cb({ input: 100, output: 50 }), cb({ input: 100, output: 50 })), T0 + 10 * SEC);
    return { store, cursor: r.cursor };
  };
  // While the plugin was down: t2 lost its usage events to pruning; t3's one snapshot survived.
  const downtime = (extra: LedgerEvent[] = []) =>
    [
      started(10, T0 + MIN, "t2"),
      completed(100, T0 + 2 * MIN, "t2"),
      ...extra,
      started(200, T0 + 3 * MIN, "t3"),
      usage(290, T0 + 3 * MIN + 5 * SEC, "t3", cb({ input: 50, output: 5 }), cb({ input: 450, output: 95 })),
      completed(300, T0 + 4 * MIN, "t3"),
    ].sort((a, b) => a.seq - b.seq);

  it("fills the gap from bb's total when no identity event fell inside it", () => {
    const { store, cursor } = firstRead();
    const r = read(cursor, store, downtime(), T0 + 10 * MIN);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ turnIds: ["t2"], resolution: "filled", fromMs: T0 + MIN, toMs: T0 + 2 * MIN });
    const t2 = store.get("t2")!;
    expect(t2.filled).toBe(true);
    expect(t2.partial).toBe(false);
    expect(t2.tokens).toEqual(tokens({ input: 300, output: 40 }));
    // Complete, and not counted twice: the ledger equals bb's surviving total.
    expect(sum(store)).toEqual(tokens({ input: 450, output: 95 }));
  });

  it("spreads the gap evenly over several missing turns", () => {
    const { store, cursor } = firstRead();
    const events = [...downtime(), started(20, T0 + 90 * SEC, "t2b"), completed(30, T0 + 100 * SEC, "t2b")].sort(
      (a, b) => a.seq - b.seq,
    );
    const r = read(cursor, store, events, T0 + 10 * MIN);
    expect(r.gaps[0]!.turnIds.sort()).toEqual(["t2", "t2b"]);
    expect(store.get("t2")!.tokens).toEqual(tokens({ input: 150, output: 20 }));
    expect(sum(store)).toEqual(tokens({ input: 450, output: 95 }));
  });

  it("marks the gap partial when a harness restart (identity event) fell inside it", () => {
    const { store, cursor } = firstRead();
    const r = read(cursor, store, downtime([identity(150, T0 + 150 * SEC, "sess-b")]), T0 + 10 * MIN);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.resolution).toBe("partial");
    expect(store.get("t2")!.partial).toBe(true);
    expect(store.get("t2")!.filled).toBe(false);
    expect(store.get("t2")!.tokens).toEqual(ZERO_TOKENS);
    // t3's own last is still counted once.
    expect(sum(store)).toEqual(tokens({ input: 150, output: 55 }));
  });

  it("marks the gap partial when the restart came after the cursor but before the missing turn", () => {
    // The total reset at seq 5..9, so `total - stored total` no longer measures the gap.
    const { store, cursor } = firstRead();
    const r = read(cursor, store, downtime([identity(8, T0 + 50 * SEC, "sess-b")]), T0 + 10 * MIN);
    expect(r.gaps[0]!.resolution).toBe("partial");
    expect(store.get("t2")!.filled).toBe(false);
  });

  it("does not treat a short span (< 250 seq) as pruned", () => {
    const { store, cursor } = firstRead();
    const events = [
      started(10, T0 + MIN, "t2"),
      completed(20, T0 + 2 * MIN, "t2"),
      started(30, T0 + 3 * MIN, "t3"),
      usage(40, T0 + 3 * MIN, "t3", cb({ input: 50, output: 5 }), cb({ input: 150, output: 55 })),
      completed(50, T0 + 4 * MIN, "t3"),
    ];
    const r = read(cursor, store, events, T0 + 10 * MIN);
    expect(r.gaps).toEqual([]);
    expect(store.get("t2")!.filled).toBe(false);
  });

  it("does not treat a turn completed less than 30 s ago as pruned", () => {
    const { store, cursor } = firstRead();
    const r = read(cursor, store, downtime(), T0 + 2 * MIN + 20 * SEC);
    expect(r.gaps).toEqual([]);
  });
});

describe("ingestEvents: first sight", () => {
  it("scenario 8: pruned history becomes a partial opening balance", () => {
    const store = new Map<string, TurnRecord>();
    const events = [
      identity(1, T0, "sess-a"),
      requested(2, T0, "req-1", "claude-opus-5-5"),
      accepted(3, T0, "t1", "req-1"),
      started(4, T0 + SEC, "t1"),
      completed(5, T0 + MIN, "t1"),
      started(300, T0 + 5 * MIN, "t2"),
      usage(301, T0 + 5 * MIN, "t2", cb({ input: 10, output: 5 }), cb({ input: 500, output: 200 })),
      completed(302, T0 + 6 * MIN, "t2"),
    ];
    const now = T0 + 60 * MIN;
    const r = read(EMPTY_CURSOR, store, events, now);
    expect(r.opened).toBe(true);
    const opening = store.get(OPENING_TURN_ID)!;
    expect(opening.kind).toBe("opening");
    expect(opening.partial).toBe(true);
    // bb's total minus the lasts it already explains (since the latest harness start).
    expect(opening.tokens).toEqual(tokens({ input: 490, output: 195 }));
    expect(opening.completedAt).toBe(now);
    expect(r.cursor.firstSeenAt).toBe(now);
    // Turns keep the lasts that survived; nothing is counted twice.
    expect(store.get("t2")!.tokens).toEqual(tokens({ input: 10, output: 5 }));
    expect(sum(store)).toEqual(tokens({ input: 500, output: 200 }));
  });

  it("a thread first seen with complete history gets no opening balance", () => {
    const store = new Map<string, TurnRecord>();
    const events = [
      ...turn(1, T0, "t1", cb({ input: 100, output: 50 }), cb({ input: 100, output: 50 })),
      ...turn(6, T0 + MIN, "t2", cb({ input: 10, output: 5 }), cb({ input: 110, output: 55 })),
    ];
    const r = read(EMPTY_CURSOR, store, events, T0 + 60 * MIN);
    expect(r.opened).toBe(false);
    expect(store.has(OPENING_TURN_ID)).toBe(false);
    expect(sum(store)).toEqual(tokens({ input: 110, output: 55 }));
  });
});

describe("ingestEvents: model, lines, rate limits, routing", () => {
  it("takes the model from client/turn/requested via turn/input/accepted, and the prompt's first line", () => {
    const store = new Map<string, TurnRecord>();
    read(
      EMPTY_CURSOR,
      store,
      [
        requested(1, T0, "req-1", "claude-opus-5-5[1m]", "\n  Fix the build  \nsecond line"),
        accepted(2, T0, "t1", "req-1"),
        started(3, T0, "t1"),
        completed(4, T0 + SEC, "t1"),
      ],
      T0 + MIN,
    );
    expect(store.get("t1")!.model).toBe("claude-opus-5-5[1m]");
    expect(store.get("t1")!.prompt).toBe("Fix the build");
  });

  it("replaces the model with provider/modelFallback's fallbackModel", () => {
    const store = new Map<string, TurnRecord>();
    read(
      EMPTY_CURSOR,
      store,
      [
        requested(1, T0, "req-1", "claude-opus-5-5"),
        accepted(2, T0, "t1", "req-1"),
        started(3, T0, "t1"),
        ev(4, T0, "provider/modelFallback", "t1", { fallbackModel: "claude-sonnet-4-5" }),
        completed(5, T0 + SEC, "t1"),
      ],
      T0 + MIN,
    );
    expect(store.get("t1")!.model).toBe("claude-sonnet-4-5");
  });

  it("matches the request across reads (requested in one batch, accepted in the next)", () => {
    const store = new Map<string, TurnRecord>();
    const r1 = read(EMPTY_CURSOR, store, [requested(1, T0, "req-1", "gpt-5")], T0);
    expect(r1.cursor.pending["req-1"]).toBeDefined();
    const r2 = read(r1.cursor, store, [accepted(2, T0, "t1", "req-1"), started(3, T0, "t1")], T0 + SEC);
    expect(store.get("t1")!.model).toBe("gpt-5");
    expect(r2.cursor.pending["req-1"]).toBeUndefined();
  });

  it("counts lines from fileChange diffs, headers excluded", () => {
    const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+added\n context";
    expect(countDiffLines(diff)).toEqual({ added: 2, removed: 1 });
    const store = new Map<string, TurnRecord>();
    read(
      EMPTY_CURSOR,
      store,
      [started(1, T0, "t1"), fileChange(2, T0, "t1", [diff, "+one\n"]), ev(3, T0, "item/completed", "t1", { item: { type: "commandExecution" } }), completed(4, T0, "t1")],
      T0 + MIN,
    );
    const t1 = store.get("t1")!;
    expect(t1).toMatchObject({ linesAdded: 3, linesRemoved: 1, fileChanges: 1 });
  });

  it("gives the same record from slimmed events as from full ones", () => {
    const events = [
      requested(1, T0, "req-1", "claude-opus-5-5", "A long prompt\nwith more lines"),
      accepted(2, T0, "t1", "req-1"),
      started(3, T0, "t1"),
      fileChange(4, T0, "t1", ["--- a\n+++ b\n+x\n+y\n-z"]),
      usage(5, T0, "t1", cb({ input: 1, output: 2 }), cb({ input: 1, output: 2 })),
      ev(6, T0, "provider.env-resolved", null, {
        entries: [
          { name: "ANTHROPIC_BASE_URL", source: "shell", value: "https://gw.example.test" },
          { name: "SECRET_THING", source: "shell", value: "hidden" },
        ],
      }),
      completed(7, T0, "t1"),
    ];
    const full = new Map<string, TurnRecord>();
    const slim = new Map<string, TurnRecord>();
    const a = read(EMPTY_CURSOR, full, events, T0 + MIN);
    const b = read(EMPTY_CURSOR, slim, events.map(slimEvent), T0 + MIN);
    expect(slim.get("t1")).toEqual(full.get("t1"));
    expect(b.cursor).toEqual(a.cursor);
    // Slimming drops non-BASE_URL env entries and diff bodies.
    expect(JSON.stringify(events.map(slimEvent))).not.toContain("SECRET_THING");
  });

  it("records the rate-limit kind; unknown never replaces a known kind", () => {
    const rl = (seq: number, kind: string) => ev(seq, T0, "provider/rateLimits/updated", null, { rateLimits: { kind } });
    let r = read(EMPTY_CURSOR, new Map(), [rl(1, "subscription-window"), rl(2, "unknown")], T0);
    expect(r.cursor.rateLimitKind).toBe("subscription-window");
    r = read(r.cursor, new Map(), [rl(3, "spend-control")], T0);
    expect(r.cursor.rateLimitKind).toBe("spend-control");
    r = read(EMPTY_CURSOR, new Map(), [rl(1, "unknown")], T0);
    expect(r.cursor.rateLimitKind).toBe("unknown");
  });

  it("keeps BASE_URL routing facts with their source", () => {
    const r = read(
      EMPTY_CURSOR,
      new Map(),
      [
        ev(1, T0, "provider.env-resolved", null, {
          entries: [
            { name: "ANTHROPIC_BASE_URL", source: { plugin: "account-pool" }, value: null },
            { name: "CODEX_OPENAI_BASE_URL", source: { core: "provider" }, value: "https://api.example.test" },
            { name: "OPENAI_BASE_URL", source: "shell", value: "https://gw.example.test/v1" },
            { name: "ANTHROPIC_CUSTOM_HEADERS", source: { plugin: "thread-usage" }, value: "x: y" },
          ],
        }),
      ],
      T0,
    );
    expect(r.cursor.routing).toEqual([
      { name: "ANTHROPIC_BASE_URL", source: "plugin:account-pool", value: null },
      { name: "CODEX_OPENAI_BASE_URL", source: "core:provider", value: "https://api.example.test" },
      { name: "OPENAI_BASE_URL", source: "shell", value: "https://gw.example.test/v1" },
    ]);
  });
});

describe("fromBbBreakdown", () => {
  it("reads a Claude-style breakdown (input excludes cached)", () => {
    expect(
      fromBbBreakdown({
        totalTokens: 1150,
        inputTokens: 100,
        cachedInputTokens: 1000,
        cacheReadInputTokens: 800,
        cacheWriteInputTokens: 200,
        outputTokens: 50,
        reasoningOutputTokens: 0,
      }),
    ).toEqual(tokens({ input: 100, cacheRead: 800, cacheWrite: 200, output: 50 }));
  });

  it("reads an OpenAI-style breakdown (input includes cached)", () => {
    expect(
      fromBbBreakdown({
        totalTokens: 1150,
        inputTokens: 1100,
        cachedInputTokens: 1000,
        outputTokens: 50,
        reasoningOutputTokens: 20,
      }),
    ).toEqual(tokens({ input: 100, cacheRead: 1000, output: 50, reasoning: 20 }));
  });

  it("treats missing or negative counts as zero", () => {
    expect(
      fromBbBreakdown({ totalTokens: 5, inputTokens: -3, cachedInputTokens: 0, outputTokens: 5, reasoningOutputTokens: Number.NaN }),
    ).toEqual(tokens({ output: 5 }));
  });
});

describe("prompt first line", () => {
  it("reads bb's own and relayed messages as text", async () => {
    const { promptFirstLine } = await import("../../src/core/ledger");
    expect(promptFirstLine([{ type: "text", text: "[bb system]\n\n@thread:thr_x completed:" }])).toBe("bb: @thread:thr_x completed:");
    expect(promptFirstLine([{ type: "text", text: "[bb message from thread:thr_abc]\n\nPlease clean up" }])).toBe("from thr_abc: Please clean up");
    expect(promptFirstLine([{ type: "text", text: "Fix the bug\nmore" }])).toBe("Fix the bug");
  });
});
