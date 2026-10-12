// What a fleet card and the Fleet chip say, decided from the card's view alone.
import type { CredentialWarningView, FleetCardView, ManagerView } from "@/src/fleet/application/views";
import { ageLabel, formatMoney, plural, polledLabel } from "./format";

/** The three counts, each as it is spelled, a count of zero left out. */
export function countParts(card: Pick<FleetCardView, "waiting" | "inFlight" | "landedToday">): string[] {
  return [
    card.waiting > 0 ? `${card.waiting} waits on you` : null,
    card.inFlight > 0 ? `${card.inFlight} in flight` : null,
    card.landedToday > 0 ? `${card.landedToday} landed today` : null,
  ].filter((part): part is string => part !== null);
}

/** The counts joined by dots; `Fleet idle` when there is none. */
export function countsText(card: Pick<FleetCardView, "waiting" | "inFlight" | "landedToday">): string {
  const parts = countParts(card);
  return parts.length === 0 ? "Fleet idle" : parts.join(" · ");
}

/** The manager's state as the card says it. */
export function managerText(manager: ManagerView, now: string): string {
  if (manager.state === "none") return "no manager";
  if (manager.state === "working") return "manager working";
  return manager.since === null ? "manager idle" : `manager idle ${ageLabel(manager.since, now)}`;
}

/** The cost with the period it covers, or null where the card has no cost to show. */
export function costText(card: Pick<FleetCardView, "cost">): string | null {
  return card.cost === null ? null : `${formatMoney(card.cost.amount, card.cost.currency)} ${card.cost.period}`;
}

export function pollText(card: Pick<FleetCardView, "lastPolledAt">, now: string): string {
  return polledLabel(card.lastPolledAt, now);
}

export interface WarningLine {
  readonly text: string;
  /** The credential it is about. */
  readonly prefix: string;
  /** `destructive` for a credential already expired, `warning` otherwise. */
  readonly tone: "warning" | "destructive";
}

export function warningLine(warning: CredentialWarningView): WarningLine {
  if (warning.kind === "shares-rate-limit") return { text: "shares the agents' rate limit", prefix: warning.prefix, tone: "warning" };
  if (warning.daysLeft < 0) return { text: `token expired ${plural(-warning.daysLeft, "day")} ago`, prefix: warning.prefix, tone: "destructive" };
  if (warning.daysLeft === 0) return { text: "token expires today", prefix: warning.prefix, tone: "warning" };
  return { text: `token expires in ${plural(warning.daysLeft, "day")}`, prefix: warning.prefix, tone: "warning" };
}
