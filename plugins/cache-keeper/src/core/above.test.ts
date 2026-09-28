import { describe, expect, it } from "vitest";
import { AboveRefused, aboveSetting } from "./above";

const lines = [120_000, 150_000, 190_000, 240_000, 310_000, 400_000, 520_000, 680_000, null, null];
const view = { windowKnown: true, window: 1_000_000, lines, rates: { w: 1, r: 1, o: 1 } };

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as AboveRefused;
  }
  throw new Error("not refused");
};

describe("aboveSetting", () => {
  it("snaps a size inside the range to the nearest line, and one below the lowest to the lowest", () => {
    expect(aboveSetting(500_000, view)).toBe(7);
    expect(aboveSetting(200_000, view)).toBe(3);
    expect(aboveSetting(10_000, view)).toBe(1);
    expect(aboveSetting(680_000, view)).toBe(8);
  });

  it("refuses while the window is unknown, saying when it will be known", () => {
    const e = refusal(() => aboveSetting(500_000, { ...view, windowKnown: false, window: 0, lines: lines.map(() => null) }));
    expect(e.code).toBe("window_unknown");
    expect(e.message).toMatch(/first turn ends/);
  });

  it("refuses above the highest line, naming the window and the line", () => {
    const e = refusal(() => aboveSetting(700_000, view));
    expect(e.code).toBe("above_highest_line");
    expect(e.message).toMatch(/700k is above this thread's highest line, 680k, in its 1M window/);
  });

  it("refuses when no setting has a line, and says why", () => {
    expect(refusal(() => aboveSetting(500_000, { ...view, lines: lines.map(() => null), rates: null })).message).toMatch(/no price/);
    expect(refusal(() => aboveSetting(500_000, { ...view, lines: lines.map(() => null) })).message).toMatch(/never repays itself.*1M window/);
  });
});
