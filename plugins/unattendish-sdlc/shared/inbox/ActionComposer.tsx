import { useEffect, useRef } from "react";
import type { InboxRowView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { itemTitle } from "../item-title";
import { ItemLink } from "../ItemLink";
import { canSend, keyIntent } from "./composer-model";

/**
 * The composer under an Inbox row: which item the words are for and which fleet's manager they go to, a link to the
 * park, and a text area for the operator's words. ⌘/Ctrl+Enter sends, Esc cancels, nothing sends while it is empty. A
 * refusal from bb shows in the footer in place of the hint, and the draft stays.
 */
export function ActionComposer({
  row,
  verb,
  text,
  onText,
  onSend,
  onCancel,
  refusal = null,
}: {
  row: InboxRowView;
  /** What the words are: `answer` or `grant`. */
  verb: string;
  text: string;
  onText(text: string): void;
  onSend(): void;
  onCancel(): void;
  /** Why bb refused the last send of these words. */
  refusal?: string | null;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Your {verb} for {itemTitle(row.ref, row.what)} · goes to {row.fleet}'s manager
        </span>
        <ItemLink link={row.link} managerThreadId={row.managerThreadId} />
      </div>
      <Textarea
        ref={field}
        aria-label={`Your ${verb} for ${row.ref}`}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          const intent = keyIntent(event, text);
          if (intent === null) return;
          event.preventDefault();
          if (intent === "send") onSend();
          else onCancel();
        }}
      />
      <div className="flex items-center justify-end gap-2">
        {refusal !== null ? (
          <span role="alert" className="mr-auto text-xs text-destructive-text">
            Not sent: {refusal}
          </span>
        ) : (
          // A phone has no such keys.
          <span className="mr-auto hidden text-xs text-muted-foreground md:inline">⌘↵ send · Esc cancel</span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSend(text)} onClick={onSend}>
          Send
        </Button>
      </div>
    </div>
  );
}
