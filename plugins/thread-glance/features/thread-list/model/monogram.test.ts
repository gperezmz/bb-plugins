import { describe, expect, it } from "vitest";
import { MONOGRAM_TILES, monogramLetter, monogramTile } from "./monogram";

describe("monogramLetter", () => {
  it.each([
    ["Thread Glance", "T"],
    ["bb-plugins", "P"],
    ["bb-sidebar", "S"],
    ["my-app", "A"],
    ["the plugin tasks", "T"],
    ["@acme/billing-api", "B"],
    ["~/code/orders", "O"],
    ["C:\\work\\ledger", "L"],
    ["MyBigApp", "B"],
    ["bb", "B"],
    ["éclair", "É"],
    ["", "#"],
  ])("%s -> %s", (name, letter) => {
    expect(monogramLetter(name)).toBe(letter);
  });
});

describe("monogramTile", () => {
  it("picks one of eight tiles from the name, the same every time", () => {
    const tiles = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"].map(monogramTile);
    for (const tile of tiles) {
      expect(tile).toBeGreaterThanOrEqual(0);
      expect(tile).toBeLessThan(MONOGRAM_TILES);
    }
    expect(monogramTile("alpha")).toBe(monogramTile(" Alpha "));
    expect(new Set(tiles).size).toBeGreaterThan(3);
  });
});
