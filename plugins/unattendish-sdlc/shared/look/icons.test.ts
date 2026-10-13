// Every icon the plugin names resolves to a real icon: a bb 0.46 built-in, or one of the plugin's own declared icons,
// whose file bb accepts. A name that is neither would draw bb's fallback. The pages' tests check the names they draw
// against the same list through `expectIconsResolve`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectIconsResolve, unresolvedIcons } from "@/testing/icons";
import { DECLARED_ICONS, ICONS, KIND_ICONS, OUTCOME_ICONS, GITHUB_LOGO, STAGE_ICONS } from "./icons";

const root = join(import.meta.dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { bb: { branding: { experimental_icons: Record<string, string> } } };
const declared = manifest.bb.branding.experimental_icons;

describe("the plugin's icons", () => {
  it("are each a bb 0.46 built-in or a declared icon", () => {
    expectIconsResolve([...Object.values(ICONS), ...Object.values(KIND_ICONS), ...Object.values(STAGE_ICONS), ...Object.values(OUTCOME_ICONS), GITHUB_LOGO]);
  });

  it("refuse a name that is neither, and an undeclared name in the plugin's namespace", () => {
    expect(unresolvedIcons(["Zap", "Rocket", "unattendish-sdlc/fleet", "unattendish-sdlc/nope", "other-plugin/fleet"])).toEqual(["Rocket", "unattendish-sdlc/nope", "other-plugin/fleet"]);
  });

  it("name the redo icon for Re-grant alone, in the role table and in every kind, stage, outcome table and the GitHub logo", () => {
    const names = [...Object.values(ICONS), ...Object.values(KIND_ICONS), ...Object.values(STAGE_ICONS), ...Object.values(OUTCOME_ICONS), GITHUB_LOGO];
    expect(ICONS.regrant).toBe("unattendish-sdlc/redo");
    expect(Object.entries(ICONS).filter(([, name]) => name === ICONS.regrant).map(([role]) => role)).toEqual(["regrant"]);
    expect(names.filter((name) => name === ICONS.regrant)).toHaveLength(1);
  });

  it("are declared in package.json, every one of them, each with its file", () => {
    expect(Object.keys(declared).sort()).toEqual([...DECLARED_ICONS].sort());
    for (const [name, path] of Object.entries(declared)) expect(path, name).toBe(`./icons/${name}.svg`);
  });

  it("have files bb accepts: an svg root, under 32 KiB, with nothing bb refuses, drawn in the current colour", () => {
    for (const name of DECLARED_ICONS) {
      const svg = readFileSync(join(root, "icons", `${name}.svg`), "utf8");
      expect(svg.length, name).toBeLessThan(32 * 1024);
      expect(svg, name).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="0 0 24 24"/);
      expect(svg, name).not.toMatch(/<(script|style|image|foreignObject|a|iframe)\b|\son\w+=|<!DOCTYPE|<\?/i);
      expect(svg, name).toContain("currentColor");
    }
  });
});
