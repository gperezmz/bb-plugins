import { describe, expect, it } from "vitest";
import { headerCount, headerCountLabel, showsInbox } from "./model";

describe("the Fleets page's header count", () => {
  it("counts what the server says waits on the operator", () => {
    expect(headerCount({ waiting: 3 })).toBe("3");
  });

  it("shows no count at zero, or before the view arrives", () => {
    expect(headerCount({ waiting: 0 })).toBeNull();
    expect(headerCount(null)).toBeNull();
  });

  it("reads as a sentence", () => {
    expect(headerCountLabel(3)).toBe("3 waiting on you");
  });
});

describe("whether the Fleets page draws the Inbox table", () => {
  const view = { inbox: [], unreadableInbox: [], needsAccount: [] };
  const need = { fleet: "acme/web", managerThreadId: "thr_a", role: "forge", text: "needs an account" } as const;

  it("draws it, saying nothing waits, when nothing does", () => {
    expect(showsInbox(view)).toBe(true);
  });

  it("leaves it out when only fleets needing an account wait, so the page does not say both", () => {
    expect(showsInbox({ ...view, needsAccount: [need] })).toBe(false);
  });

  it("draws it when it has rows to list", () => {
    expect(showsInbox({ ...view, needsAccount: [need], unreadableInbox: [{ fleet: "a", managerThreadId: "t", line: 1, reason: "r" }] })).toBe(true);
  });
});
