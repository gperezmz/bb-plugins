// The list store's boundary: code outside store/ reaches it only through its
// selector hooks (./hooks) and its command API (./api), so nothing outside
// depends on how the store holds or derives its state.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STORE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(STORE, "../../..");
const ALLOWED = new Set(["hooks", "api"]);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sources(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  });
}

/** Every module specifier a file imports or re-exports, at its top or through `import()`. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) found.push(match[1]!);
  return found;
}

function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return join(ROOT, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return null;
}

/** What `file` imports from store/ beyond its hooks and command API, when `file` is outside store/. */
function crossings(file: string, source: string): string[] {
  if (file.startsWith(STORE + sep)) return [];
  return specifiers(source).flatMap((specifier) => {
    const target = resolveSpecifier(file, specifier);
    if (target === null || !(target === STORE || target.startsWith(STORE + sep))) return [];
    const module = relative(STORE, target).replace(/\.(ts|tsx)$/, "");
    return ALLOWED.has(module) ? [] : [`${relative(ROOT, file)} imports ${specifier}`];
  });
}

describe("the list store's boundary", () => {
  it("is crossed only through store/hooks and store/api", () => {
    const files = sources(ROOT);
    expect(files.some((file) => file.startsWith(STORE + sep))).toBe(true);
    expect(files.flatMap((file) => crossings(file, readFileSync(file, "utf8")))).toEqual([]);
  });

  it("catches an import of the store's internals, and only from outside it", () => {
    const outside = join(ROOT, "features/thread-list/components/Example.tsx");
    const importing = (specifier: string) => `import { x } from "${specifier}";`;
    expect(crossings(outside, importing("../store/list-store"))).toHaveLength(1);
    expect(crossings(outside, importing("@/features/thread-list/store/derive"))).toHaveLength(1);
    expect(crossings(outside, `const store = await import("../store/vanilla");`)).toHaveLength(1);
    expect(crossings(outside, importing("../store/hooks"))).toEqual([]);
    expect(crossings(outside, importing("../store/api"))).toEqual([]);
    expect(crossings(join(STORE, "Example.ts"), importing("./derive"))).toEqual([]);
  });
});
