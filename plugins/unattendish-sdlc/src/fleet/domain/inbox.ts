// An Inbox row as the operator meets it: the id that names it, where its Link
// goes, and what the operator may send the manager about it.
import { parseMessageLink } from "./manifest";
import type { InboxRow } from "./model";

/** The three actions the dashboard sends a manager: Answer…, Grant… and Build it. */
export type ActionKind = "answer" | "grant" | "build";

/** Where a Link goes: an http(s) URL, or a message in a bb thread (`threadId` null for the manager's own). */
export type ParsedLink =
  | { readonly kind: "url"; readonly url: string; readonly text: string }
  | { readonly kind: "message"; readonly message: { readonly threadId: string | null; readonly message: number; readonly at: string } };

/** What the operator may do on an Inbox row that has no action in flight. */
export interface Offer {
  readonly kind: ActionKind;
  /** The button's label: `Answer…`, `Grant…` or `Build it`. */
  readonly label: string;
  /** A `grant` row whose Link names a previous manager's message: one click re-sends the row's What. */
  readonly regrant: boolean;
}

const LABELS: Readonly<Record<ActionKind, string>> = { answer: "Answer…", grant: "Grant…", build: "Build it" };

/** The label of an action's button, and of the action in a refusal. */
export const labelOf = (kind: ActionKind): string => LABELS[kind];

/** The Link cell as a destination. A cell that is neither a message nor a URL (a row the reader refused) reads as a URL with its text. */
export const parseLink = (link: string): ParsedLink => {
  const message = parseMessageLink(link);
  if (message !== null) return { kind: "message", message };
  try {
    const url = new URL(link);
    return { kind: "url", url: link, text: `${url.host}${url.pathname === "/" ? "" : url.pathname}` };
  } catch {
    return { kind: "url", url: link, text: link };
  }
};

/**
 * The id of an Inbox row: stable for a row across polls and reloads, since it is built from what the row says and
 * not from where it sits. A row with no Ref (`—`) is told apart by its Link as well, which names its message.
 * It names no fleet: the store keeps each fleet's seen rows and actions apart and holds this id with them, so the id
 * stays as it is, and a list of several fleets' rows tells them apart by the fleet beside it (`rowKey`).
 */
export const inboxRowId = (row: Pick<InboxRow, "ref" | "waitsFor" | "since" | "link">): string =>
  row.ref === "—" ? `—|${row.waitsFor}|${row.since}|${row.link}` : `${row.ref}|${row.waitsFor}|${row.since}`;

/** The ids of rows listed together, each made unique: a second row with an id already taken takes `~2`, a third `~3`. */
export const uniqueRowIds = (rows: readonly Pick<InboxRow, "ref" | "waitsFor" | "since" | "link">[]): string[] => {
  const taken = new Map<string, number>();
  return rows.map((row) => {
    const id = inboxRowId(row);
    const seen = (taken.get(id) ?? 0) + 1;
    taken.set(id, seen);
    return seen === 1 ? id : `${id}~${seen}`;
  });
};

/**
 * What the operator may do on a row: Answer… on `answer`, Grant… on `grant` (with Re-grant when the Link names a
 * message in another thread than the current manager's: a previous manager's), Build it on `ready`, nothing on `other`.
 */
export const offerFor = (row: Pick<InboxRow, "waitsFor" | "link">, managerThreadId: string): Offer | null => {
  switch (row.waitsFor) {
    case "answer":
      return { kind: "answer", label: LABELS.answer, regrant: false };
    case "grant": {
      const message = parseMessageLink(row.link);
      return { kind: "grant", label: LABELS.grant, regrant: message !== null && message.threadId !== null && message.threadId !== managerThreadId };
    }
    case "ready":
      return { kind: "build", label: LABELS.build, regrant: false };
    case "other":
      return null;
  }
};
