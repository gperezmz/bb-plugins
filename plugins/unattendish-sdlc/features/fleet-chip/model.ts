// What the Fleet chip says, decided from the card alone.
import type { FleetCardView } from "@/src/fleet/application/views";
import { countsText } from "@/shared/card-model";

export interface ChipFace {
  /** The text on the chip; null where it shows only a dot. */
  readonly text: string | null;
  readonly dot: boolean;
  /** The chip's accessible name. */
  readonly label: string;
}

/**
 * The full chip spells out the labelled counts and reads `Fleet idle` with none. On a compact
 * viewport it shows only the count waiting on the operator, or a dot with none.
 */
export function chipFace(card: Pick<FleetCardView, "waiting" | "inFlight" | "landedToday">, compact: boolean): ChipFace {
  const label = `Fleet: ${countsText(card)}`;
  if (!compact) return { text: countsText(card), dot: false, label };
  return card.waiting > 0 ? { text: String(card.waiting), dot: false, label } : { text: null, dot: true, label };
}
