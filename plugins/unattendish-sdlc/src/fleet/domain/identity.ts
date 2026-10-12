// Who and what a fleet is about: its repository, its tracker, the prefixes a
// credential is chosen for, and whether a URL lies under a source.
import type { RepoRef, Source, TrackerSpec } from "./model";

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** `host/owner/repo` (or `host/group/subgroup/project`) as the manifest's first line spells it; null for anything else. */
export const parseRepo = (text: string): RepoRef | null => {
  const parts = text.trim().replace(/\.git$/i, "").replace(/\/+$/, "").split("/");
  if (parts.length < 2) return null;
  const [host, ...path] = parts as [string, ...string[]];
  if (!HOST.test(host) || path.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === "..")) return null;
  return { host: host.toLowerCase(), path: path.join("/") };
};

export const formatRepo = (repo: RepoRef): string => `${repo.host}/${repo.path}`;

/** The key a registration is stored under: the repository, lower case. */
export const repoId = (repo: RepoRef): string => formatRepo(repo).toLowerCase();

/** The tracker as `--tracker` spells it: `forge-issues`, `linear:<team key>` or `jira:<site>/<project key>`. */
export const formatTracker = (tracker: TrackerSpec): string => {
  switch (tracker.kind) {
    case "forge-issues":
      return "forge-issues";
    case "linear":
      return `linear:${tracker.team}`;
    case "jira":
      return `jira:${tracker.site}/${tracker.project}`;
  }
};

/** `forge-issues`, `linear:<team key>` or `jira:<site>/<project key>`; null for anything else. */
export const parseTracker = (text: string): TrackerSpec | null => {
  const value = text.trim();
  if (value === "forge-issues") return { kind: "forge-issues" };
  const linear = /^linear:([^/]+)$/.exec(value);
  if (linear !== null) return KEY.test(linear[1]!) ? { kind: "linear", team: linear[1]!.toUpperCase() } : null;
  const jira = /^jira:([^/]+)\/([^/]+)$/.exec(value);
  if (jira !== null) return HOST.test(jira[1]!) && KEY.test(jira[2]!) ? { kind: "jira", site: jira[1]!.toLowerCase(), project: jira[2]!.toUpperCase() } : null;
  return null;
};

/** `github.com` and `gitlab.com` name their service; any other host's service is named by its credential. */
export const defaultServiceOfHost = (host: string): "github" | "gitlab" | null => {
  const lower = host.toLowerCase();
  return lower === "github.com" ? "github" : lower === "gitlab.com" ? "gitlab" : null;
};

export const forgeSource = (repo: RepoRef, service: "github" | "gitlab"): Source => ({ role: "forge", service, host: repo.host, path: repo.path });

/** The tracker as a source of its own; null while the tracker is the forge's issues. */
export const trackerSource = (tracker: TrackerSpec): Source | null => {
  switch (tracker.kind) {
    case "forge-issues":
      return null;
    case "linear":
      return { role: "tracker", service: "linear", team: tracker.team };
    case "jira":
      return { role: "tracker", service: "jira", site: tracker.site, project: tracker.project };
  }
};

// ---- credential prefixes ----

/**
 * What a credential is chosen for. A repository prefix is a whole host
 * followed by whole path segments (`github.com`, `github.com/org`,
 * `github.com/org/repo`); `linear:` covers every Linear team and
 * `linear:ENG` one; `jira:site` covers every project of a Jira site and
 * `jira:site/PROJ` one.
 */
export type Prefix =
  | { readonly kind: "repo"; readonly host: string; readonly path: readonly string[] }
  | { readonly kind: "linear"; readonly team: string | null }
  | { readonly kind: "jira"; readonly site: string; readonly project: string | null };

/** What a prefix is matched against: a fleet's repository, or its tracker. */
export type Subject =
  | { readonly kind: "repo"; readonly host: string; readonly path: readonly string[] }
  | { readonly kind: "linear"; readonly team: string }
  | { readonly kind: "jira"; readonly site: string; readonly project: string };

