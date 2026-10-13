import { describe, expect, it } from "vitest";
import { expiredLine, trackerOf, warningLine } from "./card-model";

const NOW = "2026-10-12T12:00:00Z";

const expires = (daysLeft: number, expiresAt = "2026-10-18") =>
  ({ kind: "expires", label: "GitHub · yuser for acme", credentialId: "cred_1", accountId: "acc_1", role: "forge", expiresAt, daysLeft }) as const;

describe("a credential warning", () => {
  it("says how many days are left", () => {
    expect(warningLine(expires(6), NOW)).toEqual({ text: "token expires in 6 days", label: "GitHub · yuser for acme" });
    expect(warningLine(expires(1), NOW).text).toBe("token expires in 1 day");
  });
});

describe("an expired token (#261 AC6)", () => {
  const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();

  it("reads expired today on the day it expired, never 0 days ago or expires today", () => {
    expect(expiredLine(local(13, 9), local(13, 14))).toBe("token expired today");
  });

  it("counts the operator's calendar days since the day it expired", () => {
    expect(expiredLine(local(12, 23), local(13, 10))).toBe("token expired 1 day ago");
    expect(expiredLine(local(11, 8), local(13, 10))).toBe("token expired 2 days ago");
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
