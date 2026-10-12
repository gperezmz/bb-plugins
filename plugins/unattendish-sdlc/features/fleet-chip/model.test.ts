import { describe, expect, it } from "vitest";
import { chipFace } from "./model";

describe("the Fleet chip", () => {
  it("spells out the labelled counts", () => {
    expect(chipFace({ waiting: 1, inFlight: 3, landedToday: 2 }, false).text).toBe("1 waits on you · 3 in flight · 2 landed today");
  });

  it("leaves out a count of zero", () => {
    expect(chipFace({ waiting: 0, inFlight: 3, landedToday: 0 }, false).text).toBe("3 in flight");
  });

  it("reads Fleet idle with none", () => {
    expect(chipFace({ waiting: 0, inFlight: 0, landedToday: 0 }, false).text).toBe("Fleet idle");
  });

  it("shows only the count waiting on the operator on a compact viewport", () => {
    expect(chipFace({ waiting: 2, inFlight: 3, landedToday: 2 }, true)).toMatchObject({ text: "2", dot: false });
  });

  it("shows a dot with none waiting on a compact viewport", () => {
    expect(chipFace({ waiting: 0, inFlight: 3, landedToday: 0 }, true)).toMatchObject({ text: null, dot: true });
  });

  it("names the chip by its counts, on a compact viewport too", () => {
    expect(chipFace({ waiting: 2, inFlight: 0, landedToday: 0 }, true).label).toBe("Fleet: 2 waits on you");
  });
});
