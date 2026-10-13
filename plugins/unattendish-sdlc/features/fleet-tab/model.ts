// What the Fleet tab says, decided from its views alone.
import type { FleetCardView, FleetCredentialView, FleetDetailView, InFlightRowView, LedgerChangeView, LedgerFilter, LedgerView, ServiceKind, UnreadableRowView, WatchedItemView } from "@/src/fleet/application/views";
import { credentialKind } from "@/shared/credentials";
import { ageLabel, dateTimeLabel, expiryText, intervalLabel, plural, polledLabel } from "@/shared/format";
import type { Tone } from "@/shared/look/tones";
import { fleetMark } from "@/shared/fleet-flags";

/** A manifest the plugin read. */
export type OkManifest = Extract<FleetDetailView["manifest"], { status: "ok" }>;

// ---- the switcher ----

/** One fleet as the switcher lists it. */
export interface SwitcherEntry {
  readonly repo: string;
  /** The rows that wait on the operator, drawn in amber; null when none does. */
  readonly count: number | null;
  /** Red for a problem, amber for a warning alone; null with neither. */
  readonly dot: "problem" | "warning" | null;
  /** `org/wake, 2 waiting on you, has a problem`. */
  readonly label: string;
}

/** The switcher's entries, one per fleet the thread holds, in the order given. */
export function switcherEntries(cards: readonly Pick<FleetCardView, "repo" | "waiting" | "problems" | "warnings">[], now: string): SwitcherEntry[] {
  return cards.map((card) => {
    const { count, dot } = fleetMark(card, now);
    const parts = [card.repo, ...(count === null ? [] : [`${count} waiting on you`]), ...(dot === null ? [] : [dot === "problem" ? "has a problem" : "has a warning"])];
    return { repo: card.repo, count, dot, label: parts.join(", ") };
  });
}

