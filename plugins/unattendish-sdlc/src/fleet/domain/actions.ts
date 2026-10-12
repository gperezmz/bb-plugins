// What the operator sends a manager from the dashboard, and when it counts as
// done. The message is the operator's own plain prompt; it names no plugin.
import { labelOf, offerFor, type ActionKind } from "./inbox";
import { parseMessageLink } from "./manifest";
import type { InboxRow } from "./model";

export const ACTION_TEXT_MAX_CHARS = 20_000;

/** How long a finished action is kept to show as done. */
export const DONE_KEPT_MS = 86_400_000;
/** How long a finished action whose row has left the Inbox is listed as recent. */
export const RECENT_MS = 3_600_000;

/** An action the plugin sent, kept until a poll sees its result and for a while after. Never timed out, never marked failed. */
export interface ActionRecord {
  readonly id: string;
  /** The repository's id, as the store keys a fleet. */
  readonly repo: string;
  readonly rowId: string;
  readonly kind: ActionKind;
  readonly ref: string;
  readonly what: string;
  readonly managerThreadId: string;
  readonly state: "sent" | "done";
  readonly sentAt: string;
  /** The poll that saw the result; null while `sent`. */
  readonly doneAt: string | null;
}

export const actionId = (rowId: string, sentAt: string): string => `${sentAt}|${rowId}`;

export interface ActionRequest {
  /** The row in the fleet's current manifest; undefined when none has the id. */
  readonly row: InboxRow | undefined;
  readonly kind: ActionKind;
  readonly text?: string | undefined;
  readonly regrant?: boolean | undefined;
  readonly managerThreadId: string;
  /** An action is already sent on the row, or done with the row still in the Inbox. */
  readonly taken: boolean;
}

export type ActionPlan = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): ActionPlan => ({ ok: false, reason });

/**
 * The message an action sends, exactly: `Answer to <Ref>: <text>`, or `Answer to message <n>: <text>` where the Ref
 * is `—`; `Grant: <text>`; `Grant: <What>` for Re-grant; `Build <Ref>`. Plain, with nothing added, and the text whole.
 */
export const actionMessage = (kind: ActionKind, row: Pick<InboxRow, "ref" | "what" | "link">, text: string, regrant: boolean): string => {
  switch (kind) {
    case "answer": {
      const message = row.ref === "—" ? parseMessageLink(row.link) : null;
      return row.ref === "—" ? `Answer to message ${message?.message ?? 0}: ${text}` : `Answer to ${row.ref}: ${text}`;
    }
    case "grant":
      return regrant ? `Grant: ${row.what}` : `Grant: ${text}`;
    case "build":
      return `Build ${row.ref}`;
  }
};

/** Whether an action may be sent on the row as asked, and if so the message to send; else why not. */
export const planAction = (request: ActionRequest): ActionPlan => {
  const { row, kind } = request;
  if (row === undefined) return refuse("that row is no longer in the Inbox");
  const offer = offerFor(row, request.managerThreadId);
  if (offer === null) return refuse("this row waits for something the dashboard cannot send; answer it in the manager's thread");
  if (offer.kind !== kind) return refuse(`this row offers ${labelOf(offer.kind)}, not ${labelOf(kind)}`);
  if (request.taken) return refuse("an action is already sent on this row");
  const regrant = request.regrant === true;
  if (regrant && !offer.regrant) return refuse("this row does not carry a grant from a previous manager");
  if (kind === "build" && row.ref === "—") return refuse("a row with no Ref names nothing to build");
  if (kind === "answer" && row.ref === "—" && parseMessageLink(row.link) === null) return refuse("this row names no message to answer");
  if (kind !== "build" && !regrant) {
    const text = request.text;
    if (text === undefined || text.trim() === "") return refuse(kind === "answer" ? "write the answer to send" : "write the grant to send");
    if (text.length > ACTION_TEXT_MAX_CHARS) return refuse(`the text is over ${ACTION_TEXT_MAX_CHARS} characters`);
  }
  return { ok: true, message: actionMessage(kind, row, request.text ?? "", regrant) };
};

/** The latest action sent on a row. */
export const latestOn = (records: readonly ActionRecord[], rowId: string): ActionRecord | null =>
  records.filter((record) => record.rowId === rowId).sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0))[0] ?? null;

/**
 * The ids of the sent actions a manifest read shows done: Answer… and Grant… when the row is gone from the Inbox
 * (no row has its id), Build it when `ready` says the spec carries the ready label, or when the row is gone.
 */
export const finishedActions = (sent: readonly ActionRecord[], inboxIds: ReadonlySet<string>, ready: (ref: string) => boolean): string[] =>
  sent.filter((record) => record.state === "sent" && (!inboxIds.has(record.rowId) || (record.kind === "build" && ready(record.ref)))).map((record) => record.id);

/** Done actions whose row has left the Inbox and that finished within the last hour, newest first. */
export const recentActions = (records: readonly ActionRecord[], inboxIds: ReadonlySet<string>, now: Date): ActionRecord[] => {
  const from = now.getTime() - RECENT_MS;
  return records
    .filter((record) => record.state === "done" && !inboxIds.has(record.rowId) && record.doneAt !== null && Date.parse(record.doneAt) >= from)
    .sort((a, b) => (a.doneAt! < b.doneAt! ? 1 : a.doneAt! > b.doneAt! ? -1 : 0));
};
