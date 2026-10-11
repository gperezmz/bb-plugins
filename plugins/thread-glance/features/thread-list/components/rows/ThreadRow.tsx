// A thread's row. One memoized `ThreadRow` per thread id reads its own
// `RowView` from the store, so it renders when its thread's row changes and
// at no other time. It draws the row as a Full card, a Folded card or a Slim
// row, with the child lists under it.
import { memo, useEffect } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { isLastInputKeyboard } from "@/components/ui/overlay-trigger";
import { cn } from "@/lib/utils";
import { registerCard, useIsSweeping } from "../../commands/sweep";
import { cardHeight } from "../../model/layout";
import { stripeShown } from "../../model/project-colour";
import type { RowView } from "../../model/list-model";
import { ProjectStripe } from "../../project/ProjectMark";
import { useProjectColour } from "../../project/use-project-colour";
import { useProjectIds } from "../../project/use-project-ids";
import { useCommands, useHeights, useIsDragged, useIsRenaming, useProject, useRow, useSettings } from "../../store/hooks";
import { Cards } from "./cards";
import { setHoverCardOpen, useHoverCardOpen } from "./hover-state";
import { HoverBody } from "./HoverBody";
import { ChildList } from "./ChildList";
import { RowContextMenu } from "./RowMenu";
import { useSidebarThreadSplit } from "./use-split";

/**
 * A card calls this while it is on screen, so the Settle sweep plays on it
 * from whichever entry point settles the thread.
 */
export function useCardDrawn(threadId: string, drawn: boolean): void {
  useEffect(() => (drawn ? registerCard(threadId) : undefined), [threadId, drawn]);
}

export const ThreadRow = memo(function ThreadRow({ threadId }: { threadId: string }) {
  const row = useRow(threadId);
  // bb's drag-to-split hook runs once per render, even for a row that is gone.
  const split = useSidebarThreadSplit(threadId);
  useCardDrawn(threadId, row !== undefined);
  if (row === undefined) return null;
  return <RowBody row={row} split={split} />;
});

function RowBody({ row, split }: { row: RowView; split: ReturnType<typeof useSidebarThreadSplit> }) {
  const threadId = row.id;
  const commands = useCommands();
  const heights = useHeights();
  const editing = useIsRenaming(threadId);
  const dragged = useIsDragged(threadId);
  const sweeping = useIsSweeping(threadId);
  const hoverOpen = useHoverCardOpen(threadId);
  const { stripesIn } = useSettings();
  const project = useProject(row.thread.projectId);
  const projectIds = useProjectIds();
  const colour = useProjectColour(row.thread.projectId, projectIds);
  const stripe = colour !== null && stripeShown(stripesIn, row.card === "full" ? "full" : "collapsed") ? colour : null;
  const tinted = row.focused ? "tg-row-open" : row.openElsewhere ? "tg-row-elsewhere" : "";
  return (
    <div className="flex h-full min-w-0 flex-col">
      <RowContextMenu thread={row.thread} disabled={editing} dragging={dragged}>
        <HoverCard
          open={hoverOpen && !editing && !dragged}
          openDelay={250}
          closeDelay={300}
          onOpenChange={(open) => setHoverCardOpen(threadId, open)}
        >
          <div
            data-thread-id={threadId}
            data-card={row.card}
            data-shelf-of={row.shelf ?? undefined}
            data-focused={row.focused ? "" : undefined}
            data-open-elsewhere={row.openElsewhere ? "" : undefined}
            style={{ height: cardHeight(row.card, heights, row.grouped) }}
            className={cn("group/card relative flex min-w-0 flex-col justify-center overflow-hidden rounded-md px-2.5 text-sm", tinted, tinted === "" && "hover:bg-sidebar-accent/60")}
          >
            {sweeping ? <span aria-hidden data-sweep="" className="tg-sweep" /> : null}
            <ProjectStripe colour={stripe} />
            {editing ? null : (
              <HoverCardTrigger asChild>
                <a
                  href={row.thread.href}
                  {...split.splitProps}
                  data-sidebar-thread-shortcut-target=""
                  data-sidebar-thread-id={row.thread.id}
                  aria-label={row.thread.displayTitle}
                  aria-current={row.focused ? "page" : undefined}
                  draggable={false}
                  onFocus={(event) => {
                    // A click focuses the link too; only keyboard focus opens the card at once.
                    if (!isKeyboardFocus(event.currentTarget)) event.preventDefault();
                  }}
                  onClick={(event) => {
                    if (event.button !== 0 || event.altKey || event.shiftKey) return;
                    event.preventDefault();
                    if (event.detail > 1) return;
                    commands.open(threadId, { split: event.ctrlKey || event.metaKey });
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    commands.beginRename(threadId);
                  }}
                  className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
                />
              </HoverCardTrigger>
            )}
            <Cards row={row} editing={editing} projectName={project?.name ?? row.thread.projectId} colour={colour} />
          </div>
          <HoverCardContent side="right" align="start" className="w-64 p-3">
            <HoverBody row={row} />
          </HoverCardContent>
        </HoverCard>
      </RowContextMenu>
      <ChildList ids={row.shownChildIds} depth={0} parentProjectId={row.thread.projectId} />
    </div>
  );
}

function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return isLastInputKeyboard();
  }
}
