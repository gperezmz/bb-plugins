// What the Inbox rows hold in this window while an action is composed or sent, kept for every row in one place
// above the table's layout, so a viewport change that redraws the rows keeps a composer's text. A sent action
// itself is the server's: the row's view carries it, so every window shows it.
import { useState } from "react";
import type { ActionKind, InboxRowView } from "@/src/fleet/application/views";
import { useDashboardApi } from "../client";
import { rowKey, sendInput, takesText, type LocalAction } from "./row-model";

export interface RowActionState extends LocalAction {
  /** The kind whose composer is open on the row. */
  readonly composing: ActionKind | null;
  readonly text: string;
  setText(text: string): void;
  compose(kind: ActionKind): void;
  cancel(): void;
  /** Sends the action; Answer… and Grant… send the composer's text. */
  send(kind: ActionKind, options?: { regrant?: boolean }): Promise<void>;
}

interface Local extends LocalAction {
  readonly composing: ActionKind | null;
  readonly text: string;
}

const IDLE: Local = { composing: null, text: "", phase: "idle", acceptedAt: null, refusal: null, unconfirmed: false };

/** The state of any row, by the row; `refetch` brings the server's view back after a send. */
export function useRowActions(refetch: () => Promise<void>): (row: InboxRowView) => RowActionState {
  const api = useDashboardApi();
  const [locals, setLocals] = useState<Record<string, Local>>({});
  const patch = (id: string, change: Partial<Local>) => setLocals((previous) => ({ ...previous, [id]: { ...(previous[id] ?? IDLE), ...change } }));

  return (row) => {
    const id = rowKey(row);
    const local = locals[id] ?? IDLE;

    async function send(kind: ActionKind, options: { regrant?: boolean } = {}): Promise<void> {
      const wantsText = takesText(kind, options.regrant);
      patch(id, { phase: "sending", refusal: null, unconfirmed: false, composing: null });
      try {
        const result = await api.sendAction(sendInput(row, kind, { text: local.text, regrant: options.regrant }));
        if (result.ok) {
          patch(id, { phase: "accepted", acceptedAt: result.action.sentAt, text: "" });
          await refetch();
          patch(id, { phase: "idle", acceptedAt: null });
        } else {
          patch(id, { phase: "idle", refusal: result.reason, composing: wantsText ? kind : null });
        }
      } catch {
        // The call failed after bb may have taken the message: the server's view says whether it did.
        patch(id, { phase: "unknown" });
        await refetch();
        patch(id, { phase: "idle", unconfirmed: true, composing: wantsText ? kind : null });
      }
    }

    return {
      ...local,
      setText: (text) => patch(id, { text }),
      compose: (kind) => patch(id, { composing: kind, refusal: null, unconfirmed: false }),
      // Cancelling discards the draft; only a refusal keeps it, in the composer left open.
      cancel: () => patch(id, { composing: null, text: "" }),
      send,
    };
  };
}
