import { describe, expect, it } from "vitest";
import { seenWaits, seenKey } from "./waits-seen";

const thread = (id: string, waits: { asks?: boolean; queuedFailed?: boolean } = { asks: true }) => ({
  id,
  hasPendingInteraction: waits.asks === true,
  indicator: waits.queuedFailed === true ? ("queued-failed" as const) : ("none" as const),
});
const q = (id: string) => seenKey("question", id);
const f = (id: string) => seenKey("queued-failed", id);

describe("seenWaits", () => {
  it("adds the open thread's question while it asks, and keeps it once you move away", () => {
    const opened = seenWaits(new Set(), [thread("a"), thread("b")], "a");
    expect([...opened]).toEqual([q("a")]);
    expect(seenWaits(opened, [thread("a"), thread("b")], "b")).toEqual(new Set([q("a"), q("b")]));
    expect(seenWaits(opened, [thread("a"), thread("b")], null)).toBe(opened);
  });

  it("adds nothing for an open thread with nothing waiting", () => {
    expect(seenWaits(new Set(), [thread("a", {})], "a").size).toBe(0);
  });

  it("forgets a question once it clears, so the next one is unseen", () => {
    const opened = seenWaits(new Set(), [thread("a")], "a");
    const cleared = seenWaits(opened, [thread("a", {})], null);
    expect(cleared.size).toBe(0);
    expect(seenWaits(cleared, [thread("a")], null).size).toBe(0);
  });

  it("keeps a queued failure apart from a question: each is forgotten when it clears", () => {
    const opened = seenWaits(new Set(), [thread("a", { asks: true, queuedFailed: true })], "a");
    expect(opened).toEqual(new Set([q("a"), f("a")]));
    expect(seenWaits(opened, [thread("a", { queuedFailed: true })], null)).toEqual(new Set([f("a")]));
  });

  it("keeps what was seen on a thread the list does not have, which another window may list", () => {
    const seen = new Set([q("a")]);
    expect(seenWaits(seen, [thread("b")], null)).toBe(seen);
  });
});
