import { describe, expect, it } from "vitest";
import { combineChecks } from "./checks";

describe("combineChecks", () => {
  it("is pending while any check is pending, whatever else is reported", () => {
    expect(combineChecks(["passed", "pending", "failed"])).toBe("pending");
    expect(combineChecks(["pending"])).toBe("pending");
  });
  it("is failed when none is pending and any failed", () => {
    expect(combineChecks(["passed", "failed", "passed"])).toBe("failed");
  });
  it("is passed when all passed, and for no outcomes", () => {
    expect(combineChecks(["passed", "passed"])).toBe("passed");
    expect(combineChecks([])).toBe("passed");
  });
});
