import { describe, expect, it } from "vitest";
import { checkInText, COMPACT_MESSAGE, cut, duration, joinAnd, keepWarmText } from "./messages";
import { isWaiting, waitingChildren, type WaitThread } from "./waiting";

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

describe("messages", () => {
  it("sends /compact with the fixed additions", () => {
    expect(COMPACT_MESSAGE).toBe(
      "/compact Also record: approaches that were tried or considered and ruled out, with the reason for each; decisions taken and the reason for each; commands verified to work. If your last message asks the user something, quote the question verbatim with each option and what choosing it would mean.",
    );
  });

  it("joins entries the way a sentence would", () => {
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
  });

  it("cuts descriptions to 60 characters ending in an ellipsis", () => {
    const long = "x".repeat(80);
    expect(cut(long)).toHaveLength(60);
    expect(cut(long).endsWith("…")).toBe(true);
    expect(cut("short")).toBe("short");
  });

  it("writes durations in minutes, then hours and minutes", () => {
    expect(duration(14 * 60_000 + 59_000)).toBe("14 minutes");
    expect(duration(75 * 60_000)).toBe("1 h 15 min");
  });

  it("lists what a thread waits on in kind order, oldest first", () => {
    const text = keepWarmText(
      [
        { kind: "queued", createdAt: 1 },
        { kind: "child", id: "thr_b", title: "Second child", startedAt: 5 },
        { kind: "scheduled", dueAt: Date.UTC(2026, 0, 1, 14, 30), createdAt: 0 },
        { kind: "subagent", id: "a1", description: "Explore", startedAt: 2 },
        { kind: "child", id: "thr_a", title: "First child", startedAt: 3 },
        { kind: "command", id: "b1", description: "npm test", startedAt: 9 },
      ],
      clock,
    );
    expect(text).toBe(
      'Still waiting on background command b1 ("npm test"), background subagent a1 ("Explore"), child thread thr_a ("First child"), child thread thr_b ("Second child"), a scheduled message due at 14:30 and a queued message. Nothing to do yet, just reply "OK".',
    );
  });

  it("writes one paragraph per task and the closing line", () => {
    const text = checkInText([
      { kind: "subagent", reason: "routine", id: "a1", description: "Explore", startedAt: 1, quietMs: 0, runningMs: 30 * 60_000, lastTool: "Grep" },
      { kind: "command", reason: "stalled", id: "b1", description: "npm test", startedAt: 2, quietMs: 15 * 60_000, runningMs: 0, outputFile: "/tmp/b1.output" },
    ]);
    expect(text.split("\n\n")).toEqual([
      `Background command b1 ("npm test") hasn't printed anything in 15 minutes. Can you check it's still moving? Its output is in /tmp/b1.output. If it's stuck, stop it, fix whatever's blocking it and keep going with the task. If it's fine, leave it running.`,
      `Background subagent a1 ("Explore") has been running 30 minutes; its last tool was Grep. Check it's on track. If it's going in circles, stop it and take over that part. If it's fine, leave it.`,
      "Tell me in a line what you found. Don't wait for me either way.",
    ]);
  });
});

const thread = (over: Partial<WaitThread> & { id: string }): WaitThread => ({
  parentThreadId: null,
  status: "idle",
  archived: false,
  deleted: false,
  title: over.id,
  createdAt: 0,
  activeBackgroundCommandCount: 0,
  activeBackgroundAgentCount: 0,
  queuedMessageCount: 0,
  ...over,
});

describe("waiting", () => {
  it("waits on its own background work and queued messages", () => {
    expect(isWaiting(thread({ id: "p", activeBackgroundCommandCount: 1 }), [])).toBe(true);
    expect(isWaiting(thread({ id: "p", queuedMessageCount: 1 }), [])).toBe(true);
    expect(isWaiting(thread({ id: "p" }), [])).toBe(false);
  });

  it("waits on a working child, or a child that is itself waiting through a grandchild", () => {
    const p = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const grandchild = thread({ id: "g", parentThreadId: "c", status: "active" });
    expect(waitingChildren("p", [p, child, grandchild]).map((t) => t.id)).toEqual(["c"]);
    expect(isWaiting(p, [p, child])).toBe(false);
    expect(isWaiting(p, [p, { ...child, status: "error" }])).toBe(false);
    expect(isWaiting(p, [p, { ...child, status: "active", archived: true }])).toBe(false);
  });
});
