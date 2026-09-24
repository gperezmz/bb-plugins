import { describe, expect, it } from "vitest";
import { attributionEnv, extraHeadersError, isAuthHeader, parseExtraHeaders } from "../../src/core/headers";

describe("attributionEnv", () => {
  it("gives Claude Code a literal ANTHROPIC_CUSTOM_HEADERS with the session header first, then extra headers", () => {
    const env = attributionEnv("claude-code", "thr_abc", "# comment\nx-team: platform\n\nx-cost-center: 42");
    expect(env).toHaveLength(1);
    expect(env[0]!.name).toBe("ANTHROPIC_CUSTOM_HEADERS");
    expect(env[0]!.value).toBe("x-litellm-session-id: bb-thr_abc\nx-team: platform\nx-cost-center: 42");
  });

  it("drops invalid extra header lines rather than passing them through", () => {
    const env = attributionEnv("claude-code", "thr_abc", "Authorization: Bearer sk-secret\nx-ok: 1");
    expect(env[0]!.value).toBe("x-litellm-session-id: bb-thr_abc\nx-ok: 1");
    expect(env[0]!.value).not.toContain("sk-secret");
  });

  it("gives Codex and pi BB_USAGE_SESSION", () => {
    for (const provider of ["codex", "pi"]) {
      expect(attributionEnv(provider, "thr_abc", "x-team: a")).toEqual([
        expect.objectContaining({ name: "BB_USAGE_SESSION", value: "bb-thr_abc" }),
      ]);
    }
  });

  it("gives Cursor nothing", () => {
    expect(attributionEnv("acp-cursor", "thr_abc", "")).toEqual([]);
  });
});

describe("extra headers setting", () => {
  it("rejects authorization headers", () => {
    for (const name of ["Authorization", "x-api-key", "X-LiteLLM-API-Key", "openai-api-key", "proxy-authorization"]) {
      expect(isAuthHeader(name), name).toBe(true);
      expect(extraHeadersError(`${name}: secret`), name).toMatch(/credentials/);
    }
  });

  it("rejects the session header, malformed lines and bad names; accepts the rest", () => {
    expect(extraHeadersError("x-litellm-session-id: mine")).toMatch(/set by the plugin/);
    expect(extraHeadersError("no colon here")).toMatch(/Name: Value/);
    expect(extraHeadersError("bad name: v")).toMatch(/not a valid header name/);
    expect(extraHeadersError("x-team: a\n# note\n")).toBeNull();
    expect(parseExtraHeaders("x-a: b: c").headers).toEqual([{ name: "x-a", value: "b: c" }]);
  });
});

describe("credential header names", () => {
  it("refuses common credential headers beyond Authorization", async () => {
    const { isAuthHeader } = await import("../../src/core/headers");
    for (const n of ["api-key", "apikey", "x-auth-token", "client-secret", "ocp-apim-subscription-key", "x-goog-api-key", "Password"]) {
      expect(isAuthHeader(n)).toBe(true);
    }
    for (const n of ["x-team", "x-litellm-tags", "x-request-id", "keyboard-layout"]) expect(isAuthHeader(n)).toBe(false);
  });
});
