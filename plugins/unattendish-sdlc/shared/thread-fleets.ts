// The fleets one manager thread holds, as the Fleet chip and the Fleet tab order them and choose the one to show,
// decided from their cards alone.
import type { FleetCardView, HeldFleetView } from "@/src/fleet/application/views";
import { byFlagsThenWaiting } from "./fleet-flags";

/** A left-behind fleet: its manifest names another repository, so it shows none of that manifest's rows. */
export function isLeftBehind(card: Pick<FleetCardView, "problems">): boolean {
  return card.problems.some((problem) => problem.code === "left-behind");
}

/**
 * The thread's fleets in order: those not left behind before those left behind; within each, a problem before a
 * warning before neither, then most waiting first, then by name.
 */
export function threadFleetOrder<Held extends Pick<HeldFleetView, "card">>(fleets: readonly Held[], now: string): Held[] {
  const within = byFlagsThenWaiting(now);
  return [...fleets].sort((a, b) => Number(isLeftBehind(a.card)) - Number(isLeftBehind(b.card)) || within(a.card, b.card));
}

/** The fleet to show: `wanted` where the thread holds it, else the first in `ordered`; null where the thread holds none. */
export function shownFleet<Held extends Pick<HeldFleetView, "card">>(ordered: readonly Held[], wanted: string | null): Held | null {
  return ordered.find((fleet) => fleet.card.repo === wanted) ?? ordered[0] ?? null;
}

/** `org/wake`, `org/wake and org/web`, `org/a, org/b and org/c`. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What follows a fleet's spend where its manager thread holds other fleets: `shared with org/wake`; null for a fleet alone on its thread. */
export function sharedText(card: Pick<FleetCardView, "cost">): string | null {
  return card.cost === null || card.cost.sharedWith.length === 0 ? null : `shared with ${nameList(card.cost.sharedWith)}`;
}
