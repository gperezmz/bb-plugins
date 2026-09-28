// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

const icons = pkg.bb.branding.experimental_icons as Record<string, string>;

describe("Cache Keeper's icons", () => {
  it("registers the flame beside the timer", () => {
    expect(icons.flame).toBe("./icons/flame.svg");
  });

  it("registers the crossed-out flame beside the flame, drawn as the flame with one diagonal stroke across it", () => {
    expect(icons["crossed-out-flame"]).toBe("./icons/crossed-out-flame.svg");
    const paths = (path: string) => {
      const svg = readFileSync(join(import.meta.dirname, "..", path), "utf8");
      return [...new DOMParser().parseFromString(svg, "image/svg+xml").documentElement.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    };
    expect(paths(icons["crossed-out-flame"]!)).toEqual([...paths(icons.flame!), "M3 3l18 18"]);
  });

  it("brands the plugin with the timer", () => {
    expect(pkg.bb.branding.icon).toBe("./icons/timer.svg");
    expect(icons["cache-keeper"]).toBe("./icons/timer.svg");
  });

  for (const [name, path] of Object.entries(icons)) it(`draws ${name} like bb's icons`, () => {
    const svg = readFileSync(join(import.meta.dirname, "..", path), "utf8");
    const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    expect(root.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(root.getAttribute("fill")).toBe("none");
    expect(root.getAttribute("stroke")).toBe("currentColor");
    expect(root.getAttribute("stroke-width")).toBe("2");
    expect(root.getAttribute("stroke-linecap")).toBe("round");
    expect(root.getAttribute("stroke-linejoin")).toBe("round");
  });
});
