import { describe, expect, it } from "vitest";
import { cardReasons, costText, countParts, countsText, halfAction, halfLine, managerText, trackerOf, warningLine } from "./card-model";

const NOW = "2026-10-12T12:00:00Z";

describe("a fleet's counts", () => {
  it("counts blocked rows too, as the fleet board does", () => {
    expect(countsText({ waiting: 0, inFlight: 0, blocked: 2, landed: 1 })).toBe("2 blocked · 1 landed in 7d");
  });

  it("spells each count and joins them", () => {
    expect(countsText({ waiting: 1, inFlight: 3, blocked: 0, landed: 2 })).toBe("1 waits on you · 3 in flight · 2 landed in 7d");
  });

  it("leaves out a count of zero", () => {
    expect(countParts({ waiting: 0, inFlight: 2, blocked: 0, landed: 0 })).toEqual(["2 in flight"]);
    expect(countsText({ waiting: 1, inFlight: 0, blocked: 0, landed: 0 })).toBe("1 waits on you");
  });

  it("reads Fleet idle with no count", () => {
    expect(countsText({ waiting: 0, inFlight: 0, blocked: 0, landed: 0 })).toBe("Fleet idle");
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

const expires = (daysLeft: number, expiresAt = "2026-10-18") =>
  ({ kind: "expires", label: "GitHub · yuser for acme", credentialId: "cred_1", accountId: "acc_1", role: "forge", expiresAt, daysLeft }) as const;

describe("a credential warning", () => {
  it("says how many days are left", () => {
    expect(warningLine(expires(6), NOW)).toEqual({ text: "token expires in 6 days", label: "GitHub · yuser for acme", tone: "warning" });
    expect(warningLine(expires(1), NOW).text).toBe("token expires in 1 day");
    expect(warningLine(expires(0), NOW).text).toBe("token expires today");
  });

  it("says an expired credential expired, in the destructive tone", () => {
    expect(warningLine(expires(-2), NOW)).toMatchObject({ text: "token expired 2 days ago", tone: "destructive" });
  });

  it("says a gh or glab login shares the agents' rate limit", () => {
    expect(warningLine({ kind: "shares-rate-limit", label: "GitHub · yuser for every owner" }, NOW).text).toBe("shares the agents' rate limit");
  });

  it("says polling is late, with when it last ran, or that it has never run", () => {
    expect(warningLine({ kind: "polling-late", lastPolledAt: "2026-10-12T11:51:00Z" }, NOW).text).toBe("polling is late: polled 9m ago");
    expect(warningLine({ kind: "never-polled" }, NOW).text).toBe("not polled yet");
  });
});

describe("a fleet's halves", () => {
  const half = (over = {}) => ({ role: "forge", what: "acme/web", account: { id: "a", label: "GitHub · yuser" }, credential: null, canWrite: false, needs: null, ...over }) as const;

  it("names the account the half reads as, or says there is none yet", () => {
    expect(halfLine(half())).toBe("acme/web · reads as GitHub · yuser");
    expect(halfLine(half({ account: null }))).toBe("acme/web · no account yet");
  });

  it("offers Connect… while the half needs something and Change account… once it is read", () => {
    expect(halfAction(half({ needs: "needs a GitHub account that can read other-org" }))).toBe("Connect…");
    expect(halfAction(half())).toBe("Change account…");
  });
});

describe("the reasons below the halves", () => {
  const needing = { role: "forge" as const, what: "acme/api", account: null, credential: null, canWrite: false, needs: "acme/api needs a GitHub account that can read acme" };
  const reasons = [
    { code: "no-credential" as const, text: "acme/api needs a GitHub account that can read acme", fix: { kind: "connect" as const, role: "forge" as const } },
    { code: "credential-refused" as const, text: "The service did not answer reads with the credential for GitHub · yuser", fix: { kind: "none" as const } },
    { code: "manifest-missing" as const, text: "The manifest does not exist yet", fix: { kind: "fleet-tab" as const } },
  ];

  it("leaves to a half's line the reason Connect… fixes for it, and keeps every other", () => {
    expect(cardReasons({ reasons, halves: [needing] }).map((reason) => reason.code)).toEqual(["credential-refused", "manifest-missing"]);
  });

  it("keeps a Connect… reason whose half says it needs nothing", () => {
    expect(cardReasons({ reasons, halves: [{ ...needing, needs: null }] })).toHaveLength(3);
  });
});

describe("a fleet's tracker", () => {
  it("is its service and key where it is a service of its own", () => {
    expect(trackerOf("linear:PLAT")).toEqual({ service: "linear", key: "PLAT" });
    expect(trackerOf("jira:acme.atlassian.net/OPS")).toEqual({ service: "jira", key: "OPS" });
  });

  it("is nothing where the tracker is the forge's issues", () => {
    expect(trackerOf("forge-issues")).toBeNull();
  });
});
