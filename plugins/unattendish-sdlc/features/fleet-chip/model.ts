// What the Fleet chip says, decided from the card alone.
import type { FleetCardView } from "@/src/fleet/application/views";
import { countParts, countsText } from "@/shared/card-model";

const IDLE_TEXT = "Fleet idle";

/**
 * The longest counts text that fits on one line in the 256 px box bb gives a header control, at the chip's 11 px type:
 * the spec's own example, "1 waits on you · 3 in flight · 2 landed today", is 45 characters and fills it. Digits are
 * the same width, so the width follows the length.
 */
export const ONE_LINE_MAX_CHARS = 45;

export interface ChipFace {
  /** The text on the chip; null where it shows only a dot. */
  readonly text: string | null;
  /**
   * `text` as the lines it is drawn in: one where it fits the box, else two, the counts split between them. bb does not
   * clip what is painted past its box, but a neighbouring control sits right beside it, so the chip never grows wider.
   */
  readonly lines: readonly string[];
  readonly dot: boolean;
  /** The chip's accessible name. */
  readonly label: string;
}

/**
 * The full chip spells out the labelled counts and reads `Fleet idle` with none. On a compact
 * viewport it shows only the count waiting on the operator, or a dot with none.
 */
export function chipFace(card: Pick<FleetCardView, "waiting" | "inFlight" | "landed">, compact: boolean): ChipFace {
  const counts = countsText(card);
  const label = counts === IDLE_TEXT ? IDLE_TEXT : `Fleet: ${counts}`;
  if (!compact) return { text: counts, lines: linesOf(card, counts), dot: false, label };
  return card.waiting > 0 ? { text: String(card.waiting), lines: [String(card.waiting)], dot: false, label } : { text: null, lines: [], dot: true, label };
}

function linesOf(card: Pick<FleetCardView, "waiting" | "inFlight" | "landed">, counts: string): readonly string[] {
  if (counts.length <= ONE_LINE_MAX_CHARS) return [counts];
  const parts = countParts(card);
  const first = Math.ceil(parts.length / 2);
  return [parts.slice(0, first).join(" · "), parts.slice(first).join(" · ")];
}
