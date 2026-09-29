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

const BOX = ".chat-prompt-box.max-w-\\[760px\\]";
const WRAPPER = "[data-follow-up-composer] [data-promptbox-editor-scroll]";
const VIEW =
  '[data-thread-window]:not([data-surface-tone]):has(.max-w-\\[760px\\][style*="--md-content-w"]):has(.chat-prompt-box.max-w-\\[760px\\])' +
  `:is(:not(:has(${BOX} :is([contenteditable], textarea):not([data-queued-message-inline-editor] *))), :has(${BOX} ${WRAPPER}))`;
const COLUMN = `${VIEW} .max-w-\\[760px\\][style*="--md-content-w"]`;
const EDITOR = `${VIEW} ${BOX} ${WRAPPER}`;
const NEW_THREAD = '.max-w-\\[760px\\][style*="--md-content-w"]:has([data-promptbox-editor-scroll] #root-compose-prompt)';
const NEW_THREAD_EDITOR = `${NEW_THREAD} [data-promptbox-editor-scroll]:has(#root-compose-prompt)`;

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

  it.each([
    ["small", 12 / 13],
    ["large", 15 / 13],
  ] as const)("scales %s's text in the composer's editor, mention pills included, and nowhere else in the composer", (textSize, scale) => {
    const css = tweaksCss({ textSize, width: "medium" }, ROOT);
    expect(css).toContain(`${EDITOR} { --text-2xs: calc(.625rem * ${scale});`);
    expect(css).toContain(`--text-sm: calc(.8125rem * ${scale});`);
    // A mention pill is text-xs with a fixed leading-4.
    expect(css).toContain(`${EDITOR} .leading-4 { --tw-leading: calc(calc(var(--spacing) * 4) * ${scale}); line-height: calc(calc(var(--spacing) * 4) * ${scale}); }`);
    // Every rule reaching into the composer column is one for its editor.
    const inBox = css.split("\n").filter((rule) => rule.includes(`${VIEW} ${BOX}`));
    expect(inBox.length).toBeGreaterThan(0);
    expect(inBox.filter((rule) => !rule.includes(EDITOR))).toEqual([]);
  });

  it("scales the New-thread screen's typed text by the same ratio, in its editor wrapper only", () => {
    const css = tweaksCss({ textSize: "large", width: "medium" }, ROOT);
    const scale = 15 / 13;
    expect(css).toContain(`${NEW_THREAD_EDITOR} { --text-2xs: calc(.625rem * ${scale});`);
    expect(css).toContain(`${NEW_THREAD_EDITOR} .leading-4 { --tw-leading: calc(calc(var(--spacing) * 4) * ${scale});`);
    expect(css).not.toContain(`${NEW_THREAD} {`);
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
  ] as const)("gives %s's width to the transcript column, its tables, the composer and the New-thread screen's column", (width, px) => {
    const css = tweaksCss({ textSize: "medium", width }, ROOT);
    expect(css).toContain(`${COLUMN} { max-width: ${px}px; --md-content-w: ${px}px !important; }`);
    expect(css).toContain(`${VIEW} .chat-prompt-box.max-w-\\[760px\\] { max-width: ${px}px; }`);
    expect(css).toContain(`${NEW_THREAD} { max-width: ${px}px; --md-content-w: ${px}px !important; }`);
    expect(css).not.toContain("--text-sm:");
  });
});
