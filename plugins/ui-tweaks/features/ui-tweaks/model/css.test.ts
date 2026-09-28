import { describe, expect, it } from "vitest";
import { tweaksCss } from "./css";

// bb 0.44.0's root values on a viewport that is not a phone.
const ROOT = {
  "--text-2xs": ".625rem",
  "--text-2xs--line-height": ".875rem",
  "--text-xs": ".75rem",
  "--text-xs--line-height": "calc(1 / .75)",
  "--text-sm": ".8125rem",
  "--text-sm--line-height": "calc(1.25 / .875)",
  "--text-base": ".9375rem",
  "--text-base--line-height": "1.375rem",
};

const VIEW = '[data-thread-window]:not([data-surface-tone]):has(.max-w-\\[760px\\][style*="--md-content-w"]):has(.chat-prompt-box.max-w-\\[760px\\])';
const COLUMN = `${VIEW} .max-w-\\[760px\\][style*="--md-content-w"]`;

describe("the tweaks stylesheet", () => {
  it("is empty for Medium and Medium, bb's own look", () => {
    expect(tweaksCss({ textSize: "medium", width: "medium" }, ROOT)).toBe("");
  });

  it("is empty when the root lacks --text-sm", () => {
    const { "--text-sm": _, ...rest } = ROOT;
    expect(tweaksCss({ textSize: "large", width: "wide" }, rest)).toBe("");
  });

  it("applies only off a phone", () => {
    expect(tweaksCss({ textSize: "large", width: "medium" }, ROOT)).toMatch(
      /^@media not \(\(width <= 767px\) and \(pointer: coarse\)\) \{\n/,
    );
  });

  it("scales bb's text variables inside the transcript column only", () => {
    const css = tweaksCss({ textSize: "large", width: "medium" }, ROOT);
    const scale = 15 / 13;
    expect(css).toContain(`${COLUMN} { --text-2xs: calc(.625rem * ${scale});`);
    expect(css).toContain(`--text-sm: calc(.8125rem * ${scale});`);
    expect(css).toContain(`--text-base--line-height: calc(1.375rem * ${scale});`);
    expect(css).toContain(`--text-2xs--line-height: calc(.875rem * ${scale});`);
    // A unitless line height already follows the font size.
    expect(css).not.toContain("--text-sm--line-height");
    expect(css).not.toContain("--text-xs--line-height");
    expect(css).not.toContain(".chat-prompt-box.max-w-\\[760px\\] {");
  });

  it("scales the fixed line heights and font sizes that bypass the variables", () => {
    const css = tweaksCss({ textSize: "small", width: "medium" }, ROOT);
    const scale = 12 / 13;
    expect(css).toContain(
      `${COLUMN} .leading-5 { --tw-leading: calc(calc(var(--spacing) * 5) * ${scale}); line-height: calc(calc(var(--spacing) * 5) * ${scale}); }`,
    );
    expect(css).toContain(`${COLUMN} .\\!leading-4 { --tw-leading: calc(calc(var(--spacing) * 4) * ${scale}) !important;`);
    expect(css).toContain(`${COLUMN} .text-\\[11px\\] { font-size: calc(11px * ${scale}); }`);
    expect(css).not.toContain("max-width");
  });

  it.each([
    ["narrow", 640],
    ["wide", 960],
  ] as const)("gives %s's width to the transcript column, its tables and the composer", (width, px) => {
    const css = tweaksCss({ textSize: "medium", width }, ROOT);
    expect(css).toContain(`${COLUMN} { max-width: ${px}px; --md-content-w: ${px}px !important; }`);
    expect(css).toContain(`${VIEW} .chat-prompt-box.max-w-\\[760px\\] { max-width: ${px}px; }`);
    expect(css).not.toContain("--text-sm:");
  });
});
