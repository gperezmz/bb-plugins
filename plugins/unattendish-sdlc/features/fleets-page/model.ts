// What the Fleets page says, decided from its view alone: the fleet board's order and cells, the queue's tabs and rows,
// the page's states in between, and how it shows the row a toast opens.
import type { ActionRecordView, FleetCardView, FleetsView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { byFlagsThenWaiting, isQuiet } from "@/shared/fleet-flags";
import { ageLabel } from "@/shared/format";
import { sameRow, type RowAction } from "@/shared/inbox/row-model";
import { itemTitle } from "@/shared/item-title";

/** The header's count: the Inbox rows across fleets, and nothing at zero or before the view arrives. */
export function headerCount(view: Pick<FleetsView, "waiting"> | null): string | null {
  return view === null || view.waiting <= 0 ? null : String(view.waiting);
}

/** The header's count as a sentence for assistive technology. */
export function headerCountLabel(waiting: number): string {
  return `${waiting} waiting on you`;
}

/** How often the stale pill is redrawn, so its age keeps up with the clock. */
export const STALE_TICK_MS = 15_000;

/** The pill a failed refresh shows over the data still on screen: `3m old`, and its hover text. */
export function staleText(generatedAt: string, error: string, nowMs: number): { readonly pill: string; readonly hover: string } {
  const age = ageLabel(generatedAt, new Date(nowMs).toISOString());
  return { pill: `${age} old`, hover: `Couldn't refresh: ${error}. Showing what was loaded ${age} ago.` };
}

// ---- a fleet's name ----

/**
 * Each fleet's short name, by its full name `<host>/<path>`: the fewest segments from the end that no other fleet's
 * full name also ends with, segment by segment. A fleet whose whole path ends another's keeps its host.
 */
export function shortNames(fleets: readonly string[]): ReadonlyMap<string, string> {
  const split = fleets.map((fleet) => fleet.split("/"));
  const endsWith = (segments: readonly string[], tail: readonly string[]) => tail.length <= segments.length && tail.every((segment, n) => segments[segments.length - tail.length + n] === segment);
  return new Map(
    split.map((segments, index) => {
      for (let take = 1; take < segments.length; take++) {
        const tail = segments.slice(-take);
        if (!split.some((other, at) => at !== index && endsWith(other, tail))) return [fleets[index]!, tail.join("/")];
      }
      return [fleets[index]!, fleets[index]!];
    }),
  );
}

// ---- the page's layout ----

/** The Fleets page's two layouts: `wide` is the board and one line per queue row, `narrow` the condensed board and stacked rows. */
export type PageLayout = "wide" | "narrow";

/**
 * The switch point, in rem: the narrowest page, padding included, at which the widest row the wide layout can hold
 * keeps each of its parts whole. That row names its fleet, links with no short form cut at 16rem, offers Grant… and
 * Re-grant with a refused Re-grant's "not sent" beside a 12rem title, has waited 99d 23h, and has an unconfirmed send.
 * Measured in bb at 1440 px, where that row's narrowest is 60.46rem and the page's padding 3rem, and rounded up to the
 * next rem, since the buttons' and "not sent"'s widths are their text's.
 */
export const SWITCH_POINT_REM = 64;

/** The layout for a page `widthPx` wide, where a rem is `remPx`: wide from the switch point up, narrow below it. */
export function pageLayout(widthPx: number, remPx: number): PageLayout {
  return widthPx >= SWITCH_POINT_REM * remPx ? "wide" : "narrow";
}

// ---- the fleet board ----

/**
 * The board's order: fleets with a problem, then those with a warning, then the rest, most waiting first, ties in name
 * order; problems and warnings among themselves the same way.
 */
export function boardOrder(cards: readonly FleetCardView[], now: string): FleetCardView[] {
  return [...cards].sort(byFlagsThenWaiting(now));
}

/** The board's lines in order: those it lists, and the quiet fleets folded under one line; a selected fleet is always listed. */
export function boardLines(cards: readonly FleetCardView[], now: string, selected: string | null): { readonly listed: FleetCardView[]; readonly quiet: FleetCardView[] } {
  const ordered = boardOrder(cards, now);
  const folds = (card: FleetCardView) => card.repo !== selected && isQuiet(card, now);
  return { listed: ordered.filter((card) => !folds(card)), quiet: ordered.filter(folds) };
}

/** `1 quiet fleet`, `3 quiet fleets`. */
export function quietLabel(count: number): string {
  return `${count} quiet ${count === 1 ? "fleet" : "fleets"}`;
}

/** How many fleets the narrow layout's condensed board shows before folding the rest. */
export const NARROW_FLEETS_SHOWN = 3;

/** The condensed board: the first fleets in board order, and how many fold under "N more fleets"; every fleet once `expanded`. */
export function narrowBoard(cards: readonly FleetCardView[], now: string, expanded = false): { readonly shown: FleetCardView[]; readonly more: number } {
  const ordered = boardOrder(cards, now);
  if (expanded) return { shown: ordered, more: 0 };
  return { shown: ordered.slice(0, NARROW_FLEETS_SHOWN), more: Math.max(0, ordered.length - NARROW_FLEETS_SHOWN) };
}

/** `2 more fleets`, `1 more fleet`. */
export function moreLabel(count: number): string {
  return `${count} more ${count === 1 ? "fleet" : "fleets"}`;
}

/** The Status header's hover text: the four counts. */
export const STATUS_HEADER_TEXT = "Blocked · In flight · Waits on you · Landed in the last 7 days";

/** The polling cell: empty while polling is healthy; `not yet` before the first poll; `9m late` once a poll is late. */
export function pollingCell(card: Pick<FleetCardView, "warnings">, now: string): { readonly kind: "never" | "late"; readonly text: string } | null {
  for (const warning of card.warnings) {
    if (warning.kind === "never-polled") return { kind: "never", text: "not yet" };
    if (warning.kind === "polling-late") return { kind: "late", text: `${ageLabel(warning.lastPolledAt, now)} late` };
  }
  return null;
}

// ---- the queue ----

export const TABS = ["all", "answer", "grant", "ready", "other", "unreadable", "sent"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_NAMES: Readonly<Record<Tab, string>> = { all: "All", answer: "Answer", grant: "Grant", ready: "Build", other: "Other", unreadable: "Unreadable", sent: "Sent" };

export interface QueueView {
  readonly rows: readonly InboxRowView[];
  readonly unreadable: readonly UnreadableInboxRowView[];
  readonly sent: readonly ActionRecordView[];
}

/** The queue for one fleet, or for every fleet with no filter. */
export function queueFor(view: Pick<FleetsView, "inbox" | "unreadableInbox" | "recentActions">, fleet: string | null): QueueView {
  const mine = <T extends { readonly fleet: string }>(rows: readonly T[]): readonly T[] => (fleet === null ? rows : rows.filter((row) => row.fleet === fleet));
  return { rows: mine(view.inbox), unreadable: mine(view.unreadableInbox), sent: mine(view.recentActions) };
}

/** Each tab's count. All counts every Inbox row, the unreadable ones among them. */
export function tabCounts(queue: QueueView): Readonly<Record<Tab, number>> {
  const by = (waitsFor: InboxRowView["waitsFor"]) => queue.rows.filter((row) => row.waitsFor === waitsFor).length;
  return { all: queue.rows.length + queue.unreadable.length, answer: by("answer"), grant: by("grant"), ready: by("ready"), other: by("other"), unreadable: queue.unreadable.length, sent: queue.sent.length };
}

/** The tabs drawn: Unreadable only while there is an unreadable row. */
export function tabsShown(counts: Readonly<Record<Tab, number>>): Tab[] {
  return TABS.filter((tab) => tab !== "unreadable" || counts.unreadable > 0);
}

/** The rows a tab lists, oldest first, and the unreadable ones under All and Unreadable. */
export function tabRows(queue: QueueView, tab: Tab): { readonly rows: readonly InboxRowView[]; readonly unreadable: readonly UnreadableInboxRowView[] } {
  if (tab === "sent") return { rows: [], unreadable: [] };
  if (tab === "unreadable") return { rows: [], unreadable: queue.unreadable };
  return { rows: tab === "all" ? queue.rows : queue.rows.filter((row) => row.waitsFor === tab), unreadable: tab === "all" ? queue.unreadable : [] };
}

export const NOTHING_WAITS = "Nothing waits on you";
export const NOTHING_WAITS_LINE = "New questions, grants and builds show up here as your fleets park them.";
export const NO_FLEET_TITLE = "No fleet is registered";
export const NO_FLEET_TEXT = "A fleet appears here once";
export const NO_FLEET_COMMAND = "/run-fleet";
export const NO_FLEET_TAIL = "from unattendish-sdlc runs with this plugin installed.";

// ---- a row opened from a toast ----

/** The row a toast's Answer… or Grant… names, in the view; null once it has left the Inbox. */
export function requestedRow(view: Pick<FleetsView, "inbox">, target: { readonly fleet: string; readonly rowId: string }): InboxRowView | null {
  return view.inbox.find((row) => sameRow(row, { fleet: target.fleet, id: target.rowId })) ?? null;
}

/** The filter that shows `row`: as it is where it already shows the row, every fleet otherwise. */
export function filterShowing(filter: string | null, row: Pick<InboxRowView, "fleet">): string | null {
  return filter === null || filter === row.fleet ? filter : null;
}

/** The tab that shows `row`: as it is where it already lists the row, All otherwise. */
export function tabShowing(queue: QueueView, tab: Tab, row: Pick<InboxRowView, "fleet" | "id">): Tab {
  return tabRows(queue, tab).rows.some((shown) => sameRow(shown, row)) ? tab : "all";
}

/** The composer a toast opens on a row: the one its own Answer… or Grant… opens, and none while its action is under way, sent or done. */
export function composerFor(action: RowAction): "answer" | "grant" | null {
  if (action.kind !== "offer") return null;
  return action.offer.kind === "answer" || action.offer.kind === "grant" ? action.offer.kind : null;
}

/** The short toast for a row that left the Inbox before its toast was clicked: `#7 Which cache to use no longer waits on you`. */
export function goneText(target: { readonly ref: string; readonly what: string }): string {
  return `${itemTitle(target.ref, target.what)} no longer waits on you`;
}
