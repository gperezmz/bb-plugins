// What an Inbox row shows and offers, decided from the row the server sent and what this window has in flight.
import type { ActionKind, ActionOffer, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { ageLabel, elapsedMs, spanLabel } from "../format";
import { hasRef } from "../item-title";

/** What a row waits for, as the table says it. */
export function waitsForText(waitsFor: InboxRowView["waitsFor"]): string {
  switch (waitsFor) {
    case "answer":
      return "your answer";
    case "grant":
      return "a grant to merge";
    case "ready":
      return "your ready label";
    case "other":
      return "something else";
  }
}

/** What this window knows of the action it sent on a row, until the server's view says it. */
export interface LocalAction {
  /** `sending`: the call has not answered; `accepted`: bb took the message and the view is being fetched; `unknown`: the call failed and the view is being fetched. */
  readonly phase: "idle" | "sending" | "accepted" | "unknown";
  /** When the server recorded the action sent in this window, while `accepted`. */
  readonly acceptedAt: string | null;
  /** Why bb refused the last message. */
  readonly refusal: string | null;
  /** True when the last call failed and the server's view did not show the action: whether it was sent is unknown. */
  readonly unconfirmed: boolean;
}

export type RowAction =
  /** Nothing to do on the row: it waits for something other than the operator's words. */
  | { readonly kind: "none" }
  /** The call is in flight, or failed and the server's view is being fetched: not yet sent, not yet refused. */
  | { readonly kind: "sending" | "unknown"; readonly text: string }
  /** An action bb accepted and no poll has seen done yet, in this window or any other. */
  | { readonly kind: "sent"; readonly text: string }
  | { readonly kind: "done"; readonly text: "done" }
  | { readonly kind: "offer"; readonly offer: ActionOffer; readonly refusal: string | null; readonly unconfirmed: boolean };

/**
 * The action cell of a row. The server's view wins: a row whose view carries an action shows it sent or done,
 * whichever window sent it. Before that, a call in flight reads `sending…`, never `sent`; `sent` is shown once
 * bb has accepted the message. A sent action is never shown as failed: only bb's refusal of the message is, and the
 * row then keeps its action. A call that failed reads `checking…` until the view is fetched, and the row
 * then shows what the server recorded.
 */
export function rowAction(row: Pick<InboxRowView, "offer" | "action">, now: string, local: LocalAction): RowAction {
  if (row.action?.state === "done") return { kind: "done", text: "done" };
  if (row.action?.state === "sent") return { kind: "sent", text: `sent · ${ageLabel(row.action.sentAt, now)}` };
  if (local.phase === "sending") return { kind: "sending", text: "sending…" };
  if (local.phase === "unknown") return { kind: "unknown", text: "checking…" };
  if (local.phase === "accepted" && local.acceptedAt !== null) return { kind: "sent", text: `sent · ${ageLabel(local.acceptedAt, now)}` };
  if (row.offer === null) return { kind: "none" };
  return { kind: "offer", offer: row.offer, refusal: local.refusal, unconfirmed: local.unconfirmed };
}

/** True where the action asks the operator for words of their own. */
export function takesText(kind: ActionKind, regrant = false): boolean {
  return (kind === "answer" || kind === "grant") && !regrant;
}

/** The label of a row's button with the item it acts on, for the control's accessible name. */
export function actionName(label: string, row: Pick<InboxRowView, "ref">): string {
  return hasRef(row.ref) ? `${label} ${row.ref}` : label;
}

export interface SendInput {
  readonly fleet: string;
  readonly rowId: string;
  readonly kind: ActionKind;
  readonly text?: string;
  readonly regrant?: boolean;
}

/** The call for an action: the operator's words only for Answer… and Grant…, `regrant` only for Re-grant. */
export function sendInput(row: Pick<InboxRowView, "fleet" | "id">, kind: ActionKind, options: { text?: string; regrant?: boolean } = {}): SendInput {
  const base = { fleet: row.fleet, rowId: row.id, kind };
  if (options.regrant === true) return { ...base, regrant: true };
  if (takesText(kind)) return { ...base, text: (options.text ?? "").trim() };
  return base;
}

/** How long a row may wait before its age turns amber. A placeholder: changing it is this constant. */
export const AGE_AMBER_MS = 8 * 3_600_000;

/** A row's age, and whether it has waited long enough to turn amber. */
export function rowAge(row: Pick<InboxRowView, "since">, now: string): { readonly text: string; readonly long: boolean } {
  const waited = elapsedMs(row.since, now);
  return { text: spanLabel(waited), long: waited >= AGE_AMBER_MS };
}

/** What a link's URL opens, as its service names it, by the URL's own path: an issue or a pull request `#12`, a merge request `!12`, a Linear or Jira key. */
const SHORT_LINKS: readonly [RegExp, (match: RegExpExecArray) => string][] = [
  [/\/-\/merge_requests\/(\d+)(?:[/?#]|$)/, (m) => `!${m[1]}`],
  [/\/(?:-\/)?(?:issues|pull)\/(\d+)(?:[/?#]|$)/, (m) => `#${m[1]}`],
  [/\/(?:issue|browse)\/([A-Z][A-Z0-9_]*-\d+)(?:[/?#]|$)/, (m) => m[1]!],
];

/**
 * The queue's short text for a row's link: what the URL opens, `#12` or `ENG-212`, read off the URL itself, since a
 * row's Link is its pull request where one is open and so need not be its Ref's item; the link's own text otherwise.
 */
export function shortLinkLabel(row: Pick<InboxRowView, "link">): string | undefined {
  if (row.link.kind !== "url") return undefined;
  for (const [pattern, label] of SHORT_LINKS) {
    const match = pattern.exec(row.link.url);
    if (match !== null) return label(match);
  }
  return undefined;
}

/**
 * An unreadable row in a line, naming its section where the list it sits in holds more than one:
 * `Unreadable Inbox row, line 9: the table has no "Waits for" column`, or `Unreadable row, line 9: …` without one.
 */
export function unreadableLine(row: Pick<UnreadableInboxRowView, "line" | "reason">, section?: string): string {
  return `Unreadable ${section === undefined ? "" : `${section} `}row, line ${row.line}: ${row.reason}`;
}
