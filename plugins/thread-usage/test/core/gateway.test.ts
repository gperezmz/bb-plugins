import { describe, expect, it } from "vitest";
import {
  assignRowsToTurns,
  isUnpricedRow,
  OUTSIDE_TURNS,
  sessionIdFor,
  threadIdFromSession,
  TURN_GRACE_MS,
} from "../../src/core/gateway";
import { gatewayRow, SEC, T0 } from "./fixtures";

const ids = (m: Map<string, { requestId: string }[]>) =>
  Object.fromEntries([...m].map(([k, v]) => [k, v.map((r) => r.requestId).sort()]));

describe("assignRowsToTurns", () => {
  const turns = [
    { turnId: "t2", startedAt: T0 + 70 * SEC, completedAt: T0 + 120 * SEC },
    { turnId: "t1", startedAt: T0, completedAt: T0 + 60 * SEC },
    { turnId: "t3", startedAt: T0 + 300 * SEC, completedAt: null },
  ];
  const now = T0 + 500 * SEC;

  it("puts each row in the turn whose [started, completed + 30 s] window holds its start time", () => {
    const rows = [
      gatewayRow({ requestId: "in-t1", startTime: T0 + 10 * SEC }),
      gatewayRow({ requestId: "t1-start", startTime: T0 }),
      gatewayRow({ requestId: "t1-grace", startTime: T0 + 65 * SEC }),
      gatewayRow({ requestId: "t2-grace", startTime: T0 + 120 * SEC + TURN_GRACE_MS }),
      gatewayRow({ requestId: "running", startTime: T0 + 400 * SEC }),
    ];
    expect(ids(assignRowsToTurns(rows, turns, now))).toEqual({
      t1: ["in-t1", "t1-grace", "t1-start"],
      t2: ["t2-grace"],
      t3: ["running"],
    });
  });

  it("sends rows outside every window to Outside turns", () => {
    const rows = [
      gatewayRow({ requestId: "before", startTime: T0 - SEC }),
      gatewayRow({ requestId: "between", startTime: T0 + 120 * SEC + TURN_GRACE_MS + 1 }),
      gatewayRow({ requestId: "later", startTime: T0 + 250 * SEC }),
    ];
    expect(ids(assignRowsToTurns(rows, turns, now))).toEqual({ [OUTSIDE_TURNS]: ["before", "between", "later"] });
  });

  it("prefers the turn that strictly contains the row over a previous turn's grace period", () => {
    const rows = [gatewayRow({ requestId: "overlap", startTime: T0 + 75 * SEC })];
    expect(ids(assignRowsToTurns(rows, turns, now))).toEqual({ t2: ["overlap"] });
  });
});

describe("session ids", () => {
  it("round-trips a bb thread id", () => {
    expect(sessionIdFor("thr_abc123")).toBe("bb-thr_abc123");
    expect(threadIdFromSession(sessionIdFor("thr_abc123"))).toBe("thr_abc123");
    expect(threadIdFromSession(" bb-thr_a-b_c ")).toBe("thr_a-b_c");
  });

  it("rejects session ids that only contain the prefix (the gateway match is a substring)", () => {
    for (const s of ["bb-thr_", "xbb-thr_abc", "bb-thr_abc/other", "bb-other", "claude-session-uuid", "", null, undefined]) {
      expect(threadIdFromSession(s), String(s)).toBeNull();
    }
  });
});

describe("isUnpricedRow", () => {
  it("is true for spend 0 with output tokens, false otherwise", () => {
    expect(isUnpricedRow(gatewayRow({ requestId: "a", startTime: T0, spend: 0, completionTokens: 10 }))).toBe(true);
    expect(isUnpricedRow(gatewayRow({ requestId: "b", startTime: T0, spend: 0, completionTokens: 0 }))).toBe(false);
    expect(isUnpricedRow(gatewayRow({ requestId: "c", startTime: T0, spend: 0.1, completionTokens: 10 }))).toBe(false);
  });
});
