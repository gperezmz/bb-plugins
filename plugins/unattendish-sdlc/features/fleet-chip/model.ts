// What the Fleet chip says, decided from the card alone.
import type { FleetCardView } from "@/src/fleet/application/views";
import { flagsOf, worstFlag } from "@/shared/fleet-flags";

export interface ChipFace {
  /** The rows that wait on the operator, drawn in amber after the icon; null when none does. */
  readonly count: number | null;
  /** The dot on the icon: red for a problem, amber for a warning alone; null with neither. */
  readonly dot: "problem" | "warning" | null;
  /** The chip's accessible name. */
  readonly label: string;
}

/** The chip: the fleet icon, the count of rows that wait on the operator, and a dot for the fleet's worst flag. */
export function chipFace(card: Pick<FleetCardView, "waiting" | "problems" | "warnings">, now: string): ChipFace {
  const count = card.waiting > 0 ? card.waiting : null;
  const dot = worstFlag(flagsOf(card, now));
  const waits = count === null ? "nothing waits on you" : `${count} waiting on you`;
  const flag = dot === "problem" ? ", and it has a problem" : dot === "warning" ? ", and it has a warning" : "";
  return { count, dot, label: `Fleet: ${waits}${flag}` };
}
