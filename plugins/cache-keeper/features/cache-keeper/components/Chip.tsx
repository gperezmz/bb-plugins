/**
 * The composer chip. Its text is compaction's: nothing while compact-when-idle
 * is off, `≥ {line}` when on, `{m}m` while a compaction is due, `paused` on a
 * pending interaction. Its icon is the timer, or while the thread waits, the
 * flame or the crossed-out flame. Clicking opens the popover, which puts focus
 * on its first control only when opened from the keyboard.
 */
import { useRef, useState, type SyntheticEvent } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { chipIcon, chipSentence, chipText, type ChipIcon, type ThreadView } from "@/src/core/view";
import { buttonVariants } from "@/components/ui/button";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CROSSED_OUT_FLAME_ICON, FLAME_ICON, TIMER_ICON, touches, useComposerThreadId, useKeeperRpc, useLive, useNow } from "../api";
import { focusOnOpen, type OpenedWith } from "../model/focus";
import { CompactPopover } from "./CompactPopover";

const stop = (e: SyntheticEvent) => e.stopPropagation();
const CONTAIN = {
  onPointerDown: stop,
  onPointerUp: stop,
  onPointerMove: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onClick: stop,
  onKeyDown: stop,
  onFocus: stop,
  onBlur: stop,
} as const;

const ICONS: Record<ChipIcon, string> = { timer: TIMER_ICON, flame: FLAME_ICON, "crossed-out-flame": CROSSED_OUT_FLAME_ICON };

export function Chip() {
  const threadId = useComposerThreadId();
  if (threadId === null) return null;
  return <ThreadChip threadId={threadId} />;
}

function ThreadChip({ threadId }: { threadId: string }) {
  const rpc = useKeeperRpc();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const openedWith = useRef<OpenedWith>("keyboard");
  const content = useRef<HTMLDivElement>(null);
  const live = useLive(() => rpc.call("view", { threadId }), [rpc, threadId], (p) => touches(p, [threadId]));
  const view = live.data;
  if (view === null || !view.eligible) return null;
  const text = chipText(view, now);
  const sentence = chipSentence(view, now);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Cache Keeper: ${sentence}`}
          title={sentence}
          onPointerDown={() => (openedWith.current = "pointer")}
          onKeyDown={() => (openedWith.current = "keyboard")}
          className={cn(
            buttonVariants({ variant: "ghost", size: null }),
            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
            "gap-1.5 text-[13px] text-foreground",
            view.compactionDue && "text-primary data-[state=open]:text-primary",
          )}
        >
          <Icon name={ICONS[chipIcon(view)]} fallback="Archive" className="size-4" aria-hidden />
          {text !== "" && <span className="tabular-nums">{text}</span>}
        </button>
      </PopoverTrigger>
      {/* The popover is portaled out of the DOM, but React still bubbles its events to the
          composer around the chip, which takes focus on a click and so closes the popover. */}
      <PopoverContent
        ref={content}
        align="end"
        className="w-[22rem]"
        onOpenAutoFocus={(event) => {
          if (focusOnOpen(openedWith.current) === "first control") return;
          event.preventDefault();
          content.current?.focus();
        }}
        {...CONTAIN}
      >
        <CompactPopover view={view} now={now} onChange={(next: ThreadView | null) => next !== null && live.setData(next)} />
      </PopoverContent>
    </Popover>
  );
}
