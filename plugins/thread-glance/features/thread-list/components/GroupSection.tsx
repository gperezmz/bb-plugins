// A top-level group: its header with counters, and its rows, windowed
// in chunks.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import type { Counters } from "../model/counters";
import type { GroupDescriptor } from "../model/groups";
import type { Row } from "../model/view";
import { chunk, windowedNavValue } from "../model/windowing";
import { useCommands, useEditingId, useFocusedThreadId, useGroup, useHoldsFocus, useIsGroupDropTarget, useLayout, useShowArchived } from "../store/hooks";
import { EnvironmentRowView, OlderRowView, SettledRowView } from "./FoldRows";
import { CounterStrip } from "./glyphs";
import { EMPTY_COUNTERS, visibleCounters } from "../model/counters";
import { RenameEditor } from "./RenameEditor";
import { HEADER_HOVER_HIDES, HEADER_HOVER_SHOWS } from "./input-modality";
import { ESTIMATED_ROW_HEIGHT, GROUP_GAP } from "./row-heights";
import { ROW_ICON_BUTTON, ThreadRowView } from "./ThreadRowView";

function canRename(descriptor: GroupDescriptor): boolean {
  return descriptor.kind === "section" || descriptor.kind === "machine";
}

/** A group's header: its label, counters, `+` and its menu. It reads only what it draws. */
/**
 * A group header's menu items. Mounted only while the menu is open, they
 * read what only the menu draws, so the header does not render for it.
 */
