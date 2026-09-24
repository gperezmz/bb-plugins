// How far a row sits from the list's left edge. Pure, so a test can
// call it without rendering.
import type { Nesting } from "@/shared/preferences";

/** Left padding of a root row, as in bb's list. */
export const ROOT_INDENT = 8;
/** Tree nesting keeps bb's step per level. */
export const TREE_STEP = 24;
/**
 * Folded nesting shows one flat level. A child's status slot starts this far
 * right of its parent's, so the child's title sits this far right of the
 * parent's title.
 */
export const FOLDED_STEP = 12;

export function rowIndent(depth: number, nesting: Nesting): number {
  return ROOT_INDENT + depth * (nesting === "tree" ? TREE_STEP : FOLDED_STEP);
}

/** How far the rail sits from a row's left edge: the centre of the status slot at that level. */
export function railLeft(level: number, nesting: Nesting): number {
  return rowIndent(level, nesting) + 8;
}

/**
 * One level of guide rail on one row. `start` begins under the row's
 * status slot, `full` runs the row's height, `end` stops at its middle.
 */
export type Rail = "start" | "full" | "end";

/**
 * The rails every row draws, from the depths of the rows in order. Level `k`
 * runs from the row at depth `k` through the rows below it, and stops at the
 * last of them, so a family's rail ends on its last row, the fold row
 * included. Entry `k` of a row's result is its rail at level `k`, or null.
 */
export function railsFor(depths: readonly number[]): (Rail | null)[][] {
  return depths.map((depth, index) => {
    const next = depths[index + 1];
    const rails: (Rail | null)[] = [];
    for (let level = 0; level <= depth; level += 1) {
      const continues = next !== undefined && next > level;
      if (level === depth) rails.push(continues ? "start" : null);
      else rails.push(continues ? "full" : "end");
    }
    return rails;
  });
}

/**
 * How a row's title reads. Children step back from roots: a size smaller and
 * muted, unless the thread is unread or open. Hover restores the colour in
 * the component.
 */
export function titleTreatment(
  depth: number,
  state: { unread: boolean; active: boolean },
): { small: boolean; muted: boolean } {
  const child = depth > 0;
  return { small: child, muted: child && !state.unread && !state.active };
}
