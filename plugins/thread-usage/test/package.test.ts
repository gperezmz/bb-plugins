/**
 * What the published package carries: the models.dev copy the plugin falls
 * back on, with models.dev's licence, and none of LiteLLM's. `npm pack
 * --dry-run` lists the files the `files` field selects, without building.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = (JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" })) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);

describe("the package's files", () => {
  it("carry the models.dev snapshot and models.dev's licence text", () => {
    expect(files).toContain("prices/models-dev-prices.json");
    expect(files).toContain("prices/LICENSE-models-dev.txt");
    expect(readFileSync("prices/LICENSE-models-dev.txt", "utf8")).toMatch(/^MIT License\n\nCopyright \(c\) 2025 models\.dev/);
  });

  it("carry no LiteLLM price list or licence file", () => {
    expect(files.filter((f) => /litellm/i.test(f))).toEqual([]);
  });

  it("name the models.dev snapshot in the third-party notices", () => {
    const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
    expect(files).toContain("THIRD_PARTY_NOTICES.md");
    expect(notices).toContain("prices/models-dev-prices.json");
    expect(notices).toContain("prices/LICENSE-models-dev.txt");
    expect(notices).not.toMatch(/litellm/i);
  });

  it("have a snapshot every model of which carries the rates the plugin reads", () => {
    const snapshot = JSON.parse(readFileSync("prices/models-dev-prices.json", "utf8")) as { models: Record<string, { input: number; output: number; tiers?: { above: number }[] }> };
    const models = Object.values(snapshot.models);
    expect(models.length).toBeGreaterThan(1000);
    expect(models.every((m) => typeof m.input === "number" && typeof m.output === "number")).toBe(true);
    // The snapshot keeps every context tier at the size models.dev published, not a size the plugin knows.
    expect(new Set(models.flatMap((m) => m.tiers ?? []).map((t) => t.above)).size).toBeGreaterThan(5);
  });
});
