import { describe, expect, it } from "vitest";
import { clip, lastLine, LAST_LINE_MAX } from "./text";

describe("lastLine", () => {
  it("is the last non-blank line, trimmed", () => {
    expect(lastLine("first\nsecond\n  third  \n\n   \n")).toBe("third");
    expect(lastLine("only")).toBe("only");
  });

  it("splits on \\r\\n, \\r and \\n", () => {
    expect(lastLine("a\r\nb\r\n")).toBe("b");
    expect(lastLine("a\rb\r")).toBe("b");
    expect(lastLine("a\r\n\r\n  \r\n")).toBe("a");
    expect(lastLine("a\nb\rc\r\nd")).toBe("d");
  });

  it("is null for a body that is missing, empty or blank", () => {
    expect(lastLine(null)).toBeNull();
    expect(lastLine(undefined)).toBeNull();
    expect(lastLine("")).toBeNull();
    expect(lastLine(" \n\t\r\n  ")).toBeNull();
  });

  it("cuts to 500 code points, and keeps a line of exactly that length whole", () => {
    expect(lastLine("x".repeat(LAST_LINE_MAX))).toBe("x".repeat(LAST_LINE_MAX));
    expect(lastLine("x".repeat(LAST_LINE_MAX + 40))).toBe("x".repeat(LAST_LINE_MAX));
  });

  it("counts code points, so an emoji is never cut in two", () => {
    const line = "😀".repeat(LAST_LINE_MAX + 5);
    const cut = lastLine(line)!;
    expect(Array.from(cut)).toHaveLength(LAST_LINE_MAX);
    expect(cut).toBe("😀".repeat(LAST_LINE_MAX));
    expect(cut.length).toBe(2 * LAST_LINE_MAX);
  });

  it("trims before cutting, so leading space does not use up the allowance", () => {
    expect(lastLine(`   ${"y".repeat(LAST_LINE_MAX)}`)).toBe("y".repeat(LAST_LINE_MAX));
  });
});

describe("clip", () => {
  it("leaves text within the limit and cuts longer text to it, ending in an ellipsis", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcd", 3)).toBe("ab…");
  });

  it("does not cut through a surrogate pair", () => {
    expect(clip("😀😀😀", 2)).toBe("😀…");
  });
});
