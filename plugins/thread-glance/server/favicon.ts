// Finding a project's own icon in its files: the first of the usual favicon
// and icon files, else the icon `<link>` in its index or root route file. The
// files are read through `ProjectFiles`, which reads only regular files whose
// resolved path lies inside the project's path; this module also refuses any
// path that is not plainly relative.
import { MAX_ICON_BYTES } from "../shared/project-icon";
import { detectIconMime, type IconMime } from "./icon-image";

/** Reads files of one project by path relative to the project's path. */
export interface ProjectFiles {
  /**
   * The file's bytes, or null when there is no such readable file: missing,
   * not a regular file, resolving outside the project's path, or over 1 MB.
   *
   * @throws when bb could not be asked (a machine that is offline), so the
   *   caller does not take the absence for a miss.
   */
  read(path: string): Promise<Buffer | null>;
}

export interface FoundIcon {
  /** The path the icon was read from, relative to the project. */
  path: string;
  mime: IconMime;
  data: Buffer;
}

/** Files read at once while looking for an icon. */
const READ_BATCH = 8;

const ICON_EXTENSIONS = [".svg", ".png", ".ico", ".jpg", ".jpeg", ".gif", ".avif", ".webp"];

/** The usual icon files, best first: the root, then public assets, then framework app folders. */
export const ICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "icon.svg",
  "icon.png",
  "icon.ico",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/icon.svg",
  "public/icon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
] as const;

/** The files that hold the page's icon `<link>`: an index page or a root route. */
export const LINK_SOURCES = [
  "index.html",
  "public/index.html",
  "src/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
] as const;

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTRIBUTE = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
const REL = ATTRIBUTE("rel");
const HREF = ATTRIBUTE("href");
const OBJECT_REL = /\brel\s*:\s*["']([^"']+)["']/i;
const OBJECT_HREF = /\bhref\s*:\s*["']([^"']+)["']/i;

const isIconRel = (rel: string) => rel.toLowerCase().split(/\s+/).includes("icon");

/** The first icon `href` in HTML or JSX `<link>` tags, or in route objects like `{ rel: "icon", href: "/x.svg" }`. */
export function extractIconHref(source: string): string | null {
  for (const tag of source.match(LINK_TAG) ?? []) {
    const rel = REL.exec(tag);
    const href = HREF.exec(tag);
    if (rel && href && isIconRel(rel[1] ?? rel[2] ?? "")) return href[1] ?? href[2] ?? null;
  }
  for (const object of source.split("}")) {
    const rel = OBJECT_REL.exec(object);
    const href = OBJECT_HREF.exec(object);
    if (rel && href && isIconRel(rel[1]!)) return href[1]!;
  }
  return null;
}

/**
 * A relative path inside the project for `path`, or null when it is empty,
 * absolute, names a drive, has a `.` or `..` or empty segment, or does not
 * end in an icon extension.
 */
export function plainIconPath(path: string): string | null {
  const value = path.trim().replaceAll("\\", "/");
  if (value === "" || value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.includes("\0")) return null;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return ICON_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)) ? value : null;
}

/** The project paths an icon `href` may name: under `public/` first, then from the root. Empty for a URL or an unusable path. */
export function pathsForHref(href: string): string[] {
  const withoutSuffix = href.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (withoutSuffix === "" || withoutSuffix.startsWith("//") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(withoutSuffix)) return [];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return [];
  }
  const clean = plainIconPath(decoded.replace(/^\/+/, "").replace(/^\.\//, ""));
  return clean === null ? [] : [...new Set([`public/${clean}`, clean])];
}

/**
 * The project's icon, or null when it has none. An unreadable source (bb could
 * not be asked) is skipped, and `unreadable` says one was, so a caller can tell
 * a project without an icon from one whose files could not be read.
 */
export async function findProjectIcon(files: ProjectFiles): Promise<{ icon: FoundIcon | null; unreadable: boolean }> {
  let unreadable = false;
  const tryRead = async (path: string): Promise<Buffer | null> => {
    try {
      const data = await files.read(path);
      return data !== null && data.length > 0 && data.length <= MAX_ICON_BYTES ? data : null;
    } catch {
      unreadable = true;
      return null;
    }
  };
  const tryIcon = async (path: string): Promise<FoundIcon | null> => {
    const data = await tryRead(path);
    const mime = data === null ? null : detectIconMime(data);
    return data !== null && mime !== null ? { path, mime, data } : null;
  };

  /** Reads the paths a few at a time and returns the first, in order, that holds an icon. */
  const firstIcon = async (paths: readonly string[]): Promise<FoundIcon | null> => {
    for (let start = 0; start < paths.length; start += READ_BATCH) {
      const found = await Promise.all(paths.slice(start, start + READ_BATCH).map(tryIcon));
      const icon = found.find((candidate) => candidate !== null);
      if (icon) return icon;
    }
    return null;
  };

  const direct = await firstIcon(ICON_CANDIDATES);
  if (direct !== null) return { icon: direct, unreadable };
  const sources = await Promise.all(LINK_SOURCES.map(tryRead));
  for (const source of sources) {
    const href = source === null ? null : extractIconHref(source.toString("utf8"));
    if (href === null) continue;
    const icon = await firstIcon(pathsForHref(href));
    if (icon !== null) return { icon, unreadable };
  }
  return { icon: null, unreadable };
}
