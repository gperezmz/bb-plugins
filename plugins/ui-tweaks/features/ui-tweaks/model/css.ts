// The stylesheet the content script puts in the page for a pair of tweaks.
import { TEXT_SCALE, WIDTH_PX, type Tweaks } from "@/shared/tweaks";
import {
  COLUMN,
  COMPOSER,
  COMPOSER_EDITOR,
  COMPOSER_TYPEAHEAD_MENU,
  EDITABLE,
  hasTextTarget,
  NEW_THREAD_COLUMN,
  NEW_THREAD_EDITOR,
  NEW_THREAD_EDITOR_WRAPPER,
  NEW_THREAD_TYPEAHEAD_MENU,
  SENT_MESSAGE_EDITOR_HOST,
  TEXT_VARIABLES,
  THREAD_VIEW,
} from "./targets";

/** bb's phone viewport, the media query its own text sizes switch on. */
export const PHONE_QUERY = "(width <= 767px) and (pointer: coarse)";

/**
 * A thread view holding every target; one lacking any matches nothing. A
 * composer column showing no editor needs no editor wrapper.
 */
const VIEW =
  `${THREAD_VIEW}:has(${COLUMN.selector}):has(${COMPOSER.selector})` +
  `:is(:not(:has(${COMPOSER.selector} ${EDITABLE})), :has(${COMPOSER.selector} ${COMPOSER_EDITOR.selector}))`;
const IN_COLUMN = `${VIEW} ${COLUMN.selector}`;
const IN_COMPOSER_EDITOR = `${VIEW} ${COMPOSER.selector} ${COMPOSER_EDITOR.selector}`;
const IN_COMPOSER_TYPEAHEAD_MENU = `${VIEW} ${COMPOSER.selector} ${COMPOSER_TYPEAHEAD_MENU}`;

/** A New-thread screen's column holding its editor wrapper; one lacking either matches nothing. */
const NEW_THREAD = `${NEW_THREAD_COLUMN.selector}:has(${NEW_THREAD_EDITOR_WRAPPER.selector} ${NEW_THREAD_EDITOR})`;
const IN_NEW_THREAD_EDITOR_WRAPPER = `${NEW_THREAD} ${NEW_THREAD_EDITOR_WRAPPER.selector}:has(${NEW_THREAD_EDITOR})`;
const IN_NEW_THREAD_TYPEAHEAD_MENU = `${NEW_THREAD} ${NEW_THREAD_TYPEAHEAD_MENU}`;

// bb's text utilities that bypass the --text-* variables, with the font size
// each one sets or the line height in steps of --spacing.
const FIXED_LINE_HEIGHTS: readonly [string, number][] = [
  [".leading-4", 4],
  [".leading-5", 5],
];
const FIXED_FONT_SIZES: readonly [string, string][] = [
  [".text-\\[9px\\]", "9px"],
  [".text-\\[10px\\]", "10px"],
  [".text-\\[11px\\]", "11px"],
  [".text-\\[0\\.8rem\\]", ".8rem"],
];

/**
 * The CSS for these tweaks: empty when both are Medium, and when the root
 * lacks --text-sm, since then no thread view or New-thread screen has all
 * its targets.
 *
 * @param tweaks The saved tweaks.
 * @param rootVariables bb's `--text-*` variables, their `--line-height`
 *   companions and `--spacing` as the page's root holds them on a viewport
 *   that is not a phone. A variable that is absent is left alone.
 * @param remPx The root's font size in px, which a rem is.
 */
export function tweaksCss(tweaks: Tweaks, rootVariables: Readonly<Record<string, string>>, remPx: number): string {
  if (!hasTextTarget(rootVariables)) return "";
  const rules: string[] = [];
  const scale = TEXT_SCALE[tweaks.textSize];
  if (scale !== 1) {
    const scopes = [IN_COLUMN, IN_COMPOSER_EDITOR, IN_COMPOSER_TYPEAHEAD_MENU, IN_NEW_THREAD_EDITOR_WRAPPER, IN_NEW_THREAD_TYPEAHEAD_MENU];
    for (const scope of scopes) rules.push(...scaledTextRules(scope, scale, rootVariables, remPx));
    // Puts bb's own sizes back inside the column's scaled ones.
    rules.push(...scaledTextRules(`${IN_COLUMN} ${SENT_MESSAGE_EDITOR_HOST}`, 1, rootVariables, remPx));
  }
  const width = WIDTH_PX[tweaks.width];
  if (width !== WIDTH_PX.medium) {
    // The inline --md-content-w bb sets on a column yields only to !important.
    const column = `max-width: ${width}px; --md-content-w: ${width}px !important;`;
    rules.push(`${IN_COLUMN} { ${column} }`);
    rules.push(`${VIEW} ${COMPOSER.selector} { max-width: ${width}px; }`);
    rules.push(`${NEW_THREAD} { ${column} }`);
  }
  if (rules.length === 0) return "";
  return `@media not (${PHONE_QUERY}) {\n${rules.map((rule) => `  ${rule}`).join("\n")}\n}\n`;
}

/** The rules that scale bb's text by `scale` inside `scope`. */
function scaledTextRules(scope: string, scale: number, rootVariables: Readonly<Record<string, string>>, remPx: number): string[] {
  const variables: string[] = [];
  for (const name of TEXT_VARIABLES) {
    const size = rootVariables[name];
    if (size) variables.push(`${name}: ${scaledLength(size, scale, remPx)};`);
    // A unitless line height follows the font size by itself.
    const lineHeight = rootVariables[`${name}--line-height`];
    if (lineHeight && /[a-z%]/i.test(lineHeight.replace(/calc/g, ""))) {
      variables.push(`${name}--line-height: ${scaledLength(lineHeight, scale, remPx)};`);
    }
  }
  const rules = [`${scope} { ${variables.join(" ")} }`];
  const spacing = toPx(rootVariables["--spacing"], remPx);
  for (const [utility, steps] of FIXED_LINE_HEIGHTS) {
    const lineHeight = spacing === null ? `calc(var(--spacing) * ${steps})` : `${spacing * steps}px`;
    const scaled = scaledLength(lineHeight, scale, remPx);
    rules.push(`${scope} ${utility} { --tw-leading: ${scaled}; line-height: ${scaled}; }`);
    rules.push(`${scope} .\\!${utility.slice(1)} { --tw-leading: ${scaled} !important; line-height: ${scaled} !important; }`);
  }
  for (const [utility, size] of FIXED_FONT_SIZES) {
    rules.push(`${scope} ${utility} { font-size: ${scaledLength(size, scale, remPx)}; }`);
  }
  return rules;
}

/**
 * A length scaled and rounded to a whole pixel.
 *
 * @param length A CSS length. One in neither px nor rem is scaled without
 *   rounding.
 * @param scale The text size's ratio to bb's size. At 1, `length` comes back
 *   as it is.
 * @param remPx The root's font size in px, which a rem is.
 */
export function scaledLength(length: string, scale: number, remPx: number): string {
  if (scale === 1) return length;
  const px = toPx(length, remPx);
  return px === null ? `calc(${length} * ${scale})` : `${Math.round(px * scale)}px`;
}

/** A length in px or rem as a number of px, or null for any other. */
function toPx(length: string | undefined, remPx: number): number | null {
  const match = /^(\d*\.?\d+)(px|rem)$/.exec(length?.trim() ?? "");
  if (!match) return null;
  return Number(match[1]) * (match[2] === "rem" ? remPx : 1);
}
