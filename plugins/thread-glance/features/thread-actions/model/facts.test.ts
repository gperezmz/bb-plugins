// What the menu keeps of a thread, and that it keeps its identity while that is unchanged.
import { describe, expect, it } from "vitest";
import { makeThread, working } from "@/testing/fixtures";
import { snoozedRow } from "@/shared/lifecycle";
import { menuFactsOf, shareFacts } from "./facts";

describe("menu facts", () => {
  it("reads busy, woke, the shelf the row alone gives, and the branch", () => {
    const now = 10_000_000;
    const thread = makeThread({ id: "t", environment: { branchName: "feat/x" }, latestAttentionAt: 1 });
    expect(menuFactsOf(thread, null, now)).toEqual({ busy: false, woke: false, mark: "active", branch: "feat/x" });
    expect(menuFactsOf(thread, snoozedRow(now + 1000, now - 5), now).mark).toBe("snoozed");
    expect(menuFactsOf(thread, snoozedRow(now - 1, now - 5), now)).toMatchObject({ woke: true, mark: "active" });
    expect(menuFactsOf(makeThread({ id: "t", ...working }), null, now).busy).toBe(true);
  });

  it("shares the previous map and entries while nothing they hold changed", () => {
    const a = menuFactsOf(makeThread({ id: "a" }), null, 1);
    const b = menuFactsOf(makeThread({ id: "b" }), null, 1);
    const previous = new Map([["a", a], ["b", b]]);
    expect(shareFacts(previous, new Map([["a", { ...a }], ["b", { ...b }]]))).toBe(previous);
    const changed = shareFacts(previous, new Map([["a", { ...a }], ["b", { ...b, busy: true }]]));
    expect(changed).not.toBe(previous);
    expect(changed.get("a")).toBe(a);
    expect(changed.get("b")!.busy).toBe(true);
    expect(shareFacts(previous, new Map([["a", a]]))).not.toBe(previous);
  });
});
