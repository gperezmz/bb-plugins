#!/usr/bin/env node
// Regenerates THIRD_PARTY_NOTICES.md from the packages that end up in the
// plugin's bundles. Each entry is bundled with esbuild the way `bb plugin
// build` does (bb's runtime-shimmed packages stay external), and the npm
// packages among the bundle inputs are listed with their licence and
// copyright line.
//
// Usage: node scripts/third-party-notices.mjs
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Provided by bb at runtime, never bundled (see the plugin authoring guide).
const SHIMMED = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@get-bb/plugin-sdk/app",
  "@radix-ui/react-dialog",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-popover",
  "@radix-ui/react-select",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-menubar",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-tooltip",
  "@radix-ui/react-navigation-menu",
  "sonner",
  "vaul",
  "@pierre/diffs",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
];

const ENTRIES = [
  { name: "app", entry: "app.tsx", external: SHIMMED, platform: "browser" },
  { name: "server", entry: "server.ts", external: ["@get-bb/plugin-sdk", "better-sqlite3"], platform: "node" },
  { name: "host", entry: "host.ts", external: [], platform: "node" },
];

// Packages whose package.json declares no licence, with where the answer comes from.
const DECLARED_ELSEWHERE = {
  "@get-bb/plugin-sdk": {
    license: "MIT",
    copyright: "Copyright (c) 2026 Michael Yong (LICENSE of github.com/get-bb/bb, the package's repository)",
  },
};

async function bundleInputs({ entry, external, platform }) {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform,
    external,
    logLevel: "silent",
    alias: { "@": root },
    loader: { ".json": "json" },
  });
  return Object.keys(result.metafile.inputs);
}

function packageOf(input) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  return match === null ? null : match[1];
}

async function copyrightLine(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const file = names.find((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
  if (file === undefined) return null;
  const text = await readFile(join(dir, file), "utf8");
  const line = text.split("\n").find((l) => /copyright/i.test(l) && /\d{4}|\(c\)|©/i.test(l));
  return line === undefined ? null : line.trim();
}

async function main() {
  const packages = new Map();
  for (const target of ENTRIES) {
    for (const input of await bundleInputs(target)) {
      const name = packageOf(input);
      if (name === null) continue;
      const entry = packages.get(name) ?? { bundles: new Set() };
      entry.bundles.add(target.name);
      packages.set(name, entry);
    }
  }
  const rows = [];
  for (const [name, { bundles }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = join(root, "node_modules", name);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const known = DECLARED_ELSEWHERE[name];
    const license =
      typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? known?.license ?? "UNKNOWN");
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    const copyright =
      (await copyrightLine(dir)) ??
      known?.copyright ??
      (author ? `Copyright (c) ${author}` : "No copyright line in the package");
    rows.push({ name, version: pkg.version, license, copyright, bundles: [...bundles].sort().join(", ") });
  }
  const lines = [
    "# Third-party notices",
    "",
    "Thread Usage bundles the packages below into `dist/`. The table is generated",
    "by `scripts/third-party-notices.mjs` from the bundle inputs; rerun it after",
    "changing dependencies. Packages bb provides at runtime (React, the Radix",
    "portal families, sonner and others) are not bundled and are not listed.",
    "",
    "| Package | Version | Licence | Copyright | Bundled into |",
    "|---|---|---|---|---|",
    ...rows.map(
      (r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.copyright.replace(/\|/g, "\\|")} | ${r.bundles} |`,
    ),
    "",
    "## Data",
    "",
    "`prices/litellm-prices.json` is derived from `model_prices_and_context_window.json`",
    "in [BerriAI/litellm](https://github.com/BerriAI/litellm), MIT licence,",
    "Copyright (c) 2023 Berri AI. Its notice is in `prices/LICENSE-litellm.txt`.",
    "",
    "The plugin also fetches [models.dev](https://models.dev)'s `api.json` at",
    "runtime (MIT licence, Copyright (c) 2025 models.dev; the licence text is at",
    "<https://github.com/sst/models.dev/blob/dev/LICENSE>). It is permissive, but",
    "nothing from it is bundled: the data is downloaded to the bb server's plugin",
    "database and is not part of the package.",
    "",
  ];
  await writeFile(join(root, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));
  console.log(`Listed ${rows.length} packages in THIRD_PARTY_NOTICES.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
