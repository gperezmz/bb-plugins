import { describe, expect, it } from "vitest";
import { ago, ledgerChange, ledgerView, MINUTE, NOW } from "@/testing/fixtures";
import { blockedText, credentialParts, droppedHeading, doneText, itemTitle, ledgerFilter, ledgerIsEmpty, ledgerParts, stageText, unreadableRowText, watchedHeading, whyText } from "./model";

describe("the manifest's rows", () => {
  it("says how long an In flight row has been at its stage", () => {
    expect(stageText({ stage: "at the bar", since: ago(25 * MINUTE) }, NOW)).toBe("at the bar for 25m");
  });

  it("says what a row is blocked on", () => {
    expect(blockedText(["#170", "#171"])).toBe("blocked on #170, #171");
  });

  it("names the section, line and column of a row it cannot read", () => {
    expect(unreadableRowText({ section: "In flight", line: 14, reason: 'the table has no "Stage" column' })).toBe('unreadable in In flight, line 14: the table has no "Stage" column');
  });

  it("leaves a Ref of — out of a title", () => {
    expect(itemTitle("—", "Brainstorm on Backlog")).toBe("Brainstorm on Backlog");
    expect(itemTitle("#163", "refuse long titles")).toBe("#163 refuse long titles");
  });
});

describe("the watched set", () => {
  it("gives every reason an item is in it", () => {
    expect(whyText({ why: ["named in Inbox", "blocked on #170"] })).toBe("named in Inbox · blocked on #170");
    expect(watchedHeading(1)).toBe("Watched set (1 item)");
  });
});

describe("a credential", () => {
  it("gives its kind, its expiry date where the service reports one, and whether it shares the rate limit", () => {
    expect(credentialParts({ role: "forge", prefix: "org", auth: "token", expiresAt: "2026-10-18T12:00:00Z", sharesAgentRateLimit: false })).toEqual(["pasted token", "expires 18 Oct"]);
    expect(credentialParts({ role: "forge", prefix: "github.com", auth: "gh", expiresAt: null, sharesAgentRateLimit: true })).toEqual(["gh login", "no expiry reported", "shares the agents' rate limit"]);
  });
});

describe("the ledger's filters", () => {
  it("asks the server for an outcome it can filter by, and for an item", () => {
    expect(ledgerFilter("woke", " #163 ")).toEqual({ item: "#163", done: "woke" });
    expect(ledgerFilter("held", "")).toEqual({ done: "held" });
    expect(ledgerFilter("failed read", "")).toEqual({ done: "failed read" });
  });

  it("asks for everything where the view picks its own part", () => {
    expect(ledgerFilter("all", "")).toEqual({});
    expect(ledgerFilter("dropped", "")).toEqual({});
    expect(ledgerFilter("wakes", "#1")).toEqual({ item: "#1" });
  });

  it("shows the part each filter is about", () => {
    expect(ledgerParts("all")).toEqual({ changes: true, dropped: true, wakes: true });
    expect(ledgerParts("dropped")).toEqual({ changes: false, dropped: true, wakes: false });
    expect(ledgerParts("wakes")).toEqual({ changes: false, dropped: false, wakes: true });
    expect(ledgerParts("woke")).toEqual({ changes: true, dropped: false, wakes: false });
  });

  it("is empty where the filter shows nothing the ledger holds", () => {
    expect(ledgerIsEmpty(ledgerView(), "all")).toBe(true);
    expect(ledgerIsEmpty(ledgerView({ changes: [ledgerChange()] }), "dropped")).toBe(true);
    expect(ledgerIsEmpty(ledgerView({ changes: [ledgerChange()] }), "all")).toBe(false);
  });

  it("heads a dropped group with its reason and count, and says what was done with a change", () => {
    expect(droppedHeading({ reason: "echo: marker", count: 31 })).toBe("echo: marker · 31");
    expect(doneText({ done: "echo", rule: "marker" })).toBe("echo (marker)");
    expect(doneText({ done: "woke", rule: null })).toBe("woke");
  });
});
