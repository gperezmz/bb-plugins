// How far a row sits from the list's left edge. Pure, so a test can
// call it without rendering.
/**
 * Left padding of a root row: its Status column starts where the group
 * header's text does.
 */
export const ROOT_INDENT = 8;
/**
 * A child's Status column starts this far right of its parent's, so the
 * child's title sits this far right of the parent's title.
 */
export const FOLDED_STEP = 12;

export function rowIndent(depth: number): number {
  return ROOT_INDENT + depth * FOLDED_STEP;
}
