import { describe, expect, it } from "vitest";
import { messageOf } from "./errors";

describe("messageOf", () => {
  it("reads an error's message, and anything else as text", () => {
    expect(messageOf(new Error("connection dropped"))).toBe("connection dropped");
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(503)).toBe("503");
  });
});
