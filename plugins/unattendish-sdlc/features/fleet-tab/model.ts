// What the Fleet tab says, decided from its views alone.
import type { FleetCredentialView, InFlightRowView, LedgerChangeView, LedgerFilter, LedgerView, UnreadableRowView, WatchedItemView } from "@/src/fleet/application/views";
import { credentialKind } from "@/shared/credentials";
import { ageLabel, dateTimeLabel, expiryText, plural } from "@/shared/format";

/** `at the bar for 25m`: the stage a row is at and how long it has been there. */
export function stageText(row: Pick<InFlightRowView, "stage" | "since">, now: string): string {
  return `${row.stage} for ${ageLabel(row.since, now)}`;
}

/** `blocked on #170, #171`. */
export function blockedText(blockedOn: readonly string[]): string {
  return blockedOn.length === 0 ? "blocked" : `blocked on ${blockedOn.join(", ")}`;
}

/** A row the plugin cannot read, naming the section, the line and what is wrong with it. */
export function unreadableRowText(row: UnreadableRowView): string {
  return `unreadable in ${row.section}, line ${row.line}: ${row.reason}`;
}

/** Why an item is in the watched set. */
export function whyText(item: Pick<WatchedItemView, "why">): string {
  return item.why.join(" · ");
}

export function watchedHeading(count: number): string {
  return `Watched set (${plural(count, "item")})`;
}

/** A credential the fleet uses, as its parts: the account it belongs to, its kind, whether it can write, the expiry date where the service reports one, and whether it shares the agents' rate limit. */
export function credentialParts(credential: FleetCredentialView): string[] {
  return [
    credential.account.label,
    credentialKind(credential.kind),
    ...(credential.canWrite ? ["can write"] : []),
    expiryText(credential.expiresAt),
    ...(credential.sharesAgentRateLimit ? ["shares the agents' rate limit"] : []),
  ];
}

// ---- the ledger ----

export type LedgerShow = "all" | "woke" | "dropped" | "held" | "failed read" | "wakes";

/** The filters on offer, in order, with their labels. */
export const LEDGER_FILTERS: readonly { readonly id: LedgerShow; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "woke", label: "Woke" },
  { id: "dropped", label: "Dropped" },
  { id: "held", label: "Held" },
  { id: "failed read", label: "Failed reads" },
  { id: "wakes", label: "Wakes" },
];

/**
 * The ledger call for a filter. Woke, Held and Failed reads ask the server for that outcome; Dropped and
 * Wakes ask for everything and show their own part of the answer.
 */
export function ledgerFilter(what: LedgerShow, item: string): LedgerFilter {
  const trimmed = item.trim();
  return {
    ...(trimmed === "" ? {} : { item: trimmed }),
    ...(what === "woke" || what === "held" || what === "failed read" ? { done: what } : {}),
  };
}

/** True for a change the plugin dropped rather than sent: an echo, or out of scope. */
export function isDropped(change: Pick<LedgerChangeView, "done">): boolean {
  return change.done === "echo" || change.done === "out-of-scope";
}

export interface LedgerContent {
  readonly changes: readonly LedgerChangeView[];
  readonly dropped: LedgerView["dropped"];
  readonly wakes: LedgerView["wakes"];
}

/**
 * What the ledger shows for a filter, each change once. Under All the main list holds the changes that were not
 * dropped and the groups hold the dropped ones; the outcome filters show the list the server filtered; Dropped
 * shows the groups; Wakes shows the wakes. A wake carries no item, so no wake is shown while an item filter is set.
 */
export function ledgerContent(ledger: LedgerView, what: LedgerShow, item: string): LedgerContent {
  const none = { changes: [], dropped: [], wakes: [] } satisfies LedgerContent;
  const wakes = item.trim() === "" ? ledger.wakes : none.wakes;
  switch (what) {
    case "all":
      return { changes: ledger.changes.filter((change) => !isDropped(change)), dropped: ledger.dropped, wakes };
    case "dropped":
      return { ...none, dropped: ledger.dropped };
    case "wakes":
      return { ...none, wakes };
    default:
      return { ...none, changes: ledger.changes };
  }
}

/** True where the ledger holds nothing that the filter shows. */
export function ledgerIsEmpty(content: LedgerContent): boolean {
  return content.changes.length === 0 && content.dropped.length === 0 && content.wakes.length === 0;
}

/** A dropped group's heading: its reason and how many changes it holds. */
export function droppedHeading(group: { reason: string; count: number }): string {
  return `${group.reason} · ${group.count}`;
}

/** What was done with a change, with the rule or reason where there is one. */
export function doneText(change: Pick<LedgerChangeView, "done" | "rule">): string {
  return change.rule === null ? change.done : `${change.done} (${change.rule})`;
}

/** What a listing cut off at its page limit tells of itself in place of a ref, a kind and an actor: the window it listed and the last update it reached. */
export function listingText(listing: NonNullable<LedgerChangeView["listing"]>): string {
  return `listed ${dateTimeLabel(listing.from)} to ${dateTimeLabel(listing.to)}, reached ${dateTimeLabel(listing.reached)}`;
}

export function changeWhen(change: Pick<LedgerChangeView, "at">): string {
  return dateTimeLabel(change.at);
}

export function wakeText(wake: LedgerView["wakes"][number]): string {
  const dispatched = wake.dispatchedAt === null ? "not dispatched yet" : `dispatched ${dateTimeLabel(wake.dispatchedAt)}`;
  return `${wake.kind} · queued ${dateTimeLabel(wake.queuedAt)} · ${dispatched}`;
}
