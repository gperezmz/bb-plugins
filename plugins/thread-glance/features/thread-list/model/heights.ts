// Every item's height in px, from what it is, the Density and the viewport,
// never measured. The same numbers as the height classes in
// components/row-heights.ts, which a browser test holds them to. Pure.
import type { ClientPreferences } from "@/shared/preferences";
import type { Row } from "./view";

export type Density = ClientPreferences["density"];

/**
 * The viewport a height is for: a phone is a coarse pointer below Tailwind's
 * `md` width, where the height classes' `max-md:pointer-coarse:` variants apply.
 */
export const PHONE_QUERY = "(width < 48rem) and (pointer: coarse)";

export interface HeightContext {
  density: Density;
  phone: boolean;
}

/** The space above every group header but the first. */
export const GROUP_GAP_PX: Record<Density, number> = { compact: 4, comfortable: 8 };

/** A group header, and the list header. */
export function headerHeight({ phone }: HeightContext): number {
  return phone ? 36 : 28;
}

/** A thread row on one line or two. */
function threadRowHeight({ density, phone }: HeightContext, twoLines: boolean): number {
  const taller = density === "comfortable" ? 4 : 0;
  if (twoLines) return (phone ? 48 : 44) + taller;
  return (phone ? 36 : 28) + taller;
}

/** "No threads", under an empty group's header. */
export const EMPTY_GROUP_HEIGHT = 24;

/** A thread row draws a second line for a note or its branch. */
export function hasTwoLines(row: { note: unknown; branchLine: string | null }): boolean {
  return row.note !== null || row.branchLine !== null;
}

/** Any row a group draws. */
export function rowHeight(row: Row, context: HeightContext): number {
  switch (row.type) {
    case "thread":
      return threadRowHeight(context, hasTwoLines(row));
    case "older":
      return threadRowHeight(context, false);
    case "environment":
      // The same on phones as on desktop.
      return context.density === "comfortable" ? 32 : 28;
    case "settled":
      return context.phone ? 36 : 24;
  }
}
