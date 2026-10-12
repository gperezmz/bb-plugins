import { describe, expect, it } from "vitest";
import { headerCount, headerCountLabel, landedTitle } from "./model";

describe("the Fleets page's header count", () => {
  it("counts every Inbox row across fleets", () => {
    expect(headerCount({ waiting: 3 })).toBe("3");
  });

  it("shows no count at zero, or before the view arrives", () => {
    expect(headerCount({ waiting: 0 })).toBeNull();
    expect(headerCount(null)).toBeNull();
  });

  it("reads as a sentence", () => {
    expect(headerCountLabel(3)).toBe("3 waiting on you");
  });
});

describe("a landed spec", () => {
  it("names the item and its title", () => {
    expect(landedTitle({ ref: "ENG-198", spec: "dark mode" })).toBe("ENG-198 dark mode");
    expect(landedTitle({ ref: "—", spec: "dark mode" })).toBe("dark mode");
  });
});
