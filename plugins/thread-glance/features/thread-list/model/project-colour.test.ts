import { describe, expect, it } from "vitest";
import { automaticColour, contrastRatio, hexToRgb, hueOf, projectColours, readableColour, stripeShown, themeBackground, withAlpha } from "./project-colour";

/** HSL saturation and lightness (0 to 100) of a `#rrggbb`. */
function saturationLightness(hex: string): { s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s: s * 100, l: l * 100 };
}

const ids = Array.from({ length: 60 }, (_, index) => `project-${index}`);

describe("automatic project colours", () => {
  it("keeps saturation in 26-37 % and lightness in 62-69 %", () => {
    for (const id of ids) {
      const { s, l } = saturationLightness(automaticColour(id));
      expect(s).toBeGreaterThanOrEqual(25);
      expect(s).toBeLessThanOrEqual(38);
      expect(l).toBeGreaterThanOrEqual(61);
      expect(l).toBeLessThanOrEqual(70);
    }
  });

  it("is the same for the same id and differs between ids", () => {
    expect(automaticColour("a")).toBe(automaticColour("a"));
    expect(new Set(ids.map((id) => automaticColour(id))).size).toBeGreaterThan(40);
  });

  it("steps a hue away from every colour already taken", () => {
    const colours = projectColours(ids.slice(0, 8), {});
    const hues = [...colours.values()].map(hueOf);
    for (let a = 0; a < hues.length; a += 1) {
      for (let b = a + 1; b < hues.length; b += 1) {
        const apart = Math.abs(hues[a]! - hues[b]!);
        expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("takes an override as it is, and keeps the others' hues away from it", () => {
    const override = automaticColour("project-1");
    const colours = projectColours(["project-0", "project-1", "project-2"], { "project-0": override });
    expect(colours.get("project-0")).toBe(override);
    const apart = Math.abs(hueOf(colours.get("project-1")!) - hueOf(override));
    expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(20);
  });

  it("does not move a colour when the projects arrive in another order", () => {
    const forward = projectColours(["b", "a", "c"], {});
    const backward = projectColours(["c", "a", "b"], {});
    for (const id of ["a", "b", "c"]) expect(forward.get(id)).toBe(backward.get(id));
  });
});

describe("readable project names", () => {
  it("nudges a soft colour to 4.5:1 against each theme and leaves a readable one", () => {
    for (const id of ids) {
      for (const theme of ["light", "dark"] as const) {
        const readable = readableColour(automaticColour(id), theme);
        expect(contrastRatio(readable, themeBackground(theme))).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(readableColour("#000000", "light")).toBe("#000000");
    expect(readableColour("#ffffff", "dark")).toBe("#ffffff");
  });

  it("nudges toward black on light and toward white on dark", () => {
    const soft = "#8fb3a0";
    expect(hexToRgb(readableColour(soft, "light")).g).toBeLessThan(hexToRgb(soft).g);
    expect(hexToRgb(readableColour("#4a6a5a", "dark")).g).toBeGreaterThan(hexToRgb("#4a6a5a").g);
  });
});

describe("where a stripe shows", () => {
  it("follows Show stripes in; project headers show it in every mode", () => {
    expect(["full", "collapsed", "group"].map((surface) => stripeShown("full-and-collapsed", surface as "full"))).toEqual([true, true, true]);
    expect(["full", "collapsed", "group"].map((surface) => stripeShown("full", surface as "full"))).toEqual([true, false, true]);
    expect(["full", "collapsed", "group"].map((surface) => stripeShown("grouped", surface as "full"))).toEqual([false, false, true]);
  });
});

describe("withAlpha", () => {
  it("writes the colour at the opacity", () => {
    expect(withAlpha("#102030", 0.2)).toBe("rgba(16, 32, 48, 0.2)");
  });
});
