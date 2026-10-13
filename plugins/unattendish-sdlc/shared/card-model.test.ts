import { describe, expect, it } from "vitest";
import { trackerOf, warningLine } from "./card-model";

const NOW = "2026-10-12T12:00:00Z";

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

describe("a fleet's tracker", () => {
  it("is its service and key where it is a service of its own", () => {
    expect(trackerOf("linear:PLAT")).toEqual({ service: "linear", key: "PLAT" });
    expect(trackerOf("jira:acme.atlassian.net/OPS")).toEqual({ service: "jira", key: "OPS" });
  });

  it("is nothing where the tracker is the forge's issues", () => {
    expect(trackerOf("forge-issues")).toBeNull();
  });
});
