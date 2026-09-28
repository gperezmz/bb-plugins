import { describe, expect, it } from "vitest";
import { hostContract, isTranscriptReply } from "./contract";

const facts = { lastRequestAt: 1, lifetime: "1h", context: 10, model: "m", requests: 1, userMessages: 0, lastCompaction: null };
const cursor = { cwdSlug: "-work", ino: 3, offset: 10, fold: { facts, lastKey: null, contextAt: null, keeperTurn: false, awaitingRequest: false } };
const reply = { found: true, cwdSlug: "-work", cursor, facts, requests: [{ at: 1, model: "m", input: 1, output: 1, cacheRead: 1, cacheWrite5m: 0, cacheWrite1h: 1 }], bytesRead: 10, unreadable: null };

describe("the host contract's hand-written checks", () => {
  it("accepts a whole transcript read and refuses one missing or mistyping a field", () => {
    expect(isTranscriptReply(reply)).toBe(true);
    expect(hostContract.transcript.output.safeParse(reply).success).toBe(true);
    for (const broken of [
      { ...reply, found: undefined },
      { ...reply, facts: { ...facts, requests: "1" } },
      { ...reply, facts: { ...facts, lifetime: "2h" } },
      { ...reply, cursor: { ...cursor, offset: -1 } },
      { ...reply, cursor: { ...cursor, cwdSlug: "../etc" } },
      { ...reply, requests: [{ at: 1 }] },
      { ...reply, bytesRead: null },
    ]) {
      expect(isTranscriptReply(broken)).toBe(false);
      expect(hostContract.transcript.output.safeParse(broken).success).toBe(false);
    }
  });

  it("refuses a cursor or session that could name a path outside the project directory", () => {
    const input = (over: object) => hostContract.transcript.input.safeParse({ sessionId: "s1", cursor, jumps: [], ...over }).success;
    expect(input({})).toBe(true);
    expect(input({ cursor: null })).toBe(true);
    expect(input({ cursor: { ...cursor, cwdSlug: "a/b" } })).toBe(false);
    expect(input({ sessionId: "../x" })).toBe(false);
    expect(input({ jumps: [{ at: 1 }] })).toBe(false);
  });
});
