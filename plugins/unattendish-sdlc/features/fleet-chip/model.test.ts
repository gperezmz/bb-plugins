import { describe, expect, it } from "vitest";
import { chipFace, ONE_LINE_MAX_CHARS } from "./model";

describe("the Fleet chip", () => {
  it("spells out the labelled counts", () => {
    expect(chipFace({ waiting: 1, inFlight: 3, landed: 2 }, false).text).toBe("1 waits on you · 3 in flight · 2 landed in 7d");
  });

  it("leaves out a count of zero", () => {
    expect(chipFace({ waiting: 0, inFlight: 3, landed: 0 }, false).text).toBe("3 in flight");
  });

  it("reads Fleet idle with none", () => {
    expect(chipFace({ waiting: 0, inFlight: 0, landed: 0 }, false).text).toBe("Fleet idle");
  });

  it("shows only the count waiting on the operator on a compact viewport", () => {
    expect(chipFace({ waiting: 2, inFlight: 3, landed: 2 }, true)).toMatchObject({ text: "2", dot: false });
  });

  it("shows a dot with none waiting on a compact viewport", () => {
    expect(chipFace({ waiting: 0, inFlight: 3, landed: 0 }, true)).toMatchObject({ text: null, dot: true });
  });

  it("names an idle chip Fleet idle, not Fleet: Fleet idle", () => {
    expect(chipFace({ waiting: 0, inFlight: 0, landed: 0 }, false).label).toBe("Fleet idle");
    expect(chipFace({ waiting: 0, inFlight: 0, landed: 0 }, true).label).toBe("Fleet idle");
  });

  it("names the chip by its counts, on a compact viewport too", () => {
    expect(chipFace({ waiting: 2, inFlight: 0, landed: 0 }, true).label).toBe("Fleet: 2 waits on you");
  });

  it("draws the spec's own example on one line", () => {
    const face = chipFace({ waiting: 1, inFlight: 3, landed: 2 }, false);
    expect(face.lines).toEqual(["1 waits on you · 3 in flight · 2 landed in 7d"]);
    expect(face.text!.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS);
  });

  it("draws counts too long for the box on two lines, split between the counts, losing nothing", () => {
    const face = chipFace({ waiting: 987, inFlight: 654, landed: 321 }, false);
    expect(face.lines).toEqual(["987 waits on you · 654 in flight", "321 landed in 7d"]);
    expect(face.lines.join(" · ")).toBe(face.text);
  });

  it("keeps every count with up to three digits within the one-line limit or on two lines each within it", () => {
    for (const n of [1, 12, 123, 999]) {
      const face = chipFace({ waiting: n, inFlight: n, landed: n }, false);
      for (const line of face.lines) expect(line.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS);
      expect(face.lines.length).toBeLessThanOrEqual(2);
    }
  });

  it("draws one or two counts on one line however many digits they have", () => {
    expect(chipFace({ waiting: 999, inFlight: 999, landed: 0 }, false).lines).toHaveLength(1);
    expect(chipFace({ waiting: 0, inFlight: 0, landed: 0 }, false).lines).toEqual(["Fleet idle"]);
  });
});
