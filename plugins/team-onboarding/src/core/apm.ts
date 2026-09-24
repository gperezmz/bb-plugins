// Reads an APM manifest (`apm.yml`) so a team keeps one skills list for
// `apm install` in shells and for bb. No `apm` binary is needed: each
// dependency resolves to a git source the skills sync already handles.
import { parse as parseYaml } from "yaml";

export interface GitSkillSource {
  /** The dependency as written, for display. */
  label: string;
  url: string;
  ref: string | null;
  /** Folder globs that may hold skills. */
  paths: string[];
}

export type ApmParseResult =
  | { ok: true; sources: GitSkillSource[] }
  | { ok: false; error: string };

/**
 * Parses one APM package reference: `owner/repo[/subpath][#ref]`, a
 * `host/owner/repo[/subpath][#ref]` form, or a git URL with `#ref`.
 */
export function parseApmReference(reference: string, defaultHost: string): GitSkillSource | null {
  const trimmed = reference.trim();
  const [spec, ref] = splitRef(trimmed);
  if (/^(https:\/\/|ssh:\/\/|git@)/.test(spec)) {
    return { label: trimmed, url: spec, ref, paths: packagePaths("") };
  }
  const segments = spec.split("/").filter(Boolean);
  let host = defaultHost;
  if (segments.length >= 3 && segments[0]!.includes(".")) host = segments.shift()!;
  if (segments.length < 2) return null;
  const [owner, repo, ...rest] = segments;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;
  return {
    label: trimmed,
    url: `https://${host}/${owner}/${repo!.replace(/\.git$/, "")}.git`,
    ref,
    paths: packagePaths(rest.join("/")),
  };
}

function splitRef(value: string): [string, string | null] {
  const index = value.lastIndexOf("#");
  if (index === -1) return [value, null];
  const ref = value.slice(index + 1);
  return [value.slice(0, index), ref === "" ? null : ref];
}

/**
 * A package path is either one skill (a folder with `SKILL.md`) or a package
 * whose skills sit under `skills/` or `.apm/skills/`. The sync keeps only
 * folders that hold a `SKILL.md`.
 */
function packagePaths(subpath: string): string[] {
  const base = subpath === "" ? "" : `${subpath.replace(/\/+$/, "")}/`;
  return [
    subpath === "" ? "." : subpath,
    `${base}skills/*`,
    `${base}.apm/skills/*`,
  ];
}

/** Reads `dependencies.apm` from an `apm.yml`. MCP and other kinds are ignored. */
export function parseApmManifest(text: string, defaultHost: string): ApmParseResult {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (cause) {
    return { ok: false, error: `apm.yml isn't valid YAML: ${(cause as Error).message.split("\n")[0]}` };
  }
  const deps = (data as { dependencies?: { apm?: unknown } } | null)?.dependencies?.apm;
  if (deps === undefined || deps === null) return { ok: true, sources: [] };
  if (!Array.isArray(deps)) return { ok: false, error: "apm.yml: dependencies.apm must be a list" };
  const sources: GitSkillSource[] = [];
  for (const [index, dep] of deps.entries()) {
    if (typeof dep === "string") {
      const source = parseApmReference(dep, defaultHost);
      if (source === null) return { ok: false, error: `apm.yml: dependencies.apm[${index}] isn't owner/repo[/path][#ref]` };
      sources.push(source);
      continue;
    }
    if (dep !== null && typeof dep === "object" && typeof (dep as { git?: unknown }).git === "string") {
      const object = dep as { git: string; path?: unknown; ref?: unknown };
      const path = typeof object.path === "string" ? object.path : "";
      sources.push({
        label: object.git,
        url: object.git,
        ref: typeof object.ref === "string" ? object.ref : null,
        paths: packagePaths(path),
      });
      continue;
    }
    return { ok: false, error: `apm.yml: dependencies.apm[${index}] has an unsupported form` };
  }
  return { ok: true, sources };
}
