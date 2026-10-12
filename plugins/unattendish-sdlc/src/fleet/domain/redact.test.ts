import { describe, expect, it } from "vitest";
import { messageOf, redact } from "./redact";

const token = ["ghp", "abcdefghijklmnop1234"].join("_");

describe("redact", () => {
  it("replaces every occurrence of a secret, in a URL and in a JSON string", () => {
    expect(redact(`GET https://x.test/a?k=${token}&z=1 then ${token}`, [token])).toBe("GET https://x.test/a?k=[redacted]&z=1 then [redacted]");
    expect(redact(`{"detail":"bad credential ${token}"}`, [token])).toBe('{"detail":"bad credential [redacted]"}');
  });
  it("replaces a secret as it reads URL-encoded or escaped in a JSON string", () => {
    const odd = 'a b"c\\d/e+f';
    expect(redact(`?t=${encodeURIComponent(odd)}`, [odd])).toBe("?t=[redacted]");
    expect(redact(JSON.stringify({ t: odd }), [odd])).toBe('{"t":"[redacted]"}');
  });
  it("replaces the longest secret first", () => {
    expect(redact("abcdef123456 abcdef", ["abcdef", "abcdef123456"])).toBe("[redacted] [redacted]");
  });
  it("treats a secret's characters literally", () => {
    expect(redact("a.b*c+d? and aXb*c+d?", ["a.b*c+d?"])).toBe("[redacted] and aXb*c+d?");
  });
  it("ignores a secret shorter than six characters", () => {
    expect(redact("the pin is 12345 and abc", ["12345", "abc", ""])).toBe("the pin is 12345 and abc");
  });
  it("replaces Bearer and Basic values", () => {
    expect(redact("sent Bearer abc.def-ghi then", [])).toBe("sent Bearer [redacted] then");
    expect(redact("basic dXNlcjpwYXNz", [])).toBe("basic [redacted]");
  });
  it("replaces Authorization header values, bare and quoted", () => {
    expect(redact("Authorization: token ghp_x\nAccept: json", [])).toBe("Authorization: [redacted]\nAccept: json");
    expect(redact("headers { authorization: 'Bearer abc', accept: 'json' }", [])).toBe("headers { authorization: '[redacted]', accept: 'json' }");
    expect(redact('{"Authorization":"lin_api_123456"}', [])).toBe('{"Authorization":"[redacted]"}');
    expect(redact("PRIVATE-TOKEN: glpat-abc123", [])).toBe("PRIVATE-TOKEN: [redacted]");
  });
  it("replaces token query values", () => {
    expect(redact("https://x.test/a?access_token=abc123&private_token=def&token=ghi&page=2", [])).toBe(
      "https://x.test/a?access_token=[redacted]&private_token=[redacted]&token=[redacted]&page=2",
    );
  });
  it("is idempotent", () => {
    const text = `Authorization: Bearer ${token}\nGET /a?token=abc&x=1 {"authorization":"Basic zzz"} ${token}`;
    const once = redact(text, [token]);
    expect(redact(once, [token])).toBe(once);
    expect(once).not.toMatch(/ghp_|abc\b|zzz/);
  });
  it("leaves text without a secret alone", () => {
    expect(redact("GET /repos/org/repo/issues 404", [token])).toBe("GET /repos/org/repo/issues 404");
  });
});

describe("messageOf", () => {
  it("records a failed request's text with no token", () => {
    const error = new Error(`fetch failed: GET https://api.github.com/repos/o/r/issues?access_token=${token}\nheaders: {"Authorization": "Bearer ${token}", "Accept": "x"}`);
    const message = messageOf(error, [token]);
    expect(message).not.toContain(token);
    expect(message).not.toContain("\n");
    expect(message).toContain("fetch failed: GET https://api.github.com/repos/o/r/issues?access_token=[redacted]");
  });
  it("reads a non-error as its string form", () => {
    expect(messageOf("plain", [])).toBe("plain");
    expect(messageOf({ toString: () => `bad ${token}` }, [token])).toBe("bad [redacted]");
    expect(messageOf(null, [])).toBe("null");
  });
  it("survives a value that cannot be printed", () => {
    expect(messageOf(Object.create(null), [])).toBe("unprintable error");
  });
  it("cuts to 300 characters after redacting", () => {
    expect(messageOf(new Error("x".repeat(500)), [])).toHaveLength(300);
    const message = messageOf(new Error(`${"y".repeat(290)}${token}`), [token]);
    expect(message).toHaveLength(300);
    expect(message).not.toContain("ghp_");
  });
});
