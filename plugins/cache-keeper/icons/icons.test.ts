// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

const icons = pkg.bb.branding.experimental_icons as Record<string, string>;

describe("Cache Keeper's icons", () => {
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
