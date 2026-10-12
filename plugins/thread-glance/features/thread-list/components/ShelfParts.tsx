// The list's non-row items: a shelf's header, a Project-mode group's header
// and "Load N more". Each is sized by the item's height in the layout.
import { memo } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { SHELF_ICONS, SHELF_NAMES } from "../icons";
import { CLEAN_BUTTON_LABEL, CLEAN_BUTTON_TIP } from "../model/clean";
import type { ListItem } from "../model/list-model";
import { stripeShown } from "../model/project-colour";
import { ProjectMark, ProjectName, ProjectStripe } from "../project/ProjectMark";
import { useProjectColour } from "../project/use-project-colour";
import { useProjectIds } from "../project/use-project-ids";
import { ACTIVE_SORT_LABELS, ACTIVE_SORTS, type ActiveSort } from "../storage/device-state";
import { useActiveSort, useCommands, useIsDragged, useProject, useSettings } from "../store/hooks";
import { Tip } from "./rows/Tip";

type ShelfItem = Extract<ListItem, { kind: "shelf" }>;
type GroupItem = Extract<ListItem, { kind: "group" }>;
type MoreItem = Extract<ListItem, { kind: "more" }>;

/** Active's sort select: highlighted while the sort is not Manual order. */
function ActiveSortSelect() {
  const sort = useActiveSort();
  const commands = useCommands();
  return (
    <select
      aria-label="Sort Active"
      value={sort}
      data-no-drag=""
      data-sorted={sort !== "manual" ? "" : undefined}
      onChange={(event) => commands.setActiveSort(event.target.value as ActiveSort)}
      className={cn(
        "h-6 max-w-28 cursor-pointer rounded-md border-0 bg-transparent px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        sort === "manual" ? "text-muted-foreground" : "bg-sidebar-accent text-foreground",
      )}
    >
      {ACTIVE_SORTS.map((candidate) => (
        <option key={candidate} value={candidate}>
          {ACTIVE_SORT_LABELS[candidate]}
        </option>
      ))}
    </select>
  );
}

/** Settled's Clean button, a broom, which opens the dialog that closes the terminals and ports of settled threads. Shown while the shelf is collapsed too. */
function CleanButton() {
  const commands = useCommands();
  return (
    <Tip label={CLEAN_BUTTON_TIP}>
      <button
        type="button"
        data-no-drag=""
        aria-label={CLEAN_BUTTON_LABEL}
        onClick={() => commands.openClean()}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Icon name="thread-glance-clean" aria-hidden className="size-3.5" />
      </button>
    </Tip>
  );
}

/** A shelf's header: its icon and name, "Name (count)" while collapsed, Active's sort and Settled's Clean. */
export const ShelfHeader = memo(function ShelfHeader({ item, gap, size }: { item: ShelfItem; gap: number; size: number }) {
  const commands = useCommands();
  const name = SHELF_NAMES[item.shelf];
  const label = item.collapsed ? `${name} (${item.count})` : name;
  // Working's icon spins while the shelf has work, whatever the motion setting.
  return (
    <div data-shelf={item.shelf} style={{ height: size, paddingTop: gap }} className="flex items-center gap-1 pl-1 pr-1 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={!item.collapsed}
        onClick={() => commands.toggleShelf(item.shelf)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Icon name={SHELF_ICONS[item.shelf]} aria-hidden className={cn("size-3.5 shrink-0", item.spinning && "animate-spin")} />
        <span className="min-w-0 truncate">{label}</span>
        <Icon name="ChevronRight" aria-hidden className={cn("size-3 shrink-0 transition-transform duration-150", !item.collapsed && "rotate-90")} />
      </button>
      {item.shelf === "active" && !item.collapsed ? <ActiveSortSelect /> : null}
      {item.shelf === "settled" ? <CleanButton /> : null}
    </div>
  );
});

/** A Project-mode group's header: the project's name, its count and a chevron. The header moves as a unit. */
export const GroupHeader = memo(function GroupHeader({ item, size }: { item: GroupItem; size: number }) {
  const commands = useCommands();
  const { stripesIn } = useSettings();
  const project = useProject(item.projectId);
  const dragged = useIsDragged(item.key);
  const name = project?.name ?? item.projectId;
  const projectIds = useProjectIds();
  const colour = useProjectColour(item.projectId, projectIds);
  return (
    <div
      data-group-key={item.key}
      style={{ height: size }}
      className={cn("relative flex items-center gap-1 rounded-md pl-2 pr-1 text-xs text-muted-foreground select-none", dragged && "opacity-60")}
    >
      <ProjectStripe colour={colour !== null && stripeShown(stripesIn, "group") ? colour : null} />
      <button
        type="button"
        aria-expanded={!item.collapsed}
        aria-label={`${item.collapsed ? "Expand" : "Collapse"} ${name} group`}
        onClick={() => commands.setGroupCollapsed(item.projectId, !item.collapsed)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <ProjectMark projectId={item.projectId} name={name} colour={colour} className="size-3" />
        <ProjectName name={name} colour={colour} className="min-w-0 truncate font-medium" />
        <span className="shrink-0 tabular-nums">{item.count}</span>
        <Icon name="ChevronRight" aria-hidden className={cn("size-3 shrink-0 transition-transform duration-150", !item.collapsed && "rotate-90")} />
      </button>
    </div>
  );
});

/** Settled's "Load N more". */
export const LoadMore = memo(function LoadMore({ item, size }: { item: MoreItem; size: number }) {
  const commands = useCommands();
  return (
    <div style={{ height: size }} className="flex items-center pl-2">
      <button
        type="button"
        onClick={() => commands.loadMoreSettled()}
        className="h-6 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        Load {item.next} more
      </button>
    </div>
  );
});
