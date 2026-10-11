// The Children chip on a parent's card: how many direct children it has, up
// to three of their marks, the most urgent glyph in the whole subtree, and a
// chevron that opens or closes the child list under the card.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { chipMarkIds, chipTooltip, URGENCY_GLYPHS } from "../../model/children-chip";
import type { ChildrenInfo } from "../../model/forest";
import { useCommands, useRowsOf, useSettings } from "../../store/hooks";
import { ChildMark } from "./ChildMark";
import { Tip } from "./Tip";
import { TONE_CLASS } from "./StatusView";

export function ChildrenChip({ parentId, info, expanded }: { parentId: string; info: ChildrenInfo; expanded: boolean }) {
  const commands = useCommands();
  const { childIcon } = useSettings();
  const marks = useRowsOf(chipMarkIds(info.ids));
  const tooltip = chipTooltip(info.ids.length, info.counts);
  const urgency = info.urgency === null ? null : URGENCY_GLYPHS[info.urgency];
  return (
    <Tip label={tooltip}>
      <button
        type="button"
        data-no-drag=""
        data-children-chip=""
        aria-label={tooltip}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          commands.setExpanded(parentId, !expanded);
        }}
        className="pointer-events-auto flex h-4 shrink-0 items-center gap-1 rounded-md px-1 text-[10px] tabular-nums outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <span>{info.ids.length}</span>
        <span className="flex items-center -space-x-1">
          {marks.map((mark) => (
            <ChildMark key={mark.id} threadId={mark.id} providerId={mark.thread.providerId} style={childIcon} />
          ))}
        </span>
        {urgency === null ? null : urgency.icon === null ? (
          <span aria-hidden data-urgency="done" className={cn("inline-block size-[6px] rounded-full bg-current", TONE_CLASS[urgency.tone])} />
        ) : (
          <Icon
            name={urgency.icon}
            aria-hidden
            data-urgency={info.urgency ?? undefined}
            className={cn("size-3", TONE_CLASS[urgency.tone], urgency.tone === "working" && "animate-spin")}
          />
        )}
        <Icon name="ChevronRight" aria-hidden className={cn("size-3 transition-transform duration-150", expanded && "rotate-90")} />
      </button>
    </Tip>
  );
}
