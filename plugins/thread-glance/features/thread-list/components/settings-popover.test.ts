// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { focusOutsideCloses } from "./settings-popover";

describe("focus moving outside the settings popover", () => {
  it("closes it once a key was pressed while it was open", () => {
    expect(focusOutsideCloses(true, document.createElement("div"))).toBe(true);
  });
  it("leaves it open when nothing was pressed, as when bb focuses its composer after a load", () => {
    expect(focusOutsideCloses(false, document.createElement("div"))).toBe(false);
  });
  it("closes it on a move into a frame, whose clicks the page never sees", () => {
    expect(focusOutsideCloses(false, document.createElement("iframe"))).toBe(true);
  });
});