function GroupMenuItems({ descriptor, onRename }: { descriptor: GroupDescriptor; onRename(): void }) {
  const commands = useCommands();
  const group = useGroup(descriptor.id);
  const { mode } = useLayout();
  const showArchived = useShowArchived();
  const groupId = descriptor.id;
  const hasUnread = group?.hasUnread ?? false;
  const hidden = group?.hidden ?? false;
  const canCreateSections = mode === "chronological";
  return (
    <>
      {hasUnread ? (
        <DropdownMenuItem onSelect={() => commands.markGroupRead(groupId)}>
          <Icon name={ICONS.markRead} aria-hidden className="size-4" />
          Mark all read
        </DropdownMenuItem>
      ) : null}
      {descriptor.kind !== "pinned" && descriptor.newThreadProjectId !== null ? (
        <DropdownMenuItem onSelect={() => commands.newThreadInGroup(groupId)}>
          <Icon name={ICONS.newThread} aria-hidden className="size-4" />
          New thread
        </DropdownMenuItem>
      ) : null}
      {canCreateSections ? (
        <DropdownMenuItem onSelect={() => commands.setNewSectionOpen(true)}>
          <Icon name={ICONS.newSection} aria-hidden className="size-4" />
          New section
        </DropdownMenuItem>
      ) : null}
      {canRename(descriptor) ? (
        <DropdownMenuItem onSelect={onRename}>
          <Icon name={ICONS.rename} aria-hidden className="size-4" />
          Rename
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {descriptor.kind !== "pinned" ? (
        hidden ? (
          <DropdownMenuItem onSelect={() => commands.showGroup(groupId)}>
            <Icon name={ICONS.show} aria-hidden className="size-4" />
            Show in list
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => commands.hideGroup(groupId)}>
            <Icon name={ICONS.hidden} aria-hidden className="size-4" />
            Hide from list
          </DropdownMenuItem>
        )
      ) : null}
      <DropdownMenuItem onSelect={() => commands.toggleArchived()}>
        <Icon name={showArchived ? ICONS.check : ICONS.archive} aria-hidden className="size-4" />
        Show archived threads
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => commands.setCustomizeOpen(true)}>
        <Icon name={ICONS.customize} aria-hidden className="size-4" />
        Customize list
      </DropdownMenuItem>
      {descriptor.kind === "section" ? (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => commands.removeSection(groupId)}
        >
          <Icon name={ICONS.remove} aria-hidden className="size-4" />
          Remove section
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

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
  // On phones only the group holding the focused thread shows `+`.
  const holdsActive = useHoldsFocus(descriptor.id);
  const groupId = descriptor.id;
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const label = descriptor.label;
  const draggable = useDraggable({
    id: `group:${groupId}`,
    data: { kind: "group", groupId },
    disabled: compact || inOverflow || renaming,
  });
  // Desktop: the counter sits flush right, and "+" and "…" fade in over its
  // place on hover or keyboard focus, as a row's actions fade over its age. Nothing is
  // kept for them otherwise. Phones keep them in line, always shown.
  const counterFade = compact
    ? ""
    : menuOpen
      ? "opacity-0"
      : HEADER_HOVER_HIDES;
  const actionsFade = compact
    ? ""
    : cn(
        "absolute top-1/2 right-0 -translate-y-1/2 pl-1",
        dropActive ? "bg-sidebar-accent" : "bg-sidebar",
        menuOpen
          ? "opacity-100"
          : HEADER_HOVER_SHOWS,
      );
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      role={undefined}
      tabIndex={undefined}
      data-sidebar="group-label"
      className={cn(
        "group/header sticky top-0 z-20 flex h-7 items-center gap-1 rounded-md bg-sidebar pl-2 pr-1 text-xs text-muted-foreground max-md:pointer-coarse:h-9",
        dropActive && "bg-sidebar-accent",
        draggable.isDragging && "opacity-50",
        !compact && !inOverflow && "select-none",
      )}
    >
      {renaming ? (
        <RenameEditor
          initial={label}
          label={descriptor.kind === "section" ? "Section name" : "Machine name"}
          onSave={(name) => commands.renameGroup(groupId, name)}
          onDone={() => setRenaming(false)}
          className="text-xs"
        />
      ) : (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} section`}
          onClick={() => commands.toggleGroup(groupId)}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={() => canRename(descriptor) && setRenaming(true)}
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
          <CounterStrip
            counters={counters}
            className={cn("transition-opacity", counterFade)}
          />
          <span className={cn("flex items-center transition-opacity", actionsFade)}>
            {descriptor.kind !== "pinned" &&
            (descriptor.newThreadProjectId !== null || descriptor.kind === "machine") &&
            (!compact || holdsActive) ? (
              <button
                type="button"
                aria-label={`New thread in ${label}`}
                title={`New thread in ${label}`}
                data-sidebar-hover-actions-mobile={compact ? "always" : undefined}
                className={ROW_ICON_BUTTON}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => commands.newThreadInGroup(groupId)}
              >
                <Icon name={ICONS.newThread} aria-hidden className="size-4" />
              </button>
            ) : null}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${label} actions`}
                  className={ROW_ICON_BUTTON}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Icon name={ICONS.more} aria-hidden className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <GroupMenuItems descriptor={descriptor} onRename={() => setRenaming(true)} />
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>
      ) : null}
    </div>
  );
});

function rowKey(row: Row): string {
  return row.key;
}

interface ChunkProps {
  rows: readonly Row[];
  groupId: string;
  inPinned: boolean;
  forceMount: boolean;
  rowHeight: number;
}

/** The same rows, by identity, with the same settings: a chunk renders nothing new. */
function sameChunk(previous: ChunkProps, next: ChunkProps): boolean {
  return (
    previous.groupId === next.groupId &&
    previous.inPinned === next.inPinned &&
    previous.forceMount === next.forceMount &&
    previous.rowHeight === next.rowHeight &&
    previous.rows.length === next.rows.length &&
    previous.rows.every((row, index) => row === next.rows[index])
  );
}

/**
 * Mounts its rows while near the viewport; otherwise a sized placeholder.
 * It renders only when one of its rows or settings changes, so a group
 * drawing one changed row leaves every other chunk alone.
 */
