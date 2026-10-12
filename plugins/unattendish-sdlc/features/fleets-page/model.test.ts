import { describe, expect, it } from "vitest";
import { headerCount, headerCountLabel } from "./model";

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
