// The list below the edge: the project scope, then the upper group (Pinned,
// Active), a scene when nothing is there to do, and the lower group (Working,
// Inactive, Snoozed, Parked, Settled), which Dock shelves to the bottom sets
// at the bottom of the sidebar's viewport.
import { memo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCommands, useLowerItems, useListStatus, useScene, useSettings, useUpperItems } from "../store/hooks";
import { Announcer } from "./Announcer";
import { ItemList } from "./ItemList";
import { useJumpHints } from "./rows/jump-hints";
import { ProjectScope } from "./ProjectScope";
import { useReorderDrag } from "./reorder/use-reorder-drag";
import { Scroller } from "./Scroller";
import { AllClearScene, ErrorState, LoadingState, WorkingScene } from "./States";

export const ListBody = memo(function ListBody({ onRetry }: { onRetry(): void }) {
  const status = useListStatus();
  if (status === "error") return <ErrorState onRetry={onRetry} />;
  if (status === "loading") return <LoadingState />;
  return <ReadyList />;
});

function ReadyList() {
  const root = useRef<HTMLDivElement>(null);
  const upper = useUpperItems();
  const lower = useLowerItems();
  const scene = useScene();
  const { dockShelves } = useSettings();
  const commands = useCommands();
  useReorderDrag(root);
  useJumpHints(root);
  // Alt+Arrow Up or Down moves the row (or group) under focus one slot.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const unit = (event.target as Element).closest<HTMLElement>("[data-row-id],[data-group-key]");
    const key = unit?.dataset.rowId ?? unit?.dataset.groupKey;
    if (key === undefined) return;
    event.preventDefault();
    commands.moveByKey(key, event.key === "ArrowUp" ? -1 : 1);
  };

  const upperList = (
    <>
      {scene === "all-clear" ? <AllClearScene /> : scene === "working" ? <WorkingScene /> : null}
      {upper.length > 0 ? <ItemList items={upper} jumps /> : null}
    </>
  );
  const lowerList = lower.length > 0 ? <ItemList items={lower} jumps={false} /> : null;

  return (
    <div ref={root} onKeyDown={onKeyDown} data-list-ready="" data-dock={dockShelves ? "bottom" : undefined} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ProjectScope />
      <Announcer />
      {dockShelves ? (
        <>
          <Scroller label="upper" className="flex-1 px-1.5">
            {upperList}
          </Scroller>
          {lowerList !== null ? (
            <Scroller label="lower" className={cn("max-h-1/2 shrink-0 px-1.5 pb-2")}>
              {lowerList}
            </Scroller>
          ) : null}
        </>
      ) : (
        <Scroller label="list" className="flex-1 px-1.5 pb-2">
          {upperList}
          {lowerList !== null ? <div className={cn((upper.length > 0 || scene !== null) && "pt-2")}>{lowerList}</div> : null}
        </Scroller>
      )}
    </div>
  );
}
