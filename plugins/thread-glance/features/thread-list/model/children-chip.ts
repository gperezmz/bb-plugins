// What a parent's Children chip and its child lists say: the tooltip, the
// marks, and the disclosure's name at each depth. Pure.
import type { SubtreeCounts, Urgency } from "./forest";

/** Children marks a chip shows at most. */
export const MAX_CHIP_MARKS = 3;

/** "N child threads, 1 failed, 2 need you, 1 done, 3 working": only the counts above zero follow. */
export function chipTooltip(childCount: number, counts: SubtreeCounts): string {
  const parts: string[] = [];
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.needsYou > 0) parts.push(`${counts.needsYou} need you`);
  if (counts.done > 0) parts.push(`${counts.done} done`);
  if (counts.working > 0) parts.push(`${counts.working} working`);
  const head = `${childCount} child thread${childCount === 1 ? "" : "s"}`;
  return parts.length === 0 ? head : `${head}, ${parts.join(", ")}`;
}

/** The ids of the marks a chip draws: the first children, up to three. */
export function chipMarkIds(childIds: readonly string[]): readonly string[] {
  return childIds.slice(0, MAX_CHIP_MARKS);
}

/** The hue (0 to 359) of a thread's colour circle: the same thread keeps its colour everywhere. */
export function markHue(threadId: string): number {
  let hash = 0;
  for (let index = 0; index < threadId.length; index += 1) hash = (hash * 31 + threadId.charCodeAt(index)) % 360;
  return hash;
}

/** The icon and tone the chip's most urgent glyph draws. */
export const URGENCY_GLYPHS: Readonly<Record<Urgency, { icon: string | null; tone: "failed" | "needs-you" | "unread" | "working"; label: string }>> = {
  failed: { icon: "CircleX", tone: "failed", label: "failed" },
  "needs-you": { icon: "CircleQuestion", tone: "needs-you", label: "needs you" },
  done: { icon: null, tone: "unread", label: "done" },
  working: { icon: "Loading", tone: "working", label: "working" },
};

/** The name of the disclosure that opens a child's own children, by the child's depth under the card (0 is a direct child). */
export function disclosureName(depth: number): string {
  if (depth <= 0) return "Grandchildren";
  if (depth === 1) return "Great-grandchildren";
  return "Descendants";
}
