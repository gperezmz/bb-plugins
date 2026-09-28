// What the settings panel's controls show and write. Pure.
import type { ChildAttention, Preferences, SortField } from "@/shared/preferences";
import { effectiveDirection, effectiveSortField, naturalDirection } from "./sort";

/** "Needs attention counts every child" is on when children count as `everything`. */
export function countsEveryChild(childAttention: ChildAttention): boolean {
  return childAttention === "everything";
}

export function childAttentionFor(everyChild: boolean): ChildAttention {
  return everyChild ? "everything" : "blocked";
}

/** Choosing a field starts it in its own direction, as a saved `default` did. */
export function sortFieldPatch(field: Exclude<SortField, "none">): Partial<Preferences> {
  return { chronologicalSort: field, sortDirection: naturalDirection(field) };
}

export interface SortArrow {
  glyph: "↓" | "↑";
  /** The order the list is in now, in words. */
  label: string;
  /** What pressing the arrow saves. */
  patch: Partial<Preferences>;
}

/** The ↓/↑ button: ↓ descending (newest first, Z–A), ↑ ascending. */
export function sortArrow(prefs: Pick<Preferences, "chronologicalSort" | "sortDirection">): SortArrow {
  const field = effectiveSortField(prefs.chronologicalSort);
  const direction = effectiveDirection(field, prefs.sortDirection);
  const descending = direction === "descending";
  const label = field === "alpha" ? (descending ? "Z–A" : "A–Z") : descending ? "Newest first" : "Oldest first";
  return {
    glyph: descending ? "↓" : "↑",
    label,
    patch: { sortDirection: descending ? "ascending" : "descending" },
  };
}
