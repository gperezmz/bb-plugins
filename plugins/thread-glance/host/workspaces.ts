// Which workspace a listener belongs to. Pure.

/** A workspace path as a request gave it, and the paths a process's working directory may be compared with. */
export interface WorkspaceMatcher {
  /** The path exactly as the request gave it. */
  given: string;
  /** Normalised `given` and its real path when that differs. */
  paths: string[];
}

function normalise(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/**
 * Matchers for workspace paths, each given with its real path (`resolve` maps
 * a path to its `realpath`, or null when it cannot). A relative path or the
 * root matches nothing.
 */
export function workspaceMatchers(
  workspaces: readonly string[],
  resolve: (path: string) => string | null,
): WorkspaceMatcher[] {
  const matchers: WorkspaceMatcher[] = [];
  for (const given of workspaces) {
    const plain = normalise(given);
    if (plain === null) continue;
    const paths = [plain];
    const real = resolve(given);
    const realPath = real === null ? null : normalise(real);
    if (realPath !== null && realPath !== plain) paths.push(realPath);
    matchers.push({ given, paths });
  }
  return matchers;
}

/**
 * The workspace `cwd` is inside: the one with the longest matching path on a
 * path boundary, returned as the request gave it. Among equally long paths the
 * first given wins.
 */
export function matchWorkspace(cwd: string, matchers: readonly WorkspaceMatcher[]): string | null {
  let best: { given: string; length: number } | null = null;
  for (const { given, paths } of matchers) {
    for (const path of paths) {
      if ((cwd === path || cwd.startsWith(`${path}/`)) && (best === null || path.length > best.length)) {
        best = { given, length: path.length };
      }
    }
  }
  return best === null ? null : best.given;
}
