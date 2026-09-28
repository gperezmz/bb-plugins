/**
 * A compaction line asked for as a size (`bb cache-keeper on --above`, the
 * agent tool's `above`): the setting it snaps to, or a refusal that changes
 * nothing. Lines come only from the window bb reports for the thread, so
 * until it reports one there is nothing to snap to.
 */
import { formatSize, snapSetting } from "./line";
import type { ThreadView } from "./view";

export class AboveRefused extends Error {
  constructor(
    message: string,
    readonly code: "window_unknown" | "no_line" | "above_highest_line",
  ) {
    super(message);
  }
}

/**
 * The setting whose line is nearest `size`; a size below the lowest line
 * takes the lowest. Refused while the window is unknown, when no setting has
 * a line, and above the highest line.
 */
export function aboveSetting(size: number, view: Pick<ThreadView, "windowKnown" | "window" | "lines" | "rates">): number {
  if (!view.windowKnown) {
    throw new AboveRefused("this thread's context window isn't known yet, so it has no compaction lines; bb reports it once the thread's first turn ends. Nothing was changed.", "window_unknown");
  }
  const known = view.lines.filter((l): l is number => l !== null);
  if (known.length === 0) {
    throw new AboveRefused(
      view.rates === null
        ? "this thread's model has no price, so it has no compaction line at any setting. Nothing was changed."
        : `compacting never repays itself on this thread at any setting up to its ${formatSize(view.window)} window, so it has no compaction line. Nothing was changed.`,
      "no_line",
    );
  }
  const highest = Math.max(...known);
  if (size > highest) {
    throw new AboveRefused(`${formatSize(size)} is above this thread's highest line, ${formatSize(highest)}, in its ${formatSize(view.window)} window. Nothing was changed.`, "above_highest_line");
  }
  return snapSetting(size, view.lines);
}
