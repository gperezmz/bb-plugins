import { describe, expect, it } from "vitest";
import { draftFrom, emptyForm, formFrom, formProblem, intervalProblem, parseSeconds, secondsText, settingParts } from "./model";

describe("the credential form", () => {
  it("needs a prefix", () => {
    expect(formProblem({ ...emptyForm(), token: "x" })).toBe("Enter the prefix the credential applies to.");
  });

  it("needs a token to add a pasted token, but not to edit one or to add a login", () => {
    expect(formProblem({ ...emptyForm(), prefix: "github.com/acme" })).toBe("Paste the token.");
    expect(formProblem({ ...emptyForm(), prefix: "github.com/acme", auth: "gh" })).toBeNull();
    expect(formProblem({ ...emptyForm(), prefix: "github.com/acme", was: "github.com/acme" })).toBeNull();
  });

  it("sends a blank token as no token, which keeps the stored one", () => {
    const draft = draftFrom({ ...emptyForm(), prefix: " github.com/acme ", was: "github.com/acme" });
    expect(draft).toEqual({ was: "github.com/acme", prefix: "github.com/acme", auth: "token" });
    expect("token" in draft).toBe(false);
  });

  it("sends a new token, trimmed, and the optional fields only where filled", () => {
    expect(draftFrom({ ...emptyForm(), prefix: "gitlab.example.com", service: "gitlab", baseUrl: " https://gitlab.example.com/api/v4 ", token: " fake-token " })).toEqual({
      prefix: "gitlab.example.com",
      auth: "token",
      service: "gitlab",
      baseUrl: "https://gitlab.example.com/api/v4",
      token: "fake-token",
    });
  });

  it("sends no token for a gh or glab login, even if one was typed before the kind changed", () => {
    expect("token" in draftFrom({ ...emptyForm(), prefix: "github.com", auth: "gh", token: "stale" })).toBe(false);
  });

  it("starts an edit from the stored entry with the token field empty", () => {
    expect(formFrom({ prefix: "github.com/acme", auth: "token", service: "github", baseUrl: null, hasToken: true, expiresAt: null, problem: null })).toEqual({
      was: "github.com/acme",
      prefix: "github.com/acme",
      auth: "token",
      service: "github",
      baseUrl: "",
      token: "",
    });
  });

  it("lists a credential's kind, whether a token is stored, and its expiry where known", () => {
    expect(settingParts({ prefix: "org", auth: "token", service: null, baseUrl: null, hasToken: true, expiresAt: "2026-10-18T12:00:00Z", problem: null })).toEqual(["pasted token", "token stored", "expires 18 Oct"]);
    expect(settingParts({ prefix: "github.com", auth: "gh", service: null, baseUrl: null, hasToken: false, expiresAt: null, problem: null })).toEqual(["gh login"]);
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
