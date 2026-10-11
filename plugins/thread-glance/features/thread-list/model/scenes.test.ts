import { describe, expect, it } from "vitest";
import { pickLine, WORKING_LINES } from "./scenes";

describe("the Working scene's line", () => {
  it("has 18 lines", () => {
    expect(WORKING_LINES).toHaveLength(18);
    expect(new Set(WORKING_LINES).size).toBe(18);
  });
  it("never draws the previous line again, whatever the random number", () => {
    for (let previous = 0; previous < WORKING_LINES.length; previous += 1) {
      for (const random of [0, 0.0001, 0.25, 0.5, 0.75, 0.9999]) {
        const next = pickLine(previous, random);
        expect(next).not.toBe(previous);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(WORKING_LINES.length);
      }
    }
  });
  it("reaches every other line", () => {
    const reached = new Set(Array.from({ length: 1000 }, (_, step) => pickLine(5, step / 1000)));
    expect(reached.size).toBe(17);
  });
  it("draws any line the first time", () => {
    expect(pickLine(null, 0)).toBe(0);
    expect(pickLine(null, 0.9999)).toBe(17);
  });
});
