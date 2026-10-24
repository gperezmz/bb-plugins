import { describe, expect, it } from "vitest";
import { questionsSeen } from "./questions-seen";

const asking = (id: string, hasPendingInteraction = true) => ({ id, hasPendingInteraction });

describe("questionsSeen", () => {
  it("adds the open thread while it asks, and keeps it once you move away", () => {
    const opened = questionsSeen(new Set(), [asking("a"), asking("b")], "a");
    expect([...opened]).toEqual(["a"]);
    expect(questionsSeen(opened, [asking("a"), asking("b")], "b")).toEqual(new Set(["a", "b"]));
    expect(questionsSeen(opened, [asking("a"), asking("b")], null)).toBe(opened);
  });

  it("does not add an open thread that is not asking", () => {
    expect(questionsSeen(new Set(), [asking("a", false)], "a").size).toBe(0);
  });

  it("forgets a thread once its question clears, so the next one is unseen", () => {
    const opened = questionsSeen(new Set(), [asking("a")], "a");
    const cleared = questionsSeen(opened, [asking("a", false)], null);
    expect(cleared.size).toBe(0);
    expect(questionsSeen(cleared, [asking("a")], null).size).toBe(0);
  });

  it("forgets a thread that is gone", () => {
    expect(questionsSeen(new Set(["a"]), [], null).size).toBe(0);
  });
});