export const parsePrefix = (text: string): Prefix | null => {
  const value = text.trim();
  if (value === "linear:") return { kind: "linear", team: null };
  const linear = /^linear:([^/]+)$/.exec(value);
  if (linear !== null) return KEY.test(linear[1]!) ? { kind: "linear", team: linear[1]!.toUpperCase() } : null;
  if (value.startsWith("jira:")) {
    const [site, project, ...rest] = value.slice(5).split("/");
    if (site === undefined || !HOST.test(site) || rest.length > 0) return null;
    if (project === undefined || project === "") return project === undefined ? { kind: "jira", site: site.toLowerCase(), project: null } : null;
    return KEY.test(project) ? { kind: "jira", site: site.toLowerCase(), project: project.toUpperCase() } : null;
  }
  const [host, ...path] = value.replace(/\/+$/, "").split("/");
  if (host === undefined || !HOST.test(host) || path.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === "..")) return null;
  return { kind: "repo", host: host.toLowerCase(), path };
};

export const prefixText = (prefix: Prefix): string => {
  switch (prefix.kind) {
    case "repo":
      return [prefix.host, ...prefix.path].join("/");
    case "linear":
      return `linear:${prefix.team ?? ""}`;
    case "jira":
      return prefix.project === null ? `jira:${prefix.site}` : `jira:${prefix.site}/${prefix.project}`;
  }
};

export const repoSubject = (repo: RepoRef): Subject => ({ kind: "repo", host: repo.host.toLowerCase(), path: repo.path.split("/") });

/** What a fleet's tracker is matched as: the repository for `forge-issues`, else the Linear team or Jira project. */
export const trackerSubject = (tracker: TrackerSpec, repo: RepoRef): Subject => {
  switch (tracker.kind) {
    case "forge-issues":
      return repoSubject(repo);
    case "linear":
      return { kind: "linear", team: tracker.team };
    case "jira":
      return { kind: "jira", site: tracker.site, project: tracker.project };
  }
};

/** Whether a prefix covers a subject: the whole host and whole path segments, never a substring. */
export const prefixMatches = (prefix: Prefix, subject: Subject): boolean => {
  if (prefix.kind === "repo" && subject.kind === "repo") {
    return prefix.host === subject.host.toLowerCase() && prefix.path.length <= subject.path.length && prefix.path.every((segment, at) => segment.toLowerCase() === subject.path[at]!.toLowerCase());
  }
  if (prefix.kind === "linear" && subject.kind === "linear") return prefix.team === null || prefix.team === subject.team.toUpperCase();
  if (prefix.kind === "jira" && subject.kind === "jira") return prefix.site === subject.site.toLowerCase() && (prefix.project === null || prefix.project === subject.project.toUpperCase());
  return false;
};

const specificity = (prefix: Prefix): number => {
  switch (prefix.kind) {
    case "repo":
      return 1 + prefix.path.length;
    case "linear":
      return prefix.team === null ? 0 : 1;
    case "jira":
      return prefix.project === null ? 1 : 2;
  }
};

/** Of the entries whose prefix covers the subject, the one with the longest prefix; the first of equals. */
export const longestMatch = <T extends { readonly prefix: Prefix }>(entries: readonly T[], subject: Subject): T | null => {
  let best: T | null = null;
  for (const entry of entries) {
    if (!prefixMatches(entry.prefix, subject)) continue;
    if (best === null || specificity(entry.prefix) > specificity(best.prefix)) best = entry;
  }
  return best;
};

// ---- URLs ----

/** Whether a URL is an item of this source: on the source's own host and under its repository, team or project. */
export const urlUnder = (source: Source, url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  switch (source.service) {
    case "github":
    case "gitlab": {
      const base = `/${source.path.toLowerCase()}`;
      return host === source.host.toLowerCase() && (path === base || path.startsWith(`${base}/`));
    }
    case "linear":
      return host === "linear.app" && new RegExp(`/issue/${source.team.toLowerCase()}-\\d+(/|$)`).test(path);
    case "jira":
      return host === source.site.toLowerCase() && new RegExp(`/browse/${source.project.toLowerCase()}-\\d+(/|$)`).test(path);
  }
};
