// The project scope picker: its options, the fallback when its project goes,
// the filter field and the keyboard moves. Pure.
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

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

/** The scope in force: the chosen project while it exists, else All projects. */
export function resolveScope(scopeId: string | null, projects: readonly PluginSidebarProject[]): string | null {
  return scopeId !== null && projects.some((project) => project.id === scopeId) ? scopeId : null;
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

/** The name the picker's button shows. */
export function scopeLabel(scopeId: string | null, projects: readonly PluginSidebarProject[]): string {
  return scopeId === null ? ALL_PROJECTS.name : (projects.find((project) => project.id === scopeId)?.name ?? ALL_PROJECTS.name);
}
