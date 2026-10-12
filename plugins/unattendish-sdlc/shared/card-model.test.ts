import { describe, expect, it } from "vitest";
import { costText, countParts, countsText, managerText, warningLine } from "./card-model";

const NOW = "2026-10-12T12:00:00Z";

describe("a fleet's counts", () => {
  it("spells each count and joins them", () => {
    expect(countsText({ waiting: 1, inFlight: 3, landedToday: 2 })).toBe("1 waits on you · 3 in flight · 2 landed today");
  });

  it("leaves out a count of zero", () => {
    expect(countParts({ waiting: 0, inFlight: 2, landedToday: 0 })).toEqual(["2 in flight"]);
    expect(countsText({ waiting: 1, inFlight: 0, landedToday: 0 })).toBe("1 waits on you");
  });

  it("reads Fleet idle with no count", () => {
    expect(countsText({ waiting: 0, inFlight: 0, landedToday: 0 })).toBe("Fleet idle");
  });
});

describe("the manager's state", () => {
  it("says working, idle for how long, or no manager", () => {
    expect(managerText({ state: "working", since: NOW }, NOW)).toBe("manager working");
    expect(managerText({ state: "idle", since: "2026-10-12T11:48:00Z" }, NOW)).toBe("manager idle 12m");
    expect(managerText({ state: "idle", since: null }, NOW)).toBe("manager idle");
    expect(managerText({ state: "none", since: null }, NOW)).toBe("no manager");
  });
});

describe("the cost", () => {
  it("carries its period", () => {
    expect(costText({ cost: { amount: 14.2, currency: "USD", period: "since this manager started" } })).toBe("$14.20 since this manager started");
  });

  it("puts a symbol currency in front and keeps the period label", () => {
    expect(costText({ cost: { amount: 0.17, currency: "$", period: "since this manager started" } })).toBe("$0.17 since this manager started");
  });

  it("puts a currency code after the amount when Intl does not know it", () => {
    expect(costText({ cost: { amount: 0.17, currency: "not-a-code", period: "since this manager started" } })).toBe("0.17 not-a-code since this manager started");
  });

  it("is left out when the card has none", () => {
    expect(costText({ cost: null })).toBeNull();
  });
});

describe("a credential warning", () => {
  it("says how many days are left", () => {
    expect(warningLine({ kind: "expires", prefix: "org", expiresAt: "2026-10-18", daysLeft: 6 })).toEqual({ text: "token expires in 6 days", prefix: "org", tone: "warning" });
    expect(warningLine({ kind: "expires", prefix: "org", expiresAt: "2026-10-13", daysLeft: 1 }).text).toBe("token expires in 1 day");
    expect(warningLine({ kind: "expires", prefix: "org", expiresAt: "2026-10-12", daysLeft: 0 }).text).toBe("token expires today");
  });

  it("says an expired credential expired, in the destructive tone", () => {
    expect(warningLine({ kind: "expires", prefix: "org", expiresAt: "2026-10-10", daysLeft: -2 })).toMatchObject({ text: "token expired 2 days ago", tone: "destructive" });
  });

  it("says a gh or glab login shares the agents' rate limit", () => {
    expect(warningLine({ kind: "shares-rate-limit", prefix: "github.com" }).text).toBe("shares the agents' rate limit");
  });
});
