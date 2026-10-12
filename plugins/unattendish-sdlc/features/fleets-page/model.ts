// What the Fleets page says, decided from its view alone: the fleet board's order and cells, the queue's tabs and rows,
// and the page's states in between.
import type { ActionRecordView, FleetCardView, FleetsView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { flagsOf, isQuiet, worstFlag } from "@/shared/fleet-flags";
import { ageLabel, elapsedMs, formatMoney, spanLabel } from "@/shared/format";
import { itemTitle } from "@/shared/item-title";
import { COUNTS, type CountKey } from "@/shared/look/tones";

const HOUR = 3_600_000;

/** The header's count: the Inbox rows across fleets, and nothing at zero or before the view arrives. */
export function headerCount(view: Pick<FleetsView, "waiting"> | null): string | null {
  return view === null || view.waiting <= 0 ? null : String(view.waiting);
}

/** The header's count as a sentence for assistive technology. */
export function headerCountLabel(waiting: number): string {
  return `${waiting} waiting on you`;
}

/** The pill a failed refresh shows over the data still on screen: `3m old`, and its hover text. */
export function staleText(generatedAt: string, error: string, nowMs: number): { readonly pill: string; readonly hover: string } {
  const age = ageLabel(generatedAt, new Date(nowMs).toISOString());
  return { pill: `${age} old`, hover: `Couldn't refresh: ${error}. Showing what was loaded ${age} ago.` };
}

// ---- the fleet board ----

/**
 * The board's order: fleets with a problem, then those with a warning, then the rest, most waiting first, ties in name
 * order; problems and warnings among themselves the same way.
 */
export function boardOrder(cards: readonly FleetCardView[], now: string): FleetCardView[] {
  const rank = (card: FleetCardView): number => {
    const worst = worstFlag(flagsOf(card, now));
    return worst === "problem" ? 0 : worst === "warning" ? 1 : 2;
  };
  return [...cards].sort((a, b) => rank(a) - rank(b) || b.waiting - a.waiting || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
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

/** How many fleets the condensed board on a phone shows before folding the rest. */
export const PHONE_FLEETS_SHOWN = 3;

/** The condensed board: the first fleets in board order, and how many fold under "N more fleets"; every fleet once `expanded`. */
export function phoneBoard(cards: readonly FleetCardView[], now: string, expanded = false): { readonly shown: FleetCardView[]; readonly more: number } {
  const ordered = boardOrder(cards, now);
  if (expanded) return { shown: ordered, more: 0 };
  return { shown: ordered.slice(0, PHONE_FLEETS_SHOWN), more: Math.max(0, ordered.length - PHONE_FLEETS_SHOWN) };
}

/** `2 more fleets`, `1 more fleet`. */
export function moreLabel(count: number): string {
  return `${count} more ${count === 1 ? "fleet" : "fleets"}`;
}

export interface ManagerCell {
  readonly state: FleetCardView["manager"]["state"];
  /** How long it has been idle; null while working, with no manager, or when bb does not say. */
  readonly duration: string | null;
  /** The state in words: the icon's accessible name and hover text. */
  readonly words: string;
}

/** The manager cell: its state, and how long it has been idle. The plugin cannot know how long a manager has been working. */
export function managerCell(manager: FleetCardView["manager"], now: string): ManagerCell {
  if (manager.state === "working") return { state: "working", duration: null, words: "Manager working" };
  if (manager.state === "none") return { state: "none", duration: null, words: "No manager: its thread is archived or gone" };
  const duration = manager.since === null ? null : ageLabel(manager.since, now);
  return { state: "idle", duration, words: duration === null ? "Manager idle" : `Manager idle for ${duration}` };
}

/** What each Status count is called, as its hover text and accessible name say it. */
const COUNT_WORDS: Readonly<Record<CountKey, string>> = { blocked: "blocked", inFlight: "in flight", waiting: "waiting on you", landed: "landed in the last 7 days" };

/** The Status header's hover text: the four counts. */
export const STATUS_HEADER_TEXT = "Blocked · In flight · Waits on you · Landed in the last 7 days";

export interface StatusSlot {
  readonly key: CountKey;
  /** Null for a count of zero, whose slot stays empty and keeps its place. */
  readonly count: number | null;
  /** `6 waiting on you`. */
  readonly label: string;
}

/** The four Status slots, always in the same order. */
export function statusSlots(card: Pick<FleetCardView, CountKey>): StatusSlot[] {
  return COUNTS.map((key) => ({ key, count: card[key] > 0 ? card[key] : null, label: `${card[key]} ${COUNT_WORDS[key]}` }));
}

/** The spend cell: the manager's cost, or nothing where it is unknown. */
export function spendText(card: Pick<FleetCardView, "cost">): string | null {
  return card.cost === null ? null : formatMoney(card.cost.amount, card.cost.currency);
}

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

/** How long a row may wait before its age turns amber. A placeholder: changing it is this constant. */
export const AGE_AMBER_MS = 8 * HOUR;

/** A row's age, and whether it has waited long enough to turn amber. */
export function rowAge(row: Pick<InboxRowView, "since">, now: string): { readonly text: string; readonly long: boolean } {
  const waited = elapsedMs(row.since, now);
  return { text: spanLabel(waited), long: waited >= AGE_AMBER_MS };
}

/** An unreadable row in a line: `Unreadable Inbox row, line 9: the table has no "Waits for" column`. */
export function unreadableLine(row: Pick<UnreadableInboxRowView, "line" | "reason">): string {
  return `Unreadable Inbox row, line ${row.line}: ${row.reason}`;
}

/** A Sent line: `You answered #5 Which queue`. */
export function sentText(action: Pick<ActionRecordView, "kind" | "ref" | "what">): string {
  const verb = action.kind === "answer" ? "You answered" : action.kind === "grant" ? "You granted" : "You asked to build";
  return `${verb} ${itemTitle(action.ref, action.what)}`;
}

/** How long ago a Sent line's action was seen done: `40m ago`. */
export function sentAgo(action: Pick<ActionRecordView, "doneAt" | "sentAt">, now: string): string {
  return `${ageLabel(action.doneAt ?? action.sentAt, now)} ago`;
}

export const NOTHING_WAITS = "Nothing waits on you";
export const NOTHING_WAITS_LINE = "New questions, grants and builds show up here as your fleets park them.";
export const NO_FLEET_TITLE = "No fleet is registered";
export const NO_FLEET_TEXT = "A fleet appears here once";
export const NO_FLEET_COMMAND = "/run-fleet";
export const NO_FLEET_TAIL = "from unattendish-sdlc runs with this plugin installed.";
