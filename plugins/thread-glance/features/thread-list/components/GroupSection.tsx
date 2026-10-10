// A top-level group: its sticky header with counters, always mounted, and
// the rows the list has mounted, each run of the rest standing in as one
// spacer of their height that carries their threads for bb's navigation.
import { memo, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import type { Counters } from "../model/counters";
import { canRename, type GroupDescriptor } from "../model/groups";
import { rowHeight } from "../model/heights";
import { drawsEmpty } from "../model/layout-items";
import type { Row } from "../model/view";
import { windowedNavValue, type NavTarget } from "../model/windowing";
import {
  useCommands,
  useGroup,
  useGroupMenuOpen,
  useHoldsFocus,
  useIsGroupDragged,
  useIsGroupDropTarget,
  useLayout,
  useRenaming,
} from "../store/hooks";
import { EnvironmentRowView, OlderRowView, SettledRowView } from "./FoldRows";
import { CounterStrip } from "./glyphs";
import { RenameEditor } from "./RenameEditor";
import { HEADER_HOVER_HIDES, HEADER_HOVER_SHOWS } from "./input-modality";
import { menuTriggerProps } from "./overlays/trigger";
import { GROUP_GAP } from "./row-heights";
import { ROW_ICON_BUTTON, ThreadRowView } from "./ThreadRowView";

/** What the inline rename box of each renamable group is called. */
const RENAME_LABEL: Partial<Record<GroupDescriptor["kind"], string>> = {
  project: "Project name",
  section: "Section name",
  machine: "Machine name",
};

/** A group's header: its label, counters, `+` and its "…". It reads only what it draws. */
const GroupHeader = memo(function GroupHeader({
  descriptor,
  counters,
  collapsed,
  inOverflow,
}: {
  descriptor: GroupDescriptor;
  /** The counters it draws, the same object while they hold. */
  counters: Counters;
  collapsed: boolean;
  inOverflow: boolean;
}) {
  const commands = useCommands();
  const { compact } = useLayout();
  const dropActive = useIsGroupDropTarget(descriptor.id);
  const dragged = useIsGroupDragged(descriptor.id);
  const menuOpen = useGroupMenuOpen(descriptor.id);
  const renaming = useRenaming(descriptor.id, null);
  // On phones only the group holding the focused thread shows `+`.
  const holdsActive = useHoldsFocus(descriptor.id);
  const groupId = descriptor.id;
  const label = descriptor.label;
  const trigger = menuTriggerProps(menuOpen, compact, (anchor) => commands.openMenu({ kind: "group", groupId, anchor }), commands.closeMenu);
  // Desktop: the counter sits flush right, and "+" and "…" fade in over its
  // place on hover or keyboard focus, as a row's actions fade over its age. Nothing is
  // kept for them otherwise. Phones keep them in line, always shown.
  const counterFade = compact ? "" : menuOpen ? "opacity-0" : HEADER_HOVER_HIDES;
  const actionsFade = compact
    ? ""
    : cn("absolute top-1/2 right-0 -translate-y-1/2 pl-1", dropActive ? "bg-sidebar-accent" : "bg-sidebar", menuOpen ? "opacity-100" : HEADER_HOVER_SHOWS);
  return (
    <div
      data-sidebar="group-label"
      data-drag-group={compact || inOverflow || renaming ? undefined : groupId}
      className={cn(
        "group/header sticky top-0 z-20 flex items-center gap-1 rounded-md bg-sidebar pl-2 pr-1 text-xs text-muted-foreground",
        compact ? "h-9" : "h-7",
        dropActive && "bg-sidebar-accent",
        dragged && "opacity-50",
        !compact && !inOverflow && "select-none",
      )}
    >
      {renaming ? (
        <RenameEditor
          initial={label}
          label={RENAME_LABEL[descriptor.kind] ?? "Group name"}
          onSave={(name) => commands.renameGroup(groupId, name)}
          onDone={commands.endRename}
          className="text-xs"
        />
      ) : (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} section`}
          onClick={() => commands.toggleGroup(groupId)}
          onDoubleClick={() => canRename(descriptor) && commands.startRename(groupId, null)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <Icon
            name={ICONS.expand}
            aria-hidden
            className={cn("size-3 shrink-0 transition-transform duration-150", !collapsed && "rotate-90")}
          />
        </button>
      )}
      {!renaming ? (
        <span className="relative ml-auto flex shrink-0 items-center">
          <CounterStrip counters={counters} className={cn("transition-opacity", counterFade)} />
          <span className={cn("flex items-center transition-opacity", actionsFade)}>
            {!compact || holdsActive ? (
              <button
                type="button"
                aria-label={`New thread in ${label}`}
                title={`New thread in ${label}`}
                data-sidebar-hover-actions-mobile={compact ? "always" : undefined}
                data-no-drag=""
                className={ROW_ICON_BUTTON}
                onClick={() => commands.newThreadInGroup(groupId)}
              >
                <Icon name={ICONS.newThread} aria-hidden className="size-4" />
              </button>
            ) : null}
            <button type="button" aria-label={`${label} actions`} {...trigger} className={ROW_ICON_BUTTON}>
              <Icon name={ICONS.more} aria-hidden className="size-4" />
            </button>
          </span>
        </span>
      ) : null}
    </div>
  );
});

/** A run of rows that are not mounted: as tall as they are, naming their threads in order. */
function Spacer({ height, nav }: { height: number; nav: readonly NavTarget[] }) {
  return (
    <div
      aria-hidden
      data-sidebar-windowed-nav={nav.length === 0 ? undefined : windowedNavValue(nav)}
      style={{ height }}
    />
  );
}

/** A row's own view, memoized, so a group's render draws only the rows that changed. */
function rowView(row: Row, groupId: string): ReactNode {
  switch (row.type) {
    case "thread":
      return <ThreadRowView key={row.key} row={row} groupId={groupId} />;
    case "older":
      return <OlderRowView key={row.key} row={row} />;
    case "settled":
      return <SettledRowView key={row.key} row={row} />;
    case "environment":
      return <EnvironmentRowView key={row.key} row={row} groupId={groupId} />;
  }
}

/**
 * A top-level group by id: it renders when its own part of the list model,
 * or the rows the list mounts in it, change.
 */
export const GroupSection = memo(function GroupSection({
  groupId,
  inOverflow = false,
  gapAbove,
  mounted,
}: {
  groupId: string;
  inOverflow?: boolean;
  /** Every group but the first shown gets space above its header. */
  gapAbove: boolean;
  /** The keys of its rows the list has mounted. */
  mounted: ReadonlySet<string>;
}) {
  const group = useGroup(groupId);
  const { density, compact } = useLayout();
  if (group === undefined) return null;
  const descriptor = group.descriptor;
  const content: ReactNode[] = [];
  let spacer = { height: 0, nav: [] as NavTarget[], key: "" };
  const flush = () => {
    if (spacer.height === 0) return;
    content.push(<Spacer key={`spacer:${spacer.key}`} height={spacer.height} nav={spacer.nav} />);
    spacer = { height: 0, nav: [], key: "" };
  };
  for (const row of group.rows) {
    if (mounted.has(row.key)) {
      flush();
      content.push(rowView(row, groupId));
      continue;
    }
    if (spacer.height === 0) spacer.key = row.key;
    spacer.height += rowHeight(row, { density, compact });
    if (row.type === "thread") spacer.nav.push({ threadId: row.info.thread.id, projectId: row.projectId });
  }
  flush();
  return (
    <section
      aria-label={descriptor.label}
      data-sidebar-visibility-group={descriptor.id}
      data-sidebar-section-id={descriptor.kind === "section" ? descriptor.entityId ?? undefined : undefined}
      className={cn("relative flex w-full min-w-0 flex-col", gapAbove && GROUP_GAP[density])}
    >
      <GroupHeader descriptor={descriptor} counters={group.headerCounters} collapsed={group.collapsed} inOverflow={inOverflow} />
      {drawsEmpty(group) ? (
        <p className="h-6 py-1 pl-8 text-xs text-muted-foreground">
          No threads
        </p>
      ) : group.rows.length > 0 ? (
        <div data-sidebar="group-content" className="flex w-full flex-col text-sm">
          {content}
        </div>
      ) : null}
    </section>
  );
});
