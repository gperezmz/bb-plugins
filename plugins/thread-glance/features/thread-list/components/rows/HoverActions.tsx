// The actions a card shows on hover in its Status slot: Snooze (a clock menu
// with the presets, "Pick date & time…" and Park) and Settle while the thread
// is not busy and not woke, and Settle alone, which waits, while it is busy.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isBusy } from "@/shared/busy";
import { isWaitingSettle } from "@/shared/lifecycle";
import { formatWakeTime, readSnoozePresets, snoozeChoices } from "@/shared/snooze";
import { requestSnoozePicker } from "../../commands/snooze-picker-request";
import type { RowView } from "../../model/list-model";
import { useCommands, useSettings } from "../../store/hooks";
import { Tip } from "./Tip";

/**
 * What a card offers on hover: Snooze and Settle ("all") when it is not busy
 * and not woke; Settle alone when it is busy, which then waits for its tree;
 * nothing when it is woke, already waiting to settle, or has a question or
 * approval of its own.
 */
export function hoverActionsOf(row: RowView): "all" | "settle" | null {
  if (row.woke !== null || isWaitingSettle(row.lifecycle) || row.thread.hasPendingInteraction) return null;
  return isBusy(row.thread) ? "settle" : "all";
}

const ACTION =
  "pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

/** The presets of the clock menu, worked out when the menu opens. */
function SnoozeItems({ threadId }: { threadId: string }) {
  const commands = useCommands();
  const { snoozeShortcuts } = useSettings();
  const now = new Date();
  const choices = snoozeChoices(readSnoozePresets(snoozeShortcuts), now);
  return (
    <>
      {choices.map(({ preset, wakeAt, disabledReason }) => (
        <Tip key={preset.id} label={disabledReason} side="left">
          <div>
            <DropdownMenuItem disabled={wakeAt === null} onSelect={() => wakeAt !== null && void commands.snooze(threadId, wakeAt)}>
              <span className="min-w-0 flex-1 truncate">{preset.label}</span>
              {wakeAt === null ? null : <span className="shrink-0 text-muted-foreground">{formatWakeTime(wakeAt, now)}</span>}
            </DropdownMenuItem>
          </div>
        </Tip>
      ))}
      <DropdownMenuItem onSelect={() => requestSnoozePicker(threadId)}>Pick date &amp; time…</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void commands.park(threadId)}>Park thread</DropdownMenuItem>
    </>
  );
}

export function HoverActions({
  threadId,
  title,
  snooze = true,
  className,
}: {
  threadId: string;
  title: string;
  /** Whether the clock menu is offered beside Settle. */
  snooze?: boolean;
  className?: string;
}) {
  const commands = useCommands();
  return (
    <span data-hover-actions="" className={cn("flex items-center gap-0.5", className)}>
      {snooze ? <DropdownMenu>
        <Tip label="Snooze thread">
          <DropdownMenuTrigger asChild>
            <button type="button" data-no-drag="" aria-label={`Snooze ${title}`} className={ACTION}>
              <Icon name="Clock" aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="min-w-56">
          <SnoozeItems threadId={threadId} />
        </DropdownMenuContent>
      </DropdownMenu> : null}
      <Tip label="Settle thread">
        <button
          type="button"
          data-no-drag=""
          aria-label={`Settle ${title}`}
          onClick={() => void commands.settle(threadId)}
          className={cn(ACTION, "hover:text-[color:var(--tg-unread)]")}
        >
          <Icon name="Check" aria-hidden className="size-3.5" />
        </button>
      </Tip>
    </span>
  );
}
