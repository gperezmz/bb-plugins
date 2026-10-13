// Writes THIRD_PARTY_NOTICES.md: every third-party package bundled into
// dist/. The server bundle's packages are read from its source map, so run
// this after `bb plugin build .`; the app bundle's are read by bundling
// app.tsx the way `bb plugin build` does, with bb's runtime-shimmed packages
// left out:
//
//   node scripts/third-party-notices.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;

// Packages whose package.json declares no licence, with where the answer comes from.
const DECLARED_ELSEWHERE = {
  "@get-bb/plugin-sdk": {
    licence: "MIT",
    copyright: "Copyright (c) 2026 Michael Yong (LICENSE of github.com/get-bb/bb, the package's repository)",
  },
};

function packageOf(path) {
  const rest = path.split("node_modules/").pop().split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

function fromSourceMap(file) {
  const map = JSON.parse(readFileSync(join(root, file), "utf8"));
  return map.sources.filter((source) => source.includes("node_modules/")).map(packageOf);
}

function copyrightOf(dir) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE", "COPYING"]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split("\n").map((text) => text.trim()).find((text) => /^copyright\b|^\(c\)|©/i.test(text));
    if (line) return line;
  }
  return null;
}

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

async function fromAppEntry() {
  const result = await build({
    entryPoints: [join(root, "app.tsx")],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    external: SHIMMED,
    logLevel: "silent",
    alias: { "@": root },
  });
  return Object.keys(result.metafile.inputs).filter((input) => input.includes("node_modules/")).map(packageOf);
}

const bundles = {
  "dist/app.js": await fromAppEntry(),
  "dist/server.js": fromSourceMap("dist/server.js.map"),
};
const packages = new Map();
for (const [bundle, names] of Object.entries(bundles)) {
  for (const name of names) {
    if (!packages.has(name)) packages.set(name, new Set());
    packages.get(name).add(bundle);
  }
}

const rows = [...packages.keys()].sort().map((name) => {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const licence = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? DECLARED_ELSEWHERE[name]?.licence ?? "not declared in its package.json");
  const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
  const copyright = copyrightOf(dir) ?? DECLARED_ELSEWHERE[name]?.copyright ?? (author ? `Copyright (c) ${author}` : "no copyright line in the package");
  return { name, version: pkg.version, licence, copyright, bundles: [...packages.get(name)].sort().join(", ") };
});

// The declared icons under icons/ copied from icon sets, with where each came from. fleet.svg is the plugin's own.
const LUCIDE = { source: "Lucide (lucide-static)", version: "1.55.0", licence: "ISC", copyright: "Copyright (c) Lucide Contributors 2022; portions Copyright (c) Cole Bemis 2013-2022 (Feather, MIT)" };
const ICONS = [
  ["circle-dashed.svg", "circle-dashed", LUCIDE],
  ["hammer.svg", "hammer", LUCIDE],
  ["hourglass.svg", "hourglass", LUCIDE],
  ["key.svg", "key-round", LUCIDE],
  ["lightbulb.svg", "lightbulb", LUCIDE],
  ["redo.svg", "redo", LUCIDE],
  ["rocket.svg", "rocket", LUCIDE],
  ["scale.svg", "scale", LUCIDE],
  ["user-x.svg", "user-x", LUCIDE],
];

// The brand logos `shared/look/brand-logos.tsx` draws, each its owner's trademark and published artwork. Retrieved on
// the date given; the shapes and colours are the file's, and the only change is GitLab's viewBox cropped to the mark.
const RETRIEVED = "2026-10-14";
const LOGOS = [
  ["GitLab", "GitLab Inc.", "gitlab-logo-500-rgb.svg (Logomark), https://about.gitlab.com/images/press/gitlab-logo-500-rgb.svg, from the press kit at https://about.gitlab.com/press/press-kit/", "viewBox cropped to the mark"],
  ["Jira", "Atlassian", "Jira_icon.svg, in https://atlassian.design/assets/700bfde52eb7/logos/jira_app.zip, from the logo library at https://atlassian.design/foundations/logos", "none"],
  ["Linear", "Linear Orbit, Inc.", "logo-dark.svg (light pages) and logo-light.svg (dark pages), in https://static.linear.app/design-assets/Linear-Brand-Assets.zip?v=3, from https://linear.app/brand", "none"],
];

const lines = [
  "# Third-party notices",
  "",
  "Unattendish's built files (`dist/`) include code from these packages. Each keeps its own licence; the full licence texts ship with the packages on npm. Generated by `scripts/third-party-notices.mjs` from what each bundle includes.",
  "",
  "| Package | Version | Licence | Copyright | In |",
  "|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} | ${row.copyright.replace(/\|/g, "\\|")} | ${row.bundles} |`),
  "",  "## Icons",
  "",
  "These files under `icons/` are copied from icon sets, as single-colour drawings bb paints in the text colour.",
  "",
  "| File | Copied from | Version | Licence | Copyright |",
  "|---|---|---|---|---|",
  ...ICONS.map(([file, name, set]) => `| icons/${file} | ${set.source}: ${name} | ${set.version} | ${set.licence} | ${set.copyright} |`),
  "",
  "## Brand logos",
  "",
  "GitLab's, Jira's and Linear's logos, drawn in `shared/look/brand-logos.tsx`, are trademarks of the companies below and their artwork, which this plugin's licence does not cover. They are shown only to refer to those services, in the owners' own colours and unmodified except in size. Unattendish is not made by, endorsed by or affiliated with any of them.",
  "",
  "| Logo | Trademark of | Published as, and from | Changed | Retrieved |",
  "|---|---|---|---|---|",
  ...LOGOS.map(([logo, owner, source, changed]) => `| ${logo} | ${owner} | ${source} | ${changed} | ${RETRIEVED} |`),
  "",
];
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));
console.log(`${rows.length} packages`);
