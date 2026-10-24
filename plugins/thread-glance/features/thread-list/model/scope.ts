// The project scope picker: the scope itself, its options, the marks for the
// projects left out, the filter field and the keyboard moves. Pure.
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** The projects the list is limited to; empty is All projects. */
export type Scope = readonly string[];

export const ALL_PROJECTS_SCOPE: Scope = [];

export interface ScopeOption {
  /** The project id, null for All projects. */
  id: string | null;
  name: string;
}

export const ALL_PROJECTS: ScopeOption = { id: null, name: "All projects" };

/** All projects, then every project (the personal one included) by name. */
export function scopeOptions(projects: readonly PluginSidebarProject[]): ScopeOption[] {
  const named = projects
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [ALL_PROJECTS, ...named];
}

/**
 * The scope in force: `scope` without the projects that are gone, the same
 * array when none is. `projects` are the ones bb has listed, so while it has
 * not listed them yet (`loaded` false) every project in `scope` still counts.
 */
export function resolveScope(scope: Scope, projects: readonly PluginSidebarProject[], loaded: boolean): Scope {
  if (!loaded || scope.length === 0) return scope;
  const kept = scope.filter((id) => projects.some((project) => project.id === id));
  return kept.length === scope.length ? scope : kept;
}

/** `scope` with `projectId` added or, when it is in it, removed; emptied, it is All projects. */
export function toggleProject(scope: Scope, projectId: string): Scope {
  return scope.includes(projectId) ? scope.filter((id) => id !== projectId) : [...scope, projectId];
}

/** Whether a thread of `projectId` is in `scope`. */
export function inScope(scope: Scope, projectId: string): boolean {
  return scope.length === 0 || scope.includes(projectId);
}

/** The options whose name contains `query`, ignoring case; All projects matches by its name too. */
export function filterScopeOptions(options: readonly ScopeOption[], query: string): ScopeOption[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? [...options] : options.filter((option) => option.name.toLowerCase().includes(needle));
}

/** Where a key moves the highlighted option among `count`: arrows wrap, Home and End go to the ends. */
export function moveHighlight(index: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End", count: number): number {
  if (count === 0) return -1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return index < 0 ? 0 : (index + 1) % count;
    case "ArrowUp":
      return index <= 0 ? count - 1 : index - 1;
  }
}

/** The name the picker's button shows: All projects, or the chosen projects by name. */
export function scopeLabel(scope: Scope, projects: readonly PluginSidebarProject[]): string {
  const names = scopeOptions(projects)
    .filter((option) => option.id !== null && scope.includes(option.id))
    .map((option) => option.name);
  return names.length === 0 ? ALL_PROJECTS.name : names.join(", ");
}

/**
 * The projects `scope` leaves out that have a thread waiting on the person (a
 * question or an approval), by id. Nothing is left out of All projects.
 */
export function projectsNeedingYou(scope: Scope, threads: readonly PluginSidebarThread[]): readonly string[] {
  if (scope.length === 0) return NONE;
  const ids = new Set<string>();
  for (const thread of threads) if (thread.hasPendingInteraction && !scope.includes(thread.projectId)) ids.add(thread.projectId);
  return ids.size === 0 ? NONE : [...ids].sort();
}

const NONE: readonly string[] = [];

/** What the picker's button is named for a screen reader: the scope, then the left-out projects that need the person. */
export function scopeButtonLabel(scope: Scope, projects: readonly PluginSidebarProject[], needingYou: readonly string[]): string {
  const base = `Project scope: ${scopeLabel(scope, projects)}`;
  if (needingYou.length === 0) return base;
  const names = needingYou.map((id) => projects.find((project) => project.id === id)?.name ?? id);
  return `${base}. Needs you in ${names.join(", ")}`;
}
