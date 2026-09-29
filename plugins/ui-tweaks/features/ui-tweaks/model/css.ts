// The stylesheet the content script puts in the page for a pair of tweaks.
import { TEXT_SCALE, WIDTH_PX, type Tweaks } from "@/shared/tweaks";
import { COLUMN, COMPOSER, COMPOSER_EDITOR, EDITABLE, hasTextTarget, TEXT_VARIABLES, THREAD_VIEW } from "./targets";

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

// bb's text utilities that bypass the --text-* variables, with the font size
// or line height each one sets.
const FIXED_LINE_HEIGHTS: readonly [string, string][] = [
  [".leading-4", "calc(var(--spacing) * 4)"],
  [".leading-5", "calc(var(--spacing) * 5)"],
];
const FIXED_FONT_SIZES: readonly [string, string][] = [
  [".text-\\[9px\\]", "9px"],
  [".text-\\[10px\\]", "10px"],
  [".text-\\[11px\\]", "11px"],
  [".text-\\[0\\.8rem\\]", ".8rem"],
];

/**
 * The CSS for these tweaks: empty when both are Medium, and when the root
 * lacks --text-sm, since then no thread view has all its targets.
 *
 * @param tweaks The saved tweaks.
 * @param rootVariables bb's `--text-*` variables and their `--line-height`
 *   companions as the page's root holds them on a viewport that is not a
 *   phone. A variable that is absent is left alone.
 */
export function tweaksCss(tweaks: Tweaks, rootVariables: Readonly<Record<string, string>>): string {
  if (!hasTextTarget(rootVariables)) return "";
  const rules: string[] = [];
  const scale = TEXT_SCALE[tweaks.textSize];
  if (scale !== 1) {
    for (const scope of [IN_COLUMN, IN_COMPOSER_EDITOR]) rules.push(...scaledTextRules(scope, scale, rootVariables));
  }
  const width = WIDTH_PX[tweaks.width];
  if (width !== WIDTH_PX.medium) {
    // The inline --md-content-w bb sets on the column yields only to !important.
    rules.push(`${IN_COLUMN} { max-width: ${width}px; --md-content-w: ${width}px !important; }`);
    rules.push(`${VIEW} ${COMPOSER.selector} { max-width: ${width}px; }`);
  }
  if (rules.length === 0) return "";
  return `@media not (${PHONE_QUERY}) {\n${rules.map((rule) => `  ${rule}`).join("\n")}\n}\n`;
}

/** The rules that scale bb's text by `scale` inside `scope`. */
function scaledTextRules(scope: string, scale: number, rootVariables: Readonly<Record<string, string>>): string[] {
  const variables: string[] = [];
  for (const name of TEXT_VARIABLES) {
    const size = rootVariables[name];
    if (size) variables.push(`${name}: calc(${size} * ${scale});`);
    // A unitless line height follows the font size by itself.
    const lineHeight = rootVariables[`${name}--line-height`];
    if (lineHeight && /[a-z%]/i.test(lineHeight.replace(/calc/g, ""))) {
      variables.push(`${name}--line-height: calc(${lineHeight} * ${scale});`);
    }
  }
  const rules = [`${scope} { ${variables.join(" ")} }`];
  for (const [utility, lineHeight] of FIXED_LINE_HEIGHTS) {
    const scaled = `calc(${lineHeight} * ${scale})`;
    rules.push(`${scope} ${utility} { --tw-leading: ${scaled}; line-height: ${scaled}; }`);
    rules.push(`${scope} .\\!${utility.slice(1)} { --tw-leading: ${scaled} !important; line-height: ${scaled} !important; }`);
  }
  for (const [utility, size] of FIXED_FONT_SIZES) {
    rules.push(`${scope} ${utility} { font-size: calc(${size} * ${scale}); }`);
  }
  return rules;
}
