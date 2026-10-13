import { describe, expect, it } from "vitest";
import { accountSetting, credentialSetting } from "@/testing/fixtures";
import { addTokenRequest, defaultText, expiryText, expiryShown, intervalProblem, parseSeconds, renewOffer, secondsText, sharesRateLimit, usedByText } from "./model";

describe("an account", () => {
  it("says the places it is the default for, or nothing", () => {
    expect(defaultText({ defaultFor: ["github.com", "linear:"] })).toBe("default for github.com, linear:");
    expect(defaultText({ defaultFor: [] })).toBeNull();
  });
});

describe("a credential", () => {
  it("shows its expiry, or that none was reported, or that the service refuses it", () => {
    expect(expiryText({ refused: false, expiresAt: "2026-10-18T12:00:00Z" })).toBe("expires 18 Oct");
    expect(expiryText({ refused: false, expiresAt: null })).toBe("no expiry reported");
    expect(expiryText({ refused: true, expiresAt: "2026-10-18T12:00:00Z" })).toBe("refused by the service");
  });

  it("colours its expiry by urgency: red where refused, amber within the window the cards warn in, else grey (AC7)", () => {
    const at = "2026-10-18T12:00:00Z";
    expect(expiryShown({ refused: false, expiresAt: at, expiresInDays: null })).toEqual({ text: "expires 18 Oct", tone: "grey", icon: null });
    expect(expiryShown({ refused: false, expiresAt: null, expiresInDays: null })).toEqual({ text: "no expiry reported", tone: "grey", icon: null });
    expect(expiryShown({ refused: false, expiresAt: at, expiresInDays: 3 })).toEqual({ text: "expires in 3 days", tone: "amber", icon: "Clock" });
    expect(expiryShown({ refused: false, expiresAt: at, expiresInDays: 1 })).toEqual({ text: "expires in 1 day", tone: "amber", icon: "Clock" });
    expect(expiryShown({ refused: false, expiresAt: at, expiresInDays: 0 })).toEqual({ text: "expires today", tone: "amber", icon: "Clock" });
    expect(expiryShown({ refused: true, expiresAt: at, expiresInDays: 3 })).toEqual({ text: "refused by the service", tone: "red", icon: "CircleX" });
  });

  it("shares the agents' rate limit where it is a gh or glab login (AC7)", () => {
    expect(["gh", "glab", "fine-grained", "classic", "gitlab-token", "linear-key", "jira-token"].filter((kind) => sharesRateLimit({ kind: kind as never }))).toEqual(["gh", "glab"]);
  });

  it("names the fleets that read with it", () => {
    expect(usedByText({ fleets: ["acme/api", "acme/web"] })).toBe("read by acme/api, acme/web");
    expect(usedByText({ fleets: [] })).toBe("no fleet reads with it");
  });
});

describe("Renew", () => {
  const account = accountSetting();

  it("is offered for nothing that neither expires soon nor is refused", () => {
    expect(renewOffer(account, credentialSetting())).toBeNull();
  });

  it("opens the popup at the token step for the owner, replacing the credential, for a token made on a pre-filled page", () => {
    expect(renewOffer(account, credentialSetting({ expiresInDays: 6 }))).toEqual({
      kind: "popup",
      request: { target: { service: "github", place: "github.com", owner: "acme" }, account: "acc_yuser", replaces: "cred_acme" },
    });
  });

  it("opens the key's field for a Linear or Jira key, with no owner", () => {
    const linear = accountSetting({ id: "acc_lin", service: "linear", place: "linear.app" });
    const key = credentialSetting({ id: "cred_key", refused: true, renew: { kind: "paste" } });
    expect(renewOffer(linear, key)).toEqual({ kind: "popup", request: { target: { service: "linear", place: "linear.app" }, account: "acc_lin", replaces: "cred_key" } });
  });

  it("gives a login's command and no Renew", () => {
    const login = credentialSetting({ refused: true, renew: { kind: "login", command: "gh auth login --hostname github.com" } });
    expect(renewOffer(account, login)).toEqual({ kind: "command", command: "gh auth login --hostname github.com" });
  });

  it("opens Add token for another owner at the token step for the account", () => {
    expect(addTokenRequest(account)).toEqual({ target: { service: "github", place: "github.com" }, account: "acc_yuser" });
  });
});

describe("the poll interval", () => {
  it("refuses under 30 seconds before anything is sent", () => {
    expect(intervalProblem("29")).toBe("The poll interval must be at least 30 seconds.");
    expect(intervalProblem("0")).toBe("The poll interval must be at least 30 seconds.");
    expect(intervalProblem("30")).toBeNull();
    expect(intervalProblem("120")).toBeNull();
  });

  it("refuses what is not a whole number of seconds", () => {
    for (const text of ["", "abc", "1.5", "-40", "30s"]) expect(intervalProblem(text)).toBe("Enter a whole number of seconds.");
  });

  it("reads and writes seconds", () => {
    expect(parseSeconds(" 90 ")).toBe(90);
    expect(secondsText(120_000)).toBe("120");
  });
});
