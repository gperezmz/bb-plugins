// What an Inbox row shows and offers, decided from the row the server sent and what this window has in flight.
import type { ActionKind, ActionOffer, ActionRecordView, InboxRowView, UnreadableInboxRowView } from "@/src/fleet/application/views";
import { ageLabel } from "../format";

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

/** The item and what it is: `ENG-212 which locale wins?`; a Ref of `—` is left out. */
export function rowTitle(row: Pick<InboxRowView, "ref" | "what">): string {
  return row.ref === "—" || row.ref === "" ? row.what : `${row.ref} ${row.what}`;
}

/** How long a row has waited, as of the view's clock. */
export function waitedText(row: Pick<InboxRowView, "since">, now: string): string {
  return ageLabel(row.since, now);
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
 * row then keeps its action. A call that failed reads `result unknown` until the view is fetched, and the row
 * then shows what the server recorded.
 */
export function rowAction(row: Pick<InboxRowView, "offer" | "action">, now: string, local: LocalAction): RowAction {
  if (row.action?.state === "done") return { kind: "done", text: "done" };
  if (row.action?.state === "sent") return { kind: "sent", text: `sent · ${ageLabel(row.action.sentAt, now)}` };
  if (local.phase === "sending") return { kind: "sending", text: "sending…" };
  if (local.phase === "unknown") return { kind: "unknown", text: "result unknown, checking…" };
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
  return row.ref === "—" || row.ref === "" ? label : `${label} ${row.ref}`;
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

/** `unreadable: <column>`, whether the server's reason already says it or only names the column. */
export function unreadableText(row: Pick<UnreadableInboxRowView, "reason">): string {
  return /^unreadable\b/i.test(row.reason) ? row.reason : `unreadable: ${row.reason}`;
}

/** A recently finished action in a line: `answered #163 · done`. */
export function recentActionText(action: Pick<ActionRecordView, "kind" | "ref" | "state">): string {
  const verb = action.kind === "answer" ? "answered" : action.kind === "grant" ? "granted" : "asked to build";
  return `${verb} ${action.ref} · ${action.state}`;
}
