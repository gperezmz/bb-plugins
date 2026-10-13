// How a control is drawn, as a test can read it from jsdom: the classes it carries.
import { expect } from "vitest";

/** `button` is drawn as Grant… is: outlined in the grant tone (purple), in medium weight. */
export function expectGrantLook(button: HTMLElement): void {
  expect(button.className.split(" ")).toEqual(expect.arrayContaining(["border", "border-pr-merged", "text-pr-merged", "font-medium"]));
  expect(button.className).not.toContain("border-border");
}
