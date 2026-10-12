// The dependency rule of the plugin's user interface, checked on the import graph:
//   a feature is reached only through its index.ts;
//   shared/ names no feature;
//   the dashboard's views module is imported for its values only by the client, which
//   is the one module that fetches (its types are the plugin's own and go anywhere);
//   a React context is created only by the app root.
// Each rule is also run against a violating snippet, so a rule that stopped seeing
// imports would fail here rather than pass over nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const UI_FOLDERS = ["features", "shared", "components", "lib", "testing"];
const VIEWS = "src/fleet/application/views";
const CLIENT = "shared/client.ts";

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const isSource = (file: string) => /\.(ts|tsx)$/.test(file);

/** Every file the interface is made of, root-relative with forward slashes. */
const uiFiles = (): string[] =>
  [join(root, "app.tsx"), ...UI_FOLDERS.flatMap((folder) => filesUnder(join(root, folder)))]
    .filter(isSource)
    .map((file) => relative(root, file).split(sep).join("/"));

interface Import {
  readonly specifier: string;
  /** True for `import type …` and for an import whose every name is marked `type`. */
  readonly typeOnly: boolean;
}

/** The imports and re-exports of a source text. */
export function importsOf(text: string): Import[] {
  const found: Import[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(import|export)\b([^"'`;]*?)\bfrom\s*["']([^"']+)["']/g)) {
    const clause = match[2]!.trim();
    const inlineTypes = /^\{[^}]*\}$/.test(clause) && clause.slice(1, -1).split(",").map((n) => n.trim()).filter(Boolean).every((n) => n.startsWith("type "));
    found.push({ specifier: match[3]!, typeOnly: /^type\b/.test(clause) || inlineTypes });
  }
  for (const match of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push({ specifier: match[1]!, typeOnly: false });
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1]!, typeOnly: false });
  return found;
}

/** The root-relative path a specifier names, without extension, or null for a package. */
export function resolveSpecifier(from: string, specifier: string): string | null {
  const joined = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (joined === null) return null;
  return joined.split(sep).join("/").replace(/\.(tsx?|js)$/, "");
}

const featureOf = (path: string): string | null => /^features\/([^/]+)(?:\/|$)/.exec(path)?.[1] ?? null;

/** Imports from `file` that reach into another feature past its index. */
export function featureBoundaryBreaks(file: string, text: string): string[] {
  const own = featureOf(file);
  return importsOf(text)
    .map((i) => resolveSpecifier(file, i.specifier))
    .filter((path): path is string => path !== null)
    .filter((path) => {
      const other = featureOf(path);
      if (other === null || other === own) return false;
      return path !== `features/${other}` && path !== `features/${other}/index`;
    });
}

/** Imports from a file under shared/ that name a feature. */
export function sharedNamingFeature(file: string, text: string): string[] {
  if (!file.startsWith("shared/")) return [];
  return importsOf(text)
    .map((i) => resolveSpecifier(file, i.specifier))
    .filter((path): path is string => path !== null && featureOf(path) !== null);
}

/** Value imports of the views module from any file but the client. */
export function viewsValueImports(file: string, text: string): string[] {
  if (file === CLIENT) return [];
  return importsOf(text)
    .filter((i) => !i.typeOnly && resolveSpecifier(file, i.specifier) === VIEWS)
    .map((i) => i.specifier);
}

/** True where a file other than the app root creates a React context. */
export function createsContext(file: string, text: string): boolean {
  return file !== "app.tsx" && /\bcreateContext\b/.test(text);
}

const read = (file: string) => readFileSync(join(root, file), "utf8");
const files = uiFiles();

describe("the interface's dependency rule", () => {
  it("finds the files it checks", () => {
    expect(files).toContain("app.tsx");
    expect(files.some((f) => f.startsWith("features/fleets-page/"))).toBe(true);
    expect(files.some((f) => f.startsWith("shared/"))).toBe(true);
  });

  it("reaches a feature only through its index.ts", () => {
    for (const file of files) expect({ file, breaks: featureBoundaryBreaks(file, read(file)) }).toEqual({ file, breaks: [] });
  });

  it("keeps shared/ from naming a feature", () => {
    for (const file of files) expect({ file, naming: sharedNamingFeature(file, read(file)) }).toEqual({ file, naming: [] });
  });

  it("imports the views module for values only in the client", () => {
    for (const file of files) expect({ file, values: viewsValueImports(file, read(file)) }).toEqual({ file, values: [] });
  });

  it("creates a React context only in the app root", () => {
    for (const file of files) expect({ file, creates: createsContext(file, read(file)) }).toEqual({ file, creates: false });
  });
});

describe("each rule sees the violation it exists for", () => {
  it("sees a path past another feature's index", () => {
    const text = 'import { Row } from "@/features/fleets-page/Row";\nimport { x } from "../fleet-tab/model";';
    expect(featureBoundaryBreaks("features/fleet-chip/Chip.tsx", text)).toEqual(["features/fleets-page/Row", "features/fleet-tab/model"]);
  });

  it("lets a feature use another's index and its own files", () => {
    const text = 'import { FleetsPage } from "@/features/fleets-page";\nimport { a } from "./model";\nimport { b } from "@/features/fleet-chip/model";';
    expect(featureBoundaryBreaks("features/fleet-chip/Chip.tsx", text)).toEqual([]);
  });

  it("sees shared/ naming a feature, by alias or by relative path", () => {
    expect(sharedNamingFeature("shared/x.ts", 'import { A } from "@/features/fleet-tab";')).toEqual(["features/fleet-tab"]);
    expect(sharedNamingFeature("shared/inbox/x.ts", 'import { A } from "../../features/fleet-tab";')).toEqual(["features/fleet-tab"]);
    expect(sharedNamingFeature("features/a/x.ts", 'import { A } from "@/features/fleet-tab";')).toEqual([]);
  });

  it("sees a value import of the views module, and lets types and the client through", () => {
    expect(viewsValueImports("shared/x.ts", 'import { BOARD_CHANGED } from "@/src/fleet/application/views";')).toHaveLength(1);
    expect(viewsValueImports("shared/x.ts", 'export { INBOX_NEW } from "@/src/fleet/application/views";')).toHaveLength(1);
    expect(viewsValueImports("shared/x.ts", 'import type { FleetsView } from "@/src/fleet/application/views";')).toEqual([]);
    expect(viewsValueImports("shared/x.ts", 'import { type FleetsView, type LedgerView } from "@/src/fleet/application/views";')).toEqual([]);
    expect(viewsValueImports("shared/x.ts", 'import { type FleetsView, BOARD_CHANGED } from "@/src/fleet/application/views";')).toHaveLength(1);
    expect(viewsValueImports("shared/client.ts", 'export { BOARD_CHANGED } from "@/src/fleet/application/views";')).toEqual([]);
  });

  it("sees a context created outside the app root", () => {
    expect(createsContext("shared/x.tsx", 'import { createContext } from "react";')).toBe(true);
    expect(createsContext("app.tsx", 'import { createContext } from "react";')).toBe(false);
  });
});
