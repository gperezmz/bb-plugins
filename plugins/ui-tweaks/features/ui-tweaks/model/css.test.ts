import { describe, expect, it } from "vitest";
import { scaledLength, tweaksCss as tweaksCssAtRemPx } from "./css";

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
  "--text-lg": "1.125rem",
  "--text-lg--line-height": "calc(1.75 / 1.125)",
  "--text-xl": "1.25rem",
  "--text-xl--line-height": "calc(1.75 / 1.25)",
  "--text-2xl": "1.5rem",
  "--text-2xl--line-height": "calc(2 / 1.5)",
  "--spacing": ".25rem",
};

/** The stylesheet for a root whose font size is bb's 16 px. */
function tweaksCss(tweaks: Parameters<typeof tweaksCssAtRemPx>[0], root: Record<string, string>): string {
  return tweaksCssAtRemPx(tweaks, root, 16);
}

const BOX = ".chat-prompt-box.max-w-\\[760px\\]";
const WRAPPER = "[data-follow-up-composer] [data-promptbox-editor-scroll]:not([data-queued-message-inline-editor] *)";
const VIEW =
  '[data-thread-window]:not([data-surface-tone]):has(.max-w-\\[760px\\][style*="--md-content-w"]):has(.chat-prompt-box.max-w-\\[760px\\])' +
  `:is(:not(:has(${BOX} :is([contenteditable], textarea):not([data-queued-message-inline-editor] *))), :has(${BOX} ${WRAPPER}))`;
const COLUMN = `${VIEW} .max-w-\\[760px\\][style*="--md-content-w"]`;
const EDITOR = `${VIEW} ${BOX} ${WRAPPER}`;
const MENU =
  `${VIEW} ${BOX} [data-follow-up-composer] [data-promptbox-input-region]:has([data-promptbox-editor-scroll]) ~ ` +
  "[data-promptbox-typeahead-menu]:not([data-queued-message-inline-editor] *)";
