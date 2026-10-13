// The plugin draws every colour from bb's theme tokens: no Tailwind palette colour and no colour value of its own,
// which would ignore bb's palette, and no `dark:` variant, which in a plugin follows the operating system's mode
// rather than bb's own setting.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TONE_BORDER, TONE_FILL, TONE_TEXT } from "./tones";

const root = join(import.meta.dirname, "..", "..");
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)) : [join(dir, name)]));
/**
 * Files left out, each with why: the Connect popup's overlay dims the page in black, and the popup
 * is redrawn by its own spec (#259).
 */
const EXCEPTIONS = new Set(["components/ui/dialog.tsx"]);
const uiFiles = (): string[] => [join(root, "app.tsx"), ...["features", "shared", "components", "lib"].flatMap((folder) => filesUnder(join(root, folder)))].filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));

const PALETTE = /(?<!dark:)\b(?:text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide)-(?:red|blue|green|amber|yellow|purple|violet|orange|gray|grey|slate|zinc|neutral|stone|emerald|sky|indigo|pink|rose|lime|teal|cyan|fuchsia|black|white)(?:-\d{2,3})?\b/;
const VALUE = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![0-9])|\brgba?\(|\bhsla?\(|\boklch\(/i;

/** The colour classes and values a source text names that are not bb's tokens. */
export function foreignColours(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [PALETTE, VALUE, /\bdark:[\w-]+/]) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(global)) found.push(match[0]);
  }
  // `#163` names an item, not a colour.
  return found.filter((hit) => !/^#\d+$/.test(hit));
}

describe("the plugin's colours", () => {
  it("are all bb's theme tokens, with no dark: variant", () => {
    const hits = uiFiles()
      .filter((file) => !EXCEPTIONS.has(relative(root, file)))
      .flatMap((file) => foreignColours(readFileSync(file, "utf8")).map((hit) => `${relative(root, file)}: ${hit}`));
    expect(hits).toEqual([]);
  });

  it("see a palette colour, a colour value and a dark: variant", () => {
    // Spelled in pieces: Tailwind scans this file too, and a whole class here would ship in the plugin's CSS.
    const purple = ["text", "purple", "600"].join("-");
    const dark = ["dark", ["text", "white"].join("-")].join(":");
    const red = ["bg", "[#ff0000]"].join("-");
    expect(foreignColours(`className="${purple} ${red} ${dark}" style={{ color: "rgb(1,2,3)" }}`)).toEqual([purple, "#ff0000", "rgb(", dark]);
    expect(foreignColours('"text-timeline-accent text-warning-text" #163')).toEqual([]);
  });

  it("give coloured text the text variants of the error and warning tones", () => {
    expect(TONE_TEXT.red).toBe("text-destructive-text");
    expect(TONE_TEXT.amber).toBe("text-warning-text");
    for (const classes of [TONE_TEXT, TONE_FILL, TONE_BORDER]) for (const name of Object.values(classes)) expect(foreignColours(name), name).toEqual([]);
  });
});
