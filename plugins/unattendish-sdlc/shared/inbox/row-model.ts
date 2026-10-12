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

export type RowAction =
  /** Nothing to do on the row: it waits for something other than the operator's words. */
  | { readonly kind: "none" }
  /** An action is sent and not yet seen done, in this window or any other. */
  | { readonly kind: "sent"; readonly text: string }
  | { readonly kind: "done"; readonly text: "done" }
  | { readonly kind: "offer"; readonly offer: ActionOffer; readonly refusal: string | null };

/**
 * The action cell of a row. A row whose server view carries an action shows it sent or done,
 * whichever window sent it; `sending` covers the moment before the server has answered.
 * A sent action is never shown as failed: only bb's refusal of the message is, and the row then keeps its action.
 */
export function rowAction(row: Pick<InboxRowView, "offer" | "action">, now: string, local: { sending: boolean; refusal: string | null }): RowAction {
  if (local.sending) return { kind: "sent", text: "sent · 0s" };
  if (row.action?.state === "done") return { kind: "done", text: "done" };
  if (row.action?.state === "sent") return { kind: "sent", text: `sent · ${ageLabel(row.action.sentAt, now)}` };
  if (row.offer === null) return { kind: "none" };
  return { kind: "offer", offer: row.offer, refusal: local.refusal };
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
