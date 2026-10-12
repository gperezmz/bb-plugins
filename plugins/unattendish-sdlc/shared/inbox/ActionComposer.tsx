import { useEffect, useRef } from "react";
import type { InboxRowView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ItemLink } from "../ItemLink";
import { canSend, keyIntent } from "./composer-model";
import { rowTitle } from "./row-model";

/**
 * The composer under an Inbox row: the row's What, a link to the park, and a text area for the
 * operator's words. ⌘/Ctrl+Enter sends, Esc cancels, nothing sends while it is empty.
 */
export function ActionComposer({
  row,
  verb,
  text,
  onText,
  onSend,
  onCancel,
}: {
  row: InboxRowView;
  /** What the words are: `answer` or `grant`. */
  verb: string;
  text: string;
  onText(text: string): void;
  onSend(): void;
  onCancel(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{rowTitle(row)}</span>
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
        <span className="mr-auto text-xs text-muted-foreground">⌘/Ctrl+Enter sends · Esc cancels</span>
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
