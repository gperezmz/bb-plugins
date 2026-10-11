import { describe, expect, it } from "vitest";
import { chipMarkIds, chipTooltip, disclosureName, markHue } from "./children-chip";

describe("chipTooltip", () => {
  it("counts the children and what the subtree holds", () => {
    expect(chipTooltip(3, { failed: 1, needsYou: 2, done: 0, working: 0 })).toBe("3 child threads, 1 failed, 2 need you");
    expect(chipTooltip(1, { failed: 0, needsYou: 0, done: 1, working: 2 })).toBe("1 child thread, 1 done, 2 working");
    expect(chipTooltip(2, { failed: 0, needsYou: 0, done: 0, working: 0 })).toBe("2 child threads");
  });
});

describe("chip marks", () => {
  it("shows up to three of the children", () => {
    expect(chipMarkIds(["a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
    expect(chipMarkIds(["a"])).toEqual(["a"]);
  });

  it("gives a thread the same hue every time", () => {
    expect(markHue("thr_1")).toBe(markHue("thr_1"));
    expect(markHue("thr_1")).toBeGreaterThanOrEqual(0);
    expect(markHue("thr_1")).toBeLessThan(360);
  });
});

describe("disclosureName", () => {
  it("names the children's own children by depth", () => {
    expect([0, 1, 2, 5].map(disclosureName)).toEqual(["Grandchildren", "Great-grandchildren", "Descendants", "Descendants"]);
  });
});
