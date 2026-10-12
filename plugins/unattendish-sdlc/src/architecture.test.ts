// The dependency rule of the Fleet context, checked on the import graph:
// imports point inward (adapters, then application, then domain), the
// composition root and other adapters are the only importers of an adapter,
// and the domain and application name no package and nothing that reaches
// outside the process.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const importsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g)) found.add(match[1]!);
  for (const match of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.add(match[1]!);
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.add(match[1]!);
  return [...found];
};

type Region = "domain" | "application" | "adapters" | "testing" | "root";
const regionOf = (file: string): Region => {
  const rel = relative(src, file).split(sep);
  if (rel[0] === "fleet" && (rel[1] === "domain" || rel[1] === "application" || rel[1] === "adapters" || rel[1] === "testing")) return rel[1];
  return "root";
};
const isTest = (file: string) => /\.test\.ts$/.test(file);

const sources = filesUnder(src).filter((f) => f.endsWith(".ts") && !isTest(f));
const tests = filesUnder(src).filter(isTest);

const target = (file: string, specifier: string): string | null => (specifier.startsWith(".") ? resolve(dirname(file), specifier) : null);
const regionOfTarget = (file: string, specifier: string): Region | "outside" | null => {
  const path = target(file, specifier);
  if (path === null) return null;
  return path.startsWith(`${src}${sep}`) || path === src ? regionOf(path) : "outside";
};

describe("the Fleet context's dependency rule", () => {
  it("finds the sources it checks", () => {
    expect(sources.some((f) => regionOf(f) === "domain")).toBe(true);
  });

  it("keeps the domain importing only the domain, and no package", () => {
    for (const file of sources.filter((f) => regionOf(f) === "domain")) {
      for (const specifier of importsOf(file)) {
        expect({ file: relative(root, file), specifier, region: regionOfTarget(file, specifier) }).toMatchObject({ region: "domain" });
      }
    }
  });

  it("keeps the application importing only the domain and the application, and no package", () => {
    for (const file of sources.filter((f) => regionOf(f) === "application")) {
      for (const specifier of importsOf(file)) {
        const region = regionOfTarget(file, specifier);
        expect({ file: relative(root, file), specifier, ok: region === "domain" || region === "application" }).toMatchObject({ ok: true });
      }
    }
  });

  it("lets only the composition root, the entry and other adapters import an adapter", () => {
    for (const file of sources.filter((f) => regionOf(f) !== "adapters")) {
      const mayImportAdapters = regionOf(file) === "root";
      for (const specifier of importsOf(file)) {
        if (regionOfTarget(file, specifier) === "adapters") expect({ file: relative(root, file), mayImportAdapters }).toMatchObject({ mayImportAdapters: true });
      }
    }
  });

  it("keeps the fakes and the tests of the domain and the application off the adapters", () => {
    const unit = [...tests, ...sources].filter((f) => ["domain", "application"].includes(regionOf(f)) || (regionOf(f) === "testing" && !relative(src, f).includes("adapter")));
    for (const file of unit) {
      for (const specifier of importsOf(file)) {
        expect({ file: relative(root, file), specifier, region: regionOfTarget(file, specifier) }).not.toMatchObject({ region: "adapters" });
      }
    }
  });

  it("keeps the pages' contract, views.ts, to types: it imports the domain's types and nothing that runs", () => {
    const file = join(src, "fleet", "application", "views.ts");
    const text = readFileSync(file, "utf8");
    const imports = [...text.matchAll(/(?:^|\n)\s*import\b([^;]*?)from\s*["']([^"']+)["']/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const match of imports) {
      expect({ specifier: match[2], typeOnly: /^\s*type\b/.test(match[1]!) }).toMatchObject({ typeOnly: true });
      expect(regionOfTarget(file, match[2]!)).toBe("domain");
    }
  });
});
