import { describe, expect, it } from "vitest";
import { steppedSegment } from "./segments";

describe("an arrow key in a segmented control", () => {
  it("moves the choice and wraps at either end", () => {
    expect(steppedSegment("ArrowRight", 1, 3)).toBe(2);
    expect(steppedSegment("ArrowDown", 2, 3)).toBe(0);
    expect(steppedSegment("ArrowLeft", 0, 3)).toBe(2);
    expect(steppedSegment("ArrowUp", 1, 3)).toBe(0);
  });

  it("counts from the first segment when nothing is chosen", () => {
    expect(steppedSegment("ArrowRight", -1, 3)).toBe(1);
  });

  it("ignores any other key", () => {
    expect(steppedSegment("Enter", 1, 3)).toBeNull();
  });
});