const WindowedChunk = memo(function WindowedChunk({ rows, groupId, inPinned, forceMount, rowHeight }: ChunkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const measured = useRef<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting === false && node.firstElementChild !== null && visible) {
            measured.current = node.getBoundingClientRect().height;
          }
          setVisible(entry.isIntersecting);
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  const mounted = visible || forceMount;
  const nav = rows
    .filter((row) => row.type === "thread")
    .map((row) => ({ threadId: row.info.thread.id, projectId: row.projectId }));
  return (
    <div
      ref={ref}
      data-sidebar-windowed-item=""
      data-sidebar-windowed-nav={mounted || nav.length === 0 ? undefined : windowedNavValue(nav)}
      style={mounted ? undefined : { height: measured.current ?? rows.length * rowHeight }}
    >
      {mounted
        ? rows.map((row) =>
            row.type === "thread" ? (
              <ThreadRowView key={row.key} row={row} groupId={groupId} inPinned={inPinned} />
            ) : row.type === "older" ? (
              <OlderRowView key={row.key} row={row} />
            ) : row.type === "settled" ? (
              <SettledRowView key={row.key} row={row} />
            ) : (
              <EnvironmentRowView key={row.key} row={row} />
            ),
          )
        : null}
    </div>
  );
}, sameChunk);

interface RowsProps {
  rows: readonly Row[];
  /** The group the rows are drawn in, for drag ids. */
  groupId: string;
  inPinned: boolean;
  /** Mount every chunk, whatever is on screen (the More popover). */
  forceMount: boolean;
}

/** A group's rows, windowed in chunks. */
function Rows({ rows: all, groupId, inPinned, forceMount }: RowsProps) {
  const { density, branchLine } = useLayout();
  const activeThreadId = useFocusedThreadId();
  const editingId = useEditingId();
  // A chunk measured under another density or Branch line would keep that
  // height while off screen, so a change mounts every chunk afresh to measure.
  const layout = `${density}:${branchLine}`;
  return (
    <div data-sidebar="group-content" className="flex w-full flex-col text-sm">
      {chunk(all).map((rows) => (
        <WindowedChunk
          key={`${layout}:${rowKey(rows[0]!)}`}
          rows={rows}
          groupId={groupId}
          inPinned={inPinned}
          rowHeight={ESTIMATED_ROW_HEIGHT[density]}
          forceMount={
            forceMount ||
            rows.some(
              (row) =>
                row.type === "thread" &&
                (row.info.thread.id === activeThreadId || row.info.thread.id === editingId),
            )
          }
        />
      ))}
    </div>
  );
}

/** A top-level group by id: it renders when its own part of the list model changes. */
export const GroupSection = memo(function GroupSection({
  groupId,
  inOverflow = false,
  gapAbove,
}: {
  groupId: string;
  inOverflow?: boolean;
  /** Every group but the first shown gets space above its header. */
  gapAbove: boolean;
}) {
  const group = useGroup(groupId);
  const { density } = useLayout();
  // What the header draws of the counters: a count the rows already show
  // changing leaves the header as it is.
  const shown = visibleCounters(group?.counters ?? EMPTY_COUNTERS, { collapsed: group?.collapsed ?? false, more: false });
  const counters = useMemo(
    () => shown,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one object per drawn value
    [shown.waitsOnYou, shown.failed, shown.offline, shown.working, shown.unread],
  );
  const droppable = useDroppable({
    id: `drop-group:${groupId}`,
    data: { kind: "group", groupId },
  });
  if (group === undefined) return null;
  const descriptor = group.descriptor;
  return (
    <section
      ref={droppable.setNodeRef}
      aria-label={descriptor.label}
      data-sidebar-visibility-group={descriptor.id}
      data-sidebar-section-id={descriptor.kind === "section" ? descriptor.entityId ?? undefined : undefined}
      className={cn("relative flex w-full min-w-0 flex-col", gapAbove && GROUP_GAP[density])}
    >
      <GroupHeader
        descriptor={descriptor}
        counters={counters}
        collapsed={group.collapsed}
        inOverflow={inOverflow}
      />
      {group.rows.length === 0 ? (
        group.collapsed || group.rootIds.length > 0 ? null : <p className="py-1 pl-8 text-xs text-muted-foreground">No threads</p>
      ) : (
        <Rows rows={group.rows} groupId={descriptor.id} inPinned={descriptor.id === "pinned"} forceMount={inOverflow} />
      )}
    </section>
  );
});
