// The bundle check: `app.js` within the enforcing size row (B1, or B2 once
// #146 has merged), raw and gzip, as `bb plugin build` writes it.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptyFigures } from "./figures";
import { evaluate } from "./ledger";
import { buildAndMeasure, bundleFigures } from "./harness/bundle";

/** The enforcing bundle rows this `app.js` misses. */
function missed(appJs: Buffer): string[] {
  return evaluate({ ...emptyFigures(), bundle: bundleFigures(appJs) })
    .filter((verdict) => verdict.failed)
    .map((verdict) => verdict.row.id);
}

describe("the bundle check", () => {
  it("passes a build at the raw and gzip figures", () => {
    expect(missed(Buffer.alloc(250_000, "a"))).toEqual([]);
  });

  it("fails a build over the raw figure", () => {
    expect(missed(Buffer.alloc(250_001, "a"))).toEqual(["B2"]);
  });

  it("fails a build over the gzip figure", () => {
    // Random bytes do not compress, so 100 KB of them gzip past 80 KB.
    expect(missed(randomBytes(100_000))).toEqual(["B2"]);
  });

  it("holds for the app `bb plugin build` writes", () => {
    const figures = buildAndMeasure(fileURLToPath(new URL("../", import.meta.url)));
    console.log(`app.js: ${figures.rawBytes} bytes raw, ${figures.gzipBytes} gzip, ${figures.brotliBytes} brotli`);
    expect(evaluate({ ...emptyFigures(), bundle: figures }).filter((verdict) => verdict.failed).map((verdict) => verdict.row.id)).toEqual([]);
  }, 300_000);
});
