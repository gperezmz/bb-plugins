/**
 * The composer chip: compaction only. An icon alone while compact-when-idle
 * is off, `≥ {line}` when on, `{m}m` while a compaction is due, `paused` on a
 * pending interaction. Clicking opens the popover.
 */
import { useState, type SyntheticEvent } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { chipSentence, chipText, type ThreadView } from "@/src/core/view";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { KEEPER_ICON, touches, useComposerThreadId, useKeeperRpc, useLive, useNow } from "../api";
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

export function Chip() {
  const threadId = useComposerThreadId();
  if (threadId === null) return null;
  return <ThreadChip threadId={threadId} />;
}

function ThreadChip({ threadId }: { threadId: string }) {
  const rpc = useKeeperRpc();
  const now = useNow();
  const [open, setOpen] = useState(false);
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
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground",
            view.compactOn && "text-foreground",
            view.compactionDue && "text-primary",
          )}
        >
          <Icon name={KEEPER_ICON} fallback="Archive" className="size-3.5" aria-hidden />
          {text !== "" && <span className="tabular-nums">{text}</span>}
        </button>
      </PopoverTrigger>
      {/* The popover is portaled out of the DOM, but React still bubbles its events to the
          composer around the chip, which takes focus on a click and so closes the popover. */}
      <PopoverContent align="end" className="w-[22rem]" {...CONTAIN}>
        <CompactPopover view={view} now={now} onChange={(next: ThreadView | null) => next !== null && live.setData(next)} />
      </PopoverContent>
    </Popover>
  );
}
