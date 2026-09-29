// Row heights and group gaps per density. Comfortable adds 4px to every
// thread row and fold row that Compact draws, on every viewport, and doubles
// the gap before a group header; headers and the Settled fold keep their
// height. Whole class names, so Tailwind finds them.
import type { ClientPreferences } from "@/shared/preferences";

export type Density = ClientPreferences["density"];

/** A thread row, one line or two (a note's or a branch line's). */
export const THREAD_ROW_HEIGHT: Record<Density, { one: string; two: string }> = {
  compact: { one: "h-7 max-md:pointer-coarse:h-9", two: "h-11 max-md:pointer-coarse:h-12" },
  comfortable: { one: "h-8 max-md:pointer-coarse:h-10", two: "h-12 max-md:pointer-coarse:h-13" },
};

/**
 * Where the ↳ mark sits on a two-line row, beside the title: the two lines
 * are centred, so a row 4px taller moves them down 2px.
 */
export const NESTED_MARK_TWO_LINES: Record<Density, string> = {
  compact: "mt-[9px] self-start",
  comfortable: "mt-[11px] self-start",
};

/** The "N more child threads" fold row. */
export const OLDER_ROW_HEIGHT: Record<Density, string> = {
  compact: "h-7 max-md:pointer-coarse:h-9",
  comfortable: "h-8 max-md:pointer-coarse:h-10",
};

/** The environment fold row, the same height on phones as on desktop. */
export const ENVIRONMENT_ROW_HEIGHT: Record<Density, string> = {
  compact: "h-7",
  comfortable: "h-8",
};

/** The space above every group header but the first. */
export const GROUP_GAP: Record<Density, string> = {
  compact: "mt-1",
  comfortable: "mt-2",
};

/** A one-line row's height in px on desktop, for a chunk never measured. */
export const ESTIMATED_ROW_HEIGHT: Record<Density, number> = { compact: 28, comfortable: 32 };
