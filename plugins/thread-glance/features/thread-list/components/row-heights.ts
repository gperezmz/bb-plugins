// Row heights and group gaps per density, rows taller on bb's compact viewport.
// Comfortable adds 4px to every thread row and fold row that Compact draws, on
// every viewport, and doubles the gap before a group header; headers and the
// Settled fold keep their height. Whole class names, so Tailwind finds them. model/heights.ts gives
// the same heights in px, which the list lays rows out by; a browser test
// holds the two together.
import type { Density } from "../model/heights";

const THREAD_ROW_HEIGHT: Record<Density, Record<"one" | "two", { wide: string; compact: string }>> = {
  compact: { one: { wide: "h-7", compact: "h-9" }, two: { wide: "h-11", compact: "h-12" } },
  comfortable: { one: { wide: "h-8", compact: "h-10" }, two: { wide: "h-12", compact: "h-13" } },
};

/** A thread row, one line or two (a note's or a branch line's); also the fold rows, on one line. */
export function threadRowHeight(density: Density, compact: boolean, twoLines: boolean): string {
  return THREAD_ROW_HEIGHT[density][twoLines ? "two" : "one"][compact ? "compact" : "wide"];
}

/**
 * Where the ↳ mark sits on a two-line row, beside the title: the two lines
 * are centred, so a row 4px taller moves them down 2px.
 */
export const NESTED_MARK_TWO_LINES: Record<Density, string> = {
  compact: "mt-[9px] self-start",
  comfortable: "mt-[11px] self-start",
};

/** The space above every group header but the first. */
export const GROUP_GAP: Record<Density, string> = {
  compact: "mt-1",
  comfortable: "mt-2",
};
