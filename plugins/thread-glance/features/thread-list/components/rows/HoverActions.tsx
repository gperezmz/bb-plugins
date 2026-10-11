// The actions a card shows on hover in its Status slot while the thread is
// not busy and not woke: Snooze (a clock menu with the presets, "Pick date &
// time…" and Park) and Settle.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isBusy } from "@/shared/busy";
import { formatWakeTime, readSnoozePresets, snoozeChoices } from "@/shared/snooze";
import { requestSnoozePicker } from "../../commands/snooze-picker-request";
import type { RowView } from "../../model/list-model";
import { useCommands, useSettings } from "../../store/hooks";
import { Tip } from "./Tip";

/** Whether a card offers Snooze and Settle on hover: not busy and not woke. */
export function offersHoverActions(row: RowView): boolean {
  return row.woke === null && !isBusy(row.thread);
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

export function HoverActions({ threadId, title, className }: { threadId: string; title: string; className?: string }) {
  const commands = useCommands();
  return (
    <span data-hover-actions="" className={cn("flex items-center gap-0.5", className)}>
      <DropdownMenu>
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
      </DropdownMenu>
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
