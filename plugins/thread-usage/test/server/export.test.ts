import { describe, expect, it } from "vitest";
import { csvCell, reportMarkdown, turnsCsv } from "../../src/core/export";
import { EMPTY_CURSOR } from "../../src/core/ledger";
import { gatewayRow, MIN, T0, tokens, turnRecord } from "../core/fixtures";
import { harness } from "./harness";

/** A thread with three turns (one with a tricky prompt), an opening balance and a request outside turns. */
function report() {
  const h = harness({ adapter: "litellm", gatewayUrl: "https://gw.example.test" });
  h.clock.now = T0 + 60 * MIN;
  h.store.upsertEdge({ threadId: "thr_x", providerId: "claude-code", title: "Export | test" }, T0);
  h.store.putThread(
    { threadId: "thr_x", cursor: EMPTY_CURSOR, firstSeenAt: T0, gaps: [], historyBackfilled: false, logsReadThrough: null, logsMissingHost: null, logsMissingSince: null, lastActivityAt: T0 },
    T0,
  );
  const turns = [1, 2, 3].map((i) =>
    turnRecord({
      turnId: `turn-${i}`,
      startedAt: T0 + i * 10 * MIN,
      completedAt: T0 + i * 10 * MIN + MIN,
      model: "test-model",
      prompt: i === 2 ? 'Fix "quotes", commas | pipes' : `prompt ${i}`,
      tokens: tokens({ input: 1000 * i, output: 10 }),
    }),
  );
  h.store.putTurns("thr_x", [
    ...turns,
    turnRecord({ turnId: "opening", kind: "opening", startedAt: T0, completedAt: T0, partial: true, model: "test-model", tokens: tokens({ input: 5 }) }),
  ]);
  h.store.upsertGatewayRows([gatewayRow({ threadId: "thr_x", requestId: "between", startTime: T0 + 15 * MIN, spend: 0.01 })]);
  return h.model.report("thr_x");
}

describe("export (scenario 19)", () => {
  it("CSV has one row per turn record, with every turn id", () => {
    const r = report();
    const csv = turnsCsv(r.turns);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^turn_id,kind,/);
    expect(lines).toHaveLength(1 + r.turns.length);
    expect(r.turns.map((t) => t.turnId).sort()).toEqual(["opening", "outside", "turn-1", "turn-2", "turn-3"]);
    for (const t of r.turns) expect(lines.some((l) => l.startsWith(`${t.turnId},`))).toBe(true);
    // No prompt text: rows are labelled by turn number instead.
    for (const p of ["prompt 1", "Fix", "prompt 3"]) expect(csv).not.toContain(p);
    expect(csv).toContain(",Turn 1,");
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("Markdown contains every turn", () => {
    const r = report();
    const md = reportMarkdown(r, "thread");
    const rows = md.split("\n").filter((l) => r.turns.some((t) => l.includes(`| ${t.turnId} |`)));
    expect(rows).toHaveLength(r.turns.length);
    for (const p of ["prompt 1", "Fix", "prompt 3"]) expect(md).not.toContain(p);
    expect(md).toContain("# Usage: Export \\| test");
  });
});

describe("titles built from the first prompt", () => {
  it("stay out of the Markdown export, which uses the thread id", async () => {
    const { edgeFromDto } = await import("../../src/server/engine");
    const h = harness();
    h.clock.now = T0 + 60 * MIN;
    h.store.upsertEdge(edgeFromDto({ id: "thr_p", title: null, titleFallback: "sk-secret pasted in the first prompt" }), T0);
    h.store.upsertEdge(edgeFromDto({ id: "thr_c", parentThreadId: "thr_p", title: null, titleFallback: "another prompt line" }), T0);
    expect(h.store.getEdge("thr_p")!.titleFromPrompt).toBe(true);
    const md = reportMarkdown(h.model.report("thr_p"), "family");
    expect(md).not.toContain("sk-secret");
    expect(md).not.toContain("another prompt line");
    expect(md).toContain("# Usage: thr_p");
    // An explicit title is kept.
    h.store.upsertEdge(edgeFromDto({ id: "thr_p", title: "Named thread" }), T0);
    h.model.invalidate(["thr_p"]);
    expect(reportMarkdown(h.model.report("thr_p"), "thread")).toContain("# Usage: Named thread");
  });
});
