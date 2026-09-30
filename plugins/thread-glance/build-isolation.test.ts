// The shipped app is built from the app's own code alone: `bb plugin build`
// scans the plugin's folder for Tailwind class names, so a word in a test
// file can add a rule to app.css. The app is built twice, once from the
// folder as it is and once without its test-only files (perf/, testing/,
// *.test.*), and app.js and app.css must come out byte-identical.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";

const plugin = fileURLToPath(new URL("./", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "thread-glance-build-"));

// KEEP_BUILDS=1 keeps both builds, to diff the two app.css files.
afterAll(() => {
  if (!process.env.KEEP_BUILDS) rmSync(scratch, { recursive: true, force: true });
});

/** Output and local state, never part of what is built. */
const NOT_SOURCE = new Set(["node_modules", "dist", ".vitest", ".drives"]);

function isTestOnly(path: string): boolean {
  const parts = path.split(sep);
  return parts[0] === "perf" || parts.includes("testing") || /\.test\.[cm]?[jt]sx?$/.test(basename(path));
}

/** Copies the plugin's folder, with or without its test-only files, and builds it. */
function build(name: string, withTests: boolean): { js: Buffer; css: Buffer } {
  const dir = join(scratch, name);
  cpSync(plugin, dir, {
    recursive: true,
    filter: (source) => {
      const path = relative(plugin, source);
      if (path === "") return true;
      if (NOT_SOURCE.has(path.split(sep)[0]!)) return false;
      return withTests || !isTestOnly(path);
    },
  });
  symlinkSync(join(plugin, "node_modules"), join(dir, "node_modules"), "dir");
  execFileSync(process.env.BB_CLI ?? "bb", ["plugin", "build"], { cwd: dir, stdio: "pipe" });
  return { js: readFileSync(join(dir, "dist", "app.js")), css: readFileSync(join(dir, "dist", "app.css")) };
}

it("builds the same app.js and app.css with and without the test-only files", () => {
  const full = build("full", true);
  const app = build("app-only", false);
  expect(full.js.equals(app.js), "app.js differs: a test-only file changes the shipped bundle").toBe(true);
  expect(full.css.equals(app.css), "app.css differs: a test-only file adds Tailwind classes to the shipped CSS").toBe(true);
}, 300_000);