/** The entry a key moves to from `at` in a menu of `length` entries, wrapping; null for a key that moves nothing. */
export function nextEntry(at: number, key: string, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown") return (at + 1) % length;
  if (key === "ArrowUp") return (at - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

// ---- the tabs ----

export type FleetTabName = "work" | "notes" | "watching" | "ledger";

/** The tabs under the header, in order, with their labels. Work opens first. */
export const FLEET_TABS: readonly { readonly id: FleetTabName; readonly label: string }[] = [
  { id: "work", label: "Work" },
  { id: "notes", label: "Notes" },
  { id: "watching", label: "Watching" },
  { id: "ledger", label: "Ledger" },
];

export interface TabCount {
  /** Null where the tab shows no number. */
  readonly count: number | null;
  readonly tone: Tone;
}

/**
 * Each tab's count: the rows that wait on the operator, amber; the sections the manifest has written; the items in the
 * watched set; and the reads that failed in the last 24 hours, red, with no number when none did.
 */
export function tabCounts(detail: Pick<FleetDetailView, "card" | "manifest" | "watched" | "failedReads">): Readonly<Record<FleetTabName, TabCount>> {
  return {
    work: { count: detail.card.waiting, tone: detail.card.waiting > 0 ? "amber" : "grey" },
    notes: { count: detail.manifest.status === "ok" ? detail.manifest.written.length : 0, tone: "grey" },
    watching: { count: detail.watched.length, tone: "grey" },
    ledger: { count: detail.failedReads > 0 ? detail.failedReads : null, tone: "red" },
  };
}

/** A tab's accessible name: its label with its count where it shows one, `Ledger, 1 read failed in the last 24 hours`. */
export function tabName(tab: FleetTabName, count: TabCount): string {
  const label = FLEET_TABS.find((entry) => entry.id === tab)!.label;
  if (count.count === null) return label;
  switch (tab) {
    case "work":
      return `${label}, ${count.count} waiting on you`;
    case "notes":
      return `${label}, ${plural(count.count, "section")}`;
    case "watching":
      return `${label}, ${plural(count.count, "item")} watched`;
    case "ledger":
      return `${label}, ${count.count === 1 ? "1 read" : `${count.count} reads`} failed in the last 24 hours`;
  }
}

/** The tab an arrow key moves to from `tab`, wrapping at either end; null for any other key. */
export function nextTab(tab: FleetTabName, key: string): FleetTabName | null {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (step === 0) return null;
  const at = FLEET_TABS.findIndex((entry) => entry.id === tab);
  return FLEET_TABS[(at + step + FLEET_TABS.length) % FLEET_TABS.length]!.id;
}

/** What the tab says in place of the manifest's rows or sections when the manifest is missing, cannot be read, or names another repository. */
export function manifestProblemText(manifest: FleetDetailView["manifest"]): string | null {
  if (manifest.status === "missing") return "No manifest was found at the path the fleet registered.";
  if (manifest.status === "unreadable") return `The manifest cannot be read: ${manifest.reason}`;
  if (manifest.status === "left-behind") return `The manifest now names ${manifest.names}, so nothing in it is this fleet's.`;
  return null;
}

// ---- Work ----

export type WorkSection = "inbox" | "inFlight" | "blocked" | "landed";

/** The folding sections of Work, in order. */
export const WORK_SECTIONS: readonly WorkSection[] = ["inbox", "inFlight", "blocked", "landed"];

export const SECTION_TITLES: Readonly<Record<WorkSection, string>> = { inbox: "Waits on you", inFlight: "In flight", blocked: "Blocked", landed: "Landed" };

/** The manifest's own heading of each section, which an unreadable row names. */
const MANIFEST_HEADINGS: Readonly<Record<WorkSection, string>> = { inbox: "Inbox", inFlight: "In flight", blocked: "Blocked", landed: "Landed" };

/** Which sections start open: all but Landed. */
export const INITIALLY_OPEN: Readonly<Record<WorkSection, boolean>> = { inbox: true, inFlight: true, blocked: true, landed: false };

/** The rows of a section the plugin cannot read. */
export function unreadableIn(manifest: Pick<OkManifest, "unreadable">, section: WorkSection): UnreadableRowView[] {
  return manifest.unreadable.filter((row) => row.section === MANIFEST_HEADINGS[section]);
}

/** How many lines a section lists: its rows and the rows it cannot read. */
export function sectionCount(manifest: OkManifest, section: WorkSection): number {
  const readable = section === "inbox" ? manifest.inbox.length : manifest[section].length;
  const unreadable = section === "inbox" ? manifest.unreadableInbox.length : unreadableIn(manifest, section).length;
  return readable + unreadable;
}

/** The element id of an unreadable row, which Review scrolls to. */
export function unreadableRowId(section: WorkSection, line: number): string {
  return `fleet-tab-unreadable-${section}-${line}`;
}

export interface ReviewTarget {
  /** The section to unfold; null where Work shows the manifest's problem, or nothing needs reviewing. */
  readonly section: WorkSection | null;
  /** The row to scroll to. */
  readonly rowId: string | null;
}

/** What Review opens Work at: the first row the plugin cannot read, in section order; nothing in particular for a missing or unreadable manifest, whose sentence Work shows. */
export function reviewTarget(manifest: FleetDetailView["manifest"]): ReviewTarget {
  if (manifest.status !== "ok") return { section: null, rowId: null };
  for (const section of WORK_SECTIONS) {
    const first = section === "inbox" ? manifest.unreadableInbox[0] : unreadableIn(manifest, section)[0];
    if (first !== undefined) return { section, rowId: unreadableRowId(section, first.line) };
  }
  return { section: null, rowId: null };
}

/** `at the bar for 25m`: the stage a row is at and how long it has been there. */
export function stageText(row: Pick<InFlightRowView, "stage" | "since">, now: string): string {
  return `${row.stage} for ${ageLabel(row.since, now)}`;
}

/** Where each item the watched set knows lives, by its Ref, so a Blocked row's `waits for` links to each. */
export function refLinks(watched: readonly Pick<WatchedItemView, "ref" | "url">[]): ReadonlyMap<string, string> {
  return new Map(watched.flatMap((item) => (item.url === null ? [] : [[item.ref, item.url] as const])));
}

// ---- Watching ----

/** Why an item is in the watched set. */
export function whyText(item: Pick<WatchedItemView, "why">): string {
  return item.why.join(" · ");
}

/** The service a credential reads, by its kind. */
export function credentialService(kind: FleetCredentialView["kind"]): ServiceKind {
  switch (kind) {
    case "fine-grained":
    case "classic":
    case "gh":
      return "github";
    case "gitlab-token":
    case "glab":
      return "gitlab";
    case "linear-key":
      return "linear";
    case "jira-token":
      return "jira";
  }
}

/** A credential's facts: the half it reads, its kind, and its expiry, red once it has expired and quiet otherwise. */
export function credentialFacts(credential: FleetCredentialView): { readonly text: string; readonly red: boolean }[] {
  return [
    { text: `reads the ${credential.role}`, red: false },
    { text: credentialKind(credential.kind), red: false },
    { text: expiryText(credential.expiresAt, credential.expired), red: credential.expired },
  ];
}

/** `every 2m · polled 40s ago · 188 requests this hour`. */
export function pollingText(detail: Pick<FleetDetailView, "card" | "requestsThisHour" | "generatedAt">): string {
  return `${intervalLabel(detail.card.intervalMs)} · ${polledLabel(detail.card.lastPolledAt, detail.generatedAt)} · ${plural(detail.requestsThisHour, "request")} this hour`;
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
