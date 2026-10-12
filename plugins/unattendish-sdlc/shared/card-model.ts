// What a fleet card and the Fleet chip say, decided from the card's view alone.
import type { WarningView, FleetCardView, HalfView, ManagerView } from "@/src/fleet/application/views";
import { ageLabel, formatMoney, plural, polledLabel } from "./format";

/** The three counts, each as it is spelled, a count of zero left out. Landed covers the last 7 days. */
export function countParts(card: Pick<FleetCardView, "waiting" | "inFlight" | "landed">): string[] {
  return [
    card.waiting > 0 ? `${card.waiting} waits on you` : null,
    card.inFlight > 0 ? `${card.inFlight} in flight` : null,
    card.landed > 0 ? `${card.landed} landed in 7d` : null,
  ].filter((part): part is string => part !== null);
}

/** The counts joined by dots; `Fleet idle` when there is none. */
export function countsText(card: Pick<FleetCardView, "waiting" | "inFlight" | "landed">): string {
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
  /** The credential it is about, or `polling`. */
  readonly label: string;
  /** `destructive` for a credential already expired, `warning` otherwise. */
  readonly tone: "warning" | "destructive";
}

/** What days left on a token warn: expired, expiring today, or expiring in so many days. */
export function daysWarning(daysLeft: number): Pick<WarningLine, "text" | "tone"> {
  if (daysLeft < 0) return { text: `token expired ${plural(-daysLeft, "day")} ago`, tone: "destructive" };
  if (daysLeft === 0) return { text: "token expires today", tone: "warning" };
  return { text: `token expires in ${plural(daysLeft, "day")}`, tone: "warning" };
}

export function warningLine(warning: WarningView, now: string): WarningLine {
  switch (warning.kind) {
    case "shares-rate-limit":
      return { text: "shares the agents' rate limit", label: warning.label, tone: "warning" };
    case "expires":
      return { ...daysWarning(warning.daysLeft), label: warning.label };
    case "polling-late":
      return { text: `polling is late: ${polledLabel(warning.lastPolledAt, now)}`, label: "polling", tone: "warning" };
    case "never-polled":
      return { text: "not polled yet", label: "polling", tone: "warning" };
  }
}

/** A key telling a card's warnings apart. */
export function warningKey(warning: WarningView): string {
  return warning.kind === "polling-late" || warning.kind === "never-polled" ? warning.kind : `${warning.kind}:${warning.label}`;
}

/** What a half reads and as whom: `acme/web · reads as GitHub · yuser`, or `· no account yet` while no assignment covers it. */
export function halfLine(half: HalfView): string {
  return `${half.what} · ${half.account !== null ? `reads as ${half.account.label}` : "no account yet"}`;
}

/** The action a half offers: Connect… while it needs something, Change account… while it is read. */
export function halfAction(half: HalfView): "Connect…" | "Change account…" {
  return half.needs !== null ? "Connect…" : "Change account…";
}

/**
 * The reasons a card lists below its halves: a reason Connect… fixes for a half that already says what it needs is
 * left to that half's line, so the card says it, with its Connect…, once.
 */
export function cardReasons(card: Pick<FleetCardView, "reasons" | "halves">): FleetCardView["reasons"] {
  const saying = new Set(card.halves.filter((half) => half.needs !== null).map((half) => half.role));
  return card.reasons.filter((reason) => reason.fix.kind !== "connect" || !saying.has(reason.fix.role));
}
