// The bundle check: builds the app with `bb plugin build` and reads the size
// of what bb loads, `dist/app.js`, raw, gzip and brotli.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { BundleFigures } from "../figures";

/** The sizes of one `app.js`. */
export function bundleFigures(appJs: Buffer): BundleFigures {
  return { rawBytes: appJs.length, gzipBytes: gzipSync(appJs).length, brotliBytes: brotliCompressSync(appJs).length };
}

/** Builds the plugin in `pluginDir` and measures its `app.js`. */
export function buildAndMeasure(pluginDir: string): BundleFigures {
  execFileSync(process.env.BB_CLI ?? "bb", ["plugin", "build"], { cwd: pluginDir, stdio: "pipe" });
  return bundleFigures(readFileSync(join(pluginDir, "dist", "app.js")));
}
