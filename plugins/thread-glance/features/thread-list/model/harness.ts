// What the Hover card says about a thread's harness: the model and reasoning
// level bb reports, while they load and when they cannot be had. Pure.

export type ModelState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; model: string | null; reasoningLevel: string | null };

/** The line the Hover card shows: the model's name then the capitalised level, as "GPT 6.1 Sol Medium". "Loading…", "Not set" or "Unavailable" stand in for what is missing; no level leaves the name alone. */
export function modelLine(state: ModelState): string {
  switch (state.status) {
    case "loading":
      return "Loading…";
    case "unavailable":
      return "Unavailable";
    case "ready": {
      if (state.model === null) return "Not set";
      const level = state.reasoningLevel;
      if (level === null || level === "" || level === "none") return state.model;
      return `${state.model} ${level.charAt(0).toUpperCase()}${level.slice(1)}`;
    }
  }
}

export interface CatalogModel {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts?: readonly { reasoningEffort: string; label?: string }[];
}

/** The model's display name from the provider's catalog, else its id. */
export function modelDisplayName(model: string, catalog: readonly CatalogModel[]): string {
  return catalog.find((entry) => entry.model === model || entry.id === model)?.displayName ?? model;
}

/** The label the catalog gives the model's reasoning level, else the level itself. */
export function reasoningLevelLabel(model: string, level: string | null, catalog: readonly CatalogModel[]): string | null {
  if (level === null) return null;
  const entry = catalog.find((candidate) => candidate.model === model || candidate.id === model);
  return entry?.supportedReasoningEfforts?.find((effort) => effort.reasoningEffort === level)?.label ?? level;
}
