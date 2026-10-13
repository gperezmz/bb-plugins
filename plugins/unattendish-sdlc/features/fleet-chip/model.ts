// What the Fleet chip says, decided from the cards of the fleets its thread holds alone.
import type { FleetCardView } from "@/src/fleet/application/views";
import { flagsOf, worstFlag } from "@/shared/fleet-flags";

export interface ChipFace {
  /** The rows that wait on the operator across the thread's fleets, drawn in amber after the icon; null when none does. */
  readonly count: number | null;
  /** The dot on the icon: red for a problem in any fleet, amber for a warning alone; null with neither. */
  readonly dot: "problem" | "warning" | null;
  /** The chip's accessible name. */
  readonly label: string;
}

/**
 * The chip: the fleet icon, the count of rows that wait on the operator summed over the thread's fleets, and a dot for
 * the worst flag among them. A thread with one fleet says it of that fleet.
 */
export function chipFace(cards: readonly Pick<FleetCardView, "waiting" | "problems" | "warnings">[], now: string): ChipFace {
  const waiting = cards.reduce((total, card) => total + card.waiting, 0);
  const count = waiting > 0 ? waiting : null;
  const dot = worstFlag(cards.flatMap((card) => flagsOf(card, now)));
  const waits = count === null ? "nothing waits on you" : `${count} waiting on you`;
  if (cards.length <= 1) {
    const flag = dot === "problem" ? ", and it has a problem" : dot === "warning" ? ", and it has a warning" : "";
    return { count, dot, label: `Fleet: ${waits}${flag}` };
  }
  const flag = dot === "problem" ? ", and a fleet has a problem" : dot === "warning" ? ", and a fleet has a warning" : "";
  return { count, dot, label: `${cards.length} fleets: ${waits}${flag}` };
}
