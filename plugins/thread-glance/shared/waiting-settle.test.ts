import { describe, expect, it } from "vitest";
import { endingTurn, waitingSettleVerdict, type TurnRecord, type WaitingTreeThread } from "./waiting-settle";

const SINCE = 10_000;

function thread(id: string, overrides: Partial<WaitingTreeThread> = {}): WaitingTreeThread {
  return {
    id,
    pinnedAt: null,
    hidden: false,
    hasPendingInteraction: false,
    queuedWork: "none",
    status: "idle",
    runtimeStatus: "idle",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    ...overrides,
  };
}

describe("waitingSettleVerdict", () => {
  it("waits while any thread is busy, queued work and a hidden helper's work included, and lands once none is", () => {
    expect(waitingSettleVerdict([thread("p"), thread("c", { status: "active" })], SINCE)).toEqual({ kind: "wait" });
    expect(waitingSettleVerdict([thread("p", { queuedWork: "waiting" })], SINCE)).toEqual({ kind: "wait" });
    expect(waitingSettleVerdict([thread("p"), thread("h", { hidden: true, activity: { ...thread("x").activity, backgroundAgents: 1 } })], SINCE)).toEqual({
      kind: "wait",
    });
    expect(waitingSettleVerdict([thread("p"), thread("c")], SINCE)).toEqual({ kind: "land" });
  });

  it("ends on a pin made since, a question or approval, or a failed send in the tree, but a hidden helper's question only holds it", () => {
    expect(waitingSettleVerdict([thread("p"), thread("c", { pinnedAt: SINCE + 1, status: "active" })], SINCE)).toEqual({ kind: "end", reason: "pinned" });
    expect(waitingSettleVerdict([thread("p"), thread("c", { pinnedAt: SINCE, status: "active" })], SINCE)).toEqual({ kind: "wait" });
    expect(waitingSettleVerdict([thread("p", { pinnedAt: SINCE - 1 })], SINCE)).toEqual({ kind: "land" });
    expect(waitingSettleVerdict([thread("p"), thread("c", { queuedWork: "failed" })], SINCE)).toEqual({ kind: "end", reason: "failed" });
    expect(waitingSettleVerdict([thread("p"), thread("c", { hasPendingInteraction: true })], SINCE)).toEqual({ kind: "end", reason: "needs-you" });
    expect(waitingSettleVerdict([thread("p"), thread("h", { hidden: true, hasPendingInteraction: true })], SINCE)).toEqual({ kind: "wait" });
  });

  it("ends on a turn of the user's or a failed or interrupted turn since the settle was chosen", () => {
    const tree = [thread("p"), thread("c", { status: "active" })];
    expect(waitingSettleVerdict(tree, SINCE, [{ kind: "requested", at: SINCE + 1, byUser: true }])).toEqual({ kind: "end", reason: "yours" });
    expect(waitingSettleVerdict(tree, SINCE, [{ kind: "ended", at: SINCE + 1, outcome: "interrupted" }])).toEqual({ kind: "end", reason: "failed" });
    expect(waitingSettleVerdict([thread("p")], SINCE, [{ kind: "ended", at: SINCE + 1, outcome: "failed" }])).toEqual({ kind: "end", reason: "failed" });
  });
});

describe("endingTurn", () => {
  it("leaves an agent's and bb's own turns, a turn that simply ended, and anything before the settle", () => {
    const turns: TurnRecord[] = [
      { kind: "requested", at: SINCE + 5, byUser: false },
      { kind: "ended", at: SINCE + 6, outcome: "completed" },
      { kind: "requested", at: SINCE, byUser: true },
      { kind: "ended", at: SINCE - 1, outcome: "failed" },
    ];
    expect(endingTurn(turns, SINCE)).toBeNull();
  });
});
