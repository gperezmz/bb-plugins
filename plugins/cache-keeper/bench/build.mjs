// Bundles the plugin's real server and host entries into bench/.build, as
// the benchmark's plugin and host processes load them. The one addition is a
// handle on the engine's class (`globalThis.__cacheKeeperBench`), which the
// plugin process uses to count and time the drive clock's work; nothing in
// the plugin's code is changed.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const bench = dirname(fileURLToPath(import.meta.url));
export const BUILD = join(bench, ".build");

const exposeEngine = {
  name: "expose-engine",
  setup(b) {
    b.onLoad({ filter: /src[\\/]server[\\/]engine\.ts$/ }, async (args) => ({
      contents: `${await readFile(args.path, "utf8")}\n;(globalThis as { __cacheKeeperBench?: unknown }).__cacheKeeperBench = { Engine };\n`,
      loader: "ts",
    }));
  },
};

export async function bundle() {
  await build({
    absWorkingDir: join(bench, ".."),
    entryPoints: { server: "server.ts", host: "host.ts" },
    outdir: BUILD,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    external: ["better-sqlite3"],
    // CommonJS dependencies (the SDK's cross-spawn) call require.
    banner: { js: 'import { createRequire as __benchRequire } from "node:module"; const require = __benchRequire(import.meta.url);' },
    logLevel: "warning",
    plugins: [exposeEngine],
  });
  return { server: join(BUILD, "server.mjs"), host: join(BUILD, "host.mjs") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await bundle());