const NEW_THREAD = ".max-w-\\[760px\\]:has([data-promptbox-editor-scroll] #root-compose-prompt)";
const NEW_THREAD_WRAPPER = `${NEW_THREAD} [data-promptbox-editor-scroll]:has(#root-compose-prompt)`;
const NEW_THREAD_MENU = `${NEW_THREAD} [data-promptbox-input-region]:has(#root-compose-prompt) ~ [data-promptbox-typeahead-menu]`;

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
    expect(css).toContain(`${COLUMN} { --text-2xs: 12px;`);
    expect(css).toContain("--text-sm: 15px;");
    expect(css).toContain("--text-base--line-height: 25px;");
    expect(css).toContain("--text-2xs--line-height: 16px;");
    // A unitless line height already follows the font size.
    expect(css).not.toContain("--text-sm--line-height");
    expect(css).not.toContain("--text-xs--line-height");
    expect(css).not.toContain(".chat-prompt-box.max-w-\\[760px\\] {");
  });

  it.each([
    ["small", 12, 9, 15],
    ["large", 15, 12, 18],
  ] as const)("scales %s's text in the composer's editor, mention pills included, and nowhere else in the composer", (textSize, sm, twoXs, leading4) => {
    const css = tweaksCss({ textSize, width: "medium" }, ROOT);
    expect(css).toContain(`${EDITOR} { --text-2xs: ${twoXs}px;`);
    expect(css).toContain(`--text-sm: ${sm}px;`);
    // A mention pill is text-xs with a fixed leading-4.
    expect(css).toContain(`${EDITOR} .leading-4 { --tw-leading: ${leading4}px; line-height: ${leading4}px; }`);
    // Every rule reaching into the composer column is one for its editor or its Typeahead menu.
    const inBox = css.split("\n").filter((rule) => rule.includes(`${VIEW} ${BOX}`));
    expect(inBox.length).toBeGreaterThan(0);
    expect(inBox.filter((rule) => !rule.includes(EDITOR) && !rule.includes(MENU))).toEqual([]);
  });

  it("scales the New-thread screen's typed text by the same ratio, in its editor wrapper only", () => {
    const css = tweaksCss({ textSize: "large", width: "medium" }, ROOT);
    expect(css).toContain(`${NEW_THREAD_WRAPPER} { --text-2xs: 12px;`);
    expect(css).toContain(`${NEW_THREAD_WRAPPER} .leading-4 { --tw-leading: 18px;`);
    expect(css).not.toContain(`${NEW_THREAD} {`);
  });

  it.each([
    ["small", 11, 9],
    ["large", 14, 12],
  ] as const)("scales %s's text in the Typeahead menu the composer opens, in a thread view and on the New-thread screen", (textSize, xs, twoXs) => {
    const css = tweaksCss({ textSize, width: "medium" }, ROOT);
    for (const menu of [MENU, NEW_THREAD_MENU]) {
      const rule = css.split("\n").find((line) => line.includes(`${menu} { `));
      expect(rule).toContain(`--text-xs: ${xs}px;`);
      expect(rule).toContain(`--text-2xs: ${twoXs}px;`);
      // Its icons and width are set in --spacing and rem, never in a text variable.
      expect(rule).not.toMatch(/--spacing|width|size-/);
    }
  });

  it("puts bb's own sizes back in the editor bb moves into the transcript to edit a sent message", () => {
    const css = tweaksCss({ textSize: "large", width: "medium" }, ROOT);
    const host = `${COLUMN} [data-sent-message-inline-editor-host]`;
    expect(css).toContain(`${host} { --text-2xs: .625rem;`);
    expect(css).toContain(`${host} .leading-4 { --tw-leading: 16px; line-height: 16px; }`);
    expect(css).toContain(`${host} .text-\\[0\\.8rem\\] { font-size: .8rem; }`);
    expect(css.indexOf(`${host} {`)).toBeGreaterThan(css.indexOf(`${COLUMN} {`));
  });

  it("scales the fixed line heights and font sizes that bypass the variables", () => {
    const css = tweaksCss({ textSize: "small", width: "medium" }, ROOT);
    expect(css).toContain(`${COLUMN} .leading-5 { --tw-leading: 18px; line-height: 18px; }`);
    expect(css).toContain(`${COLUMN} .\\!leading-4 { --tw-leading: 15px !important; line-height: 15px !important; }`);
    expect(css).toContain(`${COLUMN} .text-\\[11px\\] { font-size: 10px; }`);
    expect(css).toContain(`${COLUMN} .text-\\[0\\.8rem\\] { font-size: 12px; }`);
    expect(css).not.toContain("max-width");
  });

  it.each([
    ["small", { "--text-2xs": 9, "--text-xs": 11, "--text-sm": 12, "--text-base": 14, "--text-lg": 17, "--text-xl": 18, "--text-2xl": 22 }],
    ["large", { "--text-2xs": 12, "--text-xs": 14, "--text-sm": 15, "--text-base": 17, "--text-lg": 21, "--text-xl": 23, "--text-2xl": 28 }],
  ] as const)("rounds each of bb's text variables under %s to a whole pixel", (textSize, sizes) => {
    const css = tweaksCss({ textSize, width: "medium" }, ROOT);
    const column = css.split("\n").find((rule) => rule.includes(`${COLUMN} { `));
    for (const [name, px] of Object.entries(sizes)) expect(column).toContain(` ${name}: ${px}px;`);
    expect(css).not.toMatch(/\d\.\d+px/);
  });

  it.each([
    ["9px", 8, 10],
    ["10px", 9, 12],
    ["11px", 10, 13],
    [".75rem", 11, 14],
    [".8125rem", 12, 15],
    [".9375rem", 14, 17],
    ["1.125rem", 17, 21],
    ["1.25rem", 18, 23],
    ["1.5rem", 22, 28],
    [".8rem", 12, 15],
  ] as const)("scales %s to %i px under Small and %i px under Large", (length, small, large) => {
    expect(scaledLength(length, 12 / 13, 16)).toBe(`${small}px`);
    expect(scaledLength(length, 15 / 13, 16)).toBe(`${large}px`);
  });

  it("keeps bb's own length under Medium, and scales one in neither px nor rem without rounding", () => {
    expect(scaledLength(".8rem", 1, 16)).toBe(".8rem");
    expect(scaledLength("1em", 15 / 13, 16)).toBe(`calc(1em * ${15 / 13})`);
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
