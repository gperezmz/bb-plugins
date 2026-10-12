import { describe, expect, it } from "vitest";
import { hasRef, itemTitle } from "./item-title";

describe("naming an item", () => {
  it("joins the Ref and the title", () => {
    expect(itemTitle("ENG-212", "which locale wins?")).toBe("ENG-212 which locale wins?");
  });

  it("leaves out a Ref of — or an empty one", () => {
    expect(itemTitle("—", "a note")).toBe("a note");
    expect(itemTitle("", "a note")).toBe("a note");
    expect([hasRef("—"), hasRef(""), hasRef("#1")]).toEqual([false, false, true]);
  });
});
