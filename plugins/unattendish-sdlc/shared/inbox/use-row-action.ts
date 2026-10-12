// What one Inbox row holds in this window while an action is being composed or sent. A sent
// action itself is the server's: the row's view carries it, so every window shows it.
import { useState } from "react";
import type { ActionKind, InboxRowView } from "@/src/fleet/application/views";
import { useDashboardApi } from "../client";
import { sendInput, takesText } from "./row-model";

export interface RowActionState {
  /** The kind whose composer is open on the row. */
  readonly composing: ActionKind | null;
  readonly text: string;
  readonly sending: boolean;
  /** Why bb refused the last message; the row keeps its action and the composer keeps its text. */
  readonly refusal: string | null;
  setText(text: string): void;
  compose(kind: ActionKind): void;
  cancel(): void;
  /** Sends the action; Answer… and Grant… send the composer's text. */
  send(kind: ActionKind, options?: { regrant?: boolean }): Promise<void>;
}

export function useRowAction(row: InboxRowView, refetch: () => Promise<void>): RowActionState {
  const api = useDashboardApi();
  const [composing, setComposing] = useState<ActionKind | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send(kind: ActionKind, options: { regrant?: boolean } = {}): Promise<void> {
    const wantsText = takesText(kind, options.regrant);
    setSending(true);
    setRefusal(null);
    setComposing(null);
    try {
      const result = await api.sendAction(sendInput(row, kind, { text, regrant: options.regrant }));
      if (result.ok) {
        setText("");
        await refetch();
      } else {
        setRefusal(result.reason);
        if (wantsText) setComposing(kind);
      }
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
      if (wantsText) setComposing(kind);
    } finally {
      setSending(false);
    }
  }

  return {
    composing,
    text,
    sending,
    refusal,
    setText,
    compose: (kind) => {
      setRefusal(null);
      setComposing(kind);
    },
    cancel: () => setComposing(null),
    send,
  };
}
