// Project colours as components read them: the colour of a project and the
// readable form of its name, both only while Project colors is on. Usable
// anywhere in the plugin's app: the caller gives the ids of all projects,
// since an automatic hue steps away from the ones the others took.
import { useMemo } from "react";
import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { projectColours, readableColour, type ProjectColour } from "../model/project-colour";
import { useAppearance, useServerSettings } from "../sync/hooks";
import { useThemeMode } from "./theme-mode";

/** The colours of the last ids and overrides asked about, shared by every row that asks. */
let last: { ids: readonly string[]; overrides: object; colours: ReadonlyMap<string, string> } | null = null;

function coloursFor(ids: readonly string[], overrides: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  if (last !== null && last.ids === ids && last.overrides === overrides) return last.colours;
  const colours = projectColours(ids, overrides);
  last = { ids, overrides, colours };
  return colours;
}

/**
 * The project's colour, or null while Project colors is off. `projectIds`
 * must keep its identity while the projects do (the list's `useProjectIds`).
 */
export type { ProjectColour };

export function useProjectColour(projectId: string, projectIds: readonly string[]): ProjectColour | null {
  const { projectColours: on } = useServerSettings();
  const { colours: overrides } = useAppearance();
  const theme = useThemeMode();
  const fill = on ? (coloursFor(projectIds, overrides).get(projectId) ?? null) : null;
  return useMemo(() => (fill === null ? null : { fill, text: readableColour(fill, theme) }), [fill, theme]);
}

/**
 * The ids of every project as bb lists them, for surfaces outside the list
 * (the thread header's buttons, the settings page); the same array while the
 * projects are the same.
 */
export function useBbProjectIds(): readonly string[] {
  const { projects } = useSidebarThreads();
  return useMemo(() => projects.map((project) => project.id), [projects]);
}
