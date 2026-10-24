// The Children chip on a parent's card: how many direct children it has, up
// to three of their marks, the most urgent glyph in the whole subtree, and a
// chevron that opens or closes the child list under the card.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { chipMarkIds, chipTooltip } from "../../model/children-chip";
import type { ChildrenInfo } from "../../model/forest";
import { useCommands, useRowsOf, useSettings } from "../../store/hooks";
import { ChildMark } from "./ChildMark";
import { Tip } from "./Tip";
import { UrgencyGlyph } from "./UrgencyGlyph";

export function ChildrenChip({ parentId, info, expanded, className }: { parentId: string; info: ChildrenInfo; expanded: boolean; className?: string }) {
  const commands = useCommands();
  const { childIcon } = useSettings();
  const marks = useRowsOf(chipMarkIds(info.ids));
  const tooltip = chipTooltip(info.ids.length, info.counts);
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
        className={cn(
          "pointer-events-auto flex h-4 min-w-0 items-center gap-1 overflow-hidden rounded-md px-1 text-[10px] tabular-nums outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          className,
        )}
      >
        <span className="shrink-0">{info.ids.length}</span>
        <span className="flex min-w-0 items-center overflow-hidden -space-x-1">
          {marks.map((mark) => (
            <ChildMark key={mark.id} threadId={mark.id} providerId={mark.thread.providerId} style={childIcon} />
          ))}
        </span>
        {info.urgency === null ? null : <UrgencyGlyph urgency={info.urgency} />}
        <Icon name="ChevronRight" aria-hidden className={cn("size-3 shrink-0 transition-transform duration-150", expanded && "rotate-90")} />
      </button>
    </Tip>
  );
}
