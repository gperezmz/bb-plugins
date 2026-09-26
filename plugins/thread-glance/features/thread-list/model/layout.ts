// How far a row sits from the list's left edge. Pure, so a test can
// call it without rendering.
/** Left padding of a root row, as in bb's list. */
export const ROOT_INDENT = 8;
/**
 * A child's status slot starts this far right of its parent's, so the
 * child's title sits this far right of the parent's title.
 */
export const FOLDED_STEP = 12;

export function rowIndent(depth: number): number {
  return ROOT_INDENT + depth * FOLDED_STEP;
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
