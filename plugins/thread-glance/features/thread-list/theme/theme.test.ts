// AC27: colours follow bb's theme, never the system's. The plugin build's
// `dark:` utilities follow the system, so nothing draws with them; the colours
// are variables set under bb's `.light` and `.dark` classes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const css = readFileSync(join(__dirname, "theme.css"), "utf8");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.|testing/.test(path) ? [path] : [];
  });
}

describe("the theme", () => {
  it("sets its colours under bb's .light and .dark classes, and each theme has its own", () => {
    const light = /:root,\s*\.light\s*\{([^}]*)\}/.exec(css)![1]!;
    const dark = /\.dark\s*\{([^}]*)\}/.exec(css)![1]!;
    const failed = (block: string) => /--tg-failed:\s*(#[0-9a-f]{6})/.exec(block)![1];
    expect(failed(light)).not.toBe(failed(dark));
    expect(failed(light)).toBe("#b91c1c");
  });

  it("never reads the system's colour scheme", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it("is drawn without any dark: utility", () => {
    const files = [...sources(join(root, "features")), join(root, "app.tsx")];
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => /(^|[\s"'`{])dark:/.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });
});
