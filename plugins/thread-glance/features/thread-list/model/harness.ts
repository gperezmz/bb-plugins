// What the Hover card says about a thread's harness: the model and reasoning
// level bb reports, while they load and when they cannot be had. Pure.

export type ModelState = { status: "loading" } | { status: "unavailable" } | { status: "ready"; model: string | null; reasoningLevel: string | null };

export interface ModelLines {
  model: string;
  reasoning: string;
}

/** The two lines the Hover card shows: "Loading…", "Not set" or "Unavailable" stand in for what is missing. */
export function modelLines(state: ModelState): ModelLines {
  switch (state.status) {
    case "loading":
      return { model: "Loading…", reasoning: "Loading…" };
    case "unavailable":
      return { model: "Unavailable", reasoning: "Unavailable" };
    case "ready":
      return {
        model: state.model ?? "Not set",
        reasoning: state.reasoningLevel === null || state.reasoningLevel === "none" ? "Not set" : state.reasoningLevel,
      };
  }
}

/** The model's display name from the provider's catalog, else its id. */
export function modelDisplayName(model: string, catalog: readonly { id: string; model: string; displayName: string }[]): string {
  return catalog.find((entry) => entry.model === model || entry.id === model)?.displayName ?? model;
}
