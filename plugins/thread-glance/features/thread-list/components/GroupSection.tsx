// A top-level group: its header with counters, and its rows, windowed
// in chunks.
import { memo, useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk/app";
import type { Stamps } from "@/shared/contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import type { GroupView, Row } from "../model/view";
import { chunk, windowedNavValue } from "../model/windowing";
import type { RowController } from "./controller";
import { EmptyRowView, EnvironmentRowView, OlderRowView } from "./FoldRows";
import { CounterStrip } from "./glyphs";
import { visibleCounters } from "../model/counters";
import { RenameEditor } from "./RenameEditor";
import { ROW_ICON_BUTTON, ThreadRowView } from "./ThreadRowView";

export interface GroupController {
  compact: boolean;
  /** The group holding the active thread: on phones only it shows `+`. */
  activeGroupId: string | null;
  showArchived: boolean;
  onToggleArchived(): void;
  canCreateSections: boolean;
  onToggleCollapse(group: GroupView): void;
  onNewThread(group: GroupView): void;
  onHide(group: GroupView): void;
  onShow(group: GroupView): void;
  onCustomize(): void;
  onRename(group: GroupView, name: string): Promise<void>;
  onRemove(group: GroupView): void;
  onMarkAllRead(group: GroupView): void;
  onNewSection(): void;
}

export type DropStates = ReadonlyMap<string, "valid" | "blocked" | "unchanged" | "before" | "after">;

/** The sticky toolbar's height; headers stick below it. */
export const TOOLBAR_HEIGHT = 32;
const ROW_HEIGHT = { compact: 28, comfortable: 44 };

function canRename(group: GroupView): boolean {
  return group.descriptor.kind === "section" || group.descriptor.kind === "machine";
}

const GroupHeader = memo(function GroupHeader({
  group,
  controller,
  inOverflow,
  dropActive,
}: {
  group: GroupView;
  controller: GroupController;
  inOverflow: boolean;
  dropActive: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const label = group.descriptor.label;
  const draggable = useDraggable({
    id: `group:${group.descriptor.id}`,
    data: { kind: "group", groupId: group.descriptor.id },
    disabled: controller.compact || inOverflow || renaming,
  });
  const actionsClass = controller.compact
    ? ""
    : "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100";
  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      role={undefined}
      tabIndex={undefined}
      data-sidebar="group-label"
      style={{ top: inOverflow ? 0 : TOOLBAR_HEIGHT }}
      className={cn(
        "group/header sticky z-20 flex h-7 items-center gap-1 rounded-md bg-sidebar pl-2 pr-1 text-xs text-muted-foreground max-md:pointer-coarse:h-9",
        dropActive && "bg-sidebar-accent",
        draggable.isDragging && "opacity-50",
        !controller.compact && !inOverflow && "select-none",
      )}
    >
      {renaming ? (
        <RenameEditor
          initial={label}
          label={group.descriptor.kind === "section" ? "Section name" : "Machine name"}
          onSave={(name) => controller.onRename(group, name)}
          onDone={() => setRenaming(false)}
          className="text-xs"
        />
      ) : (
        <button
          type="button"
          aria-expanded={!group.collapsed}
          aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${label} section`}
          onClick={() => controller.onToggleCollapse(group)}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={() => canRename(group) && setRenaming(true)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <Icon
            name={ICONS.expand}
            aria-hidden
            className={cn("size-3 shrink-0 transition-transform duration-150", !group.collapsed && "rotate-90")}
          />
        </button>
      )}
      {!renaming ? (
        <CounterStrip
          counters={visibleCounters(group.counters, { collapsed: group.collapsed, more: false })}
          className="ml-auto"
        />
      ) : null}
      {!renaming &&
      group.descriptor.kind !== "pinned" &&
      (group.descriptor.newThreadProjectId !== null || group.descriptor.kind === "machine") &&
      (!controller.compact || controller.activeGroupId === group.descriptor.id) ? (
        <button
          type="button"
          aria-label={`New thread in ${label}`}
          title={`New thread in ${label}`}
          data-sidebar-hover-actions-mobile={controller.compact ? "always" : undefined}
          className={cn(ROW_ICON_BUTTON, actionsClass)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => controller.onNewThread(group)}
        >
          <Icon name={ICONS.newThread} aria-hidden className="size-4" />
        </button>
      ) : !renaming && !controller.compact ? (
        // Keeps every header's counters on one edge.
        <span aria-hidden className="size-6 shrink-0" />
      ) : null}
      {!renaming ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label} actions`}
              className={cn(ROW_ICON_BUTTON, actionsClass)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Icon name={ICONS.more} aria-hidden className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onSelect={() => controller.onMarkAllRead(group)}>
              <Icon name={ICONS.markRead} aria-hidden className="size-4" />
              Mark all read
            </DropdownMenuItem>
            {group.descriptor.kind !== "pinned" && group.descriptor.newThreadProjectId !== null ? (
              <DropdownMenuItem onSelect={() => controller.onNewThread(group)}>
                <Icon name={ICONS.newThread} aria-hidden className="size-4" />
                New thread
              </DropdownMenuItem>
            ) : null}
            {controller.canCreateSections ? (
              <DropdownMenuItem onSelect={() => controller.onNewSection()}>
                <Icon name={ICONS.newSection} aria-hidden className="size-4" />
                New section
              </DropdownMenuItem>
            ) : null}
            {canRename(group) ? (
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Icon name={ICONS.rename} aria-hidden className="size-4" />
                Rename
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {group.descriptor.kind !== "pinned" ? (
              group.hidden ? (
                <DropdownMenuItem onSelect={() => controller.onShow(group)}>
                  <Icon name={ICONS.show} aria-hidden className="size-4" />
                  Show in list
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => controller.onHide(group)}>
                  <Icon name={ICONS.hidden} aria-hidden className="size-4" />
                  Hide from list
                </DropdownMenuItem>
              )
            ) : null}
            <DropdownMenuItem onSelect={() => controller.onToggleArchived()}>
              <Icon name={controller.showArchived ? ICONS.check : ICONS.archive} aria-hidden className="size-4" />
              Show archived threads
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => controller.onCustomize()}>
              <Icon name={ICONS.customize} aria-hidden className="size-4" />
              Customize list
            </DropdownMenuItem>
            {group.descriptor.kind === "section" ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => controller.onRemove(group)}
              >
                <Icon name={ICONS.remove} aria-hidden className="size-4" />
                Remove section
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
});

function rowKey(row: Row): string {
  return row.key;
}

/** Mounts its rows while near the viewport; otherwise a sized placeholder. */
function WindowedChunk({
  rows,
  forceMount,
  rowHeight,
  children,
}: {
  rows: readonly Row[];
  forceMount: boolean;
  rowHeight: number;
  children: React.ReactNode;
}) {
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
      {mounted ? children : null}
    </div>
  );
}

export const GroupSection = memo(function GroupSection({
  group,
  rowController,
  groupController,
  environmentProviders,
  dropStates,
  dropTargetGroupId,
  activeThreadId,
  editingId,
  now,
  stamps,
  inOverflow = false,
}: {
  group: GroupView;
  rowController: RowController;
  groupController: GroupController;
  environmentProviders: readonly PluginEnvironmentProvider[];
  dropStates: DropStates;
  dropTargetGroupId: string | null;
  activeThreadId: string | null;
  editingId: string | null;
  now: number;
  /** Rows get their own stamps as props, so a stamp renders one row. */
  stamps: Stamps;
  inOverflow?: boolean;
}) {
  const droppable = useDroppable({
    id: `drop-group:${group.descriptor.id}`,
    data: { kind: "group", groupId: group.descriptor.id },
  });
  const rowHeight = rowController.comfortable ? ROW_HEIGHT.comfortable : ROW_HEIGHT.compact;
  const inPinned = group.descriptor.id === "pinned";
  return (
    <section
      ref={droppable.setNodeRef}
      aria-label={group.descriptor.label}
      data-sidebar-visibility-group={group.descriptor.id}
      data-sidebar-section-id={group.descriptor.kind === "section" ? group.descriptor.entityId ?? undefined : undefined}
      className="relative flex w-full min-w-0 flex-col"
    >
      <GroupHeader
        group={group}
        controller={groupController}
        inOverflow={inOverflow}
        dropActive={dropTargetGroupId === group.descriptor.id}
      />
      {group.collapsed ? null : group.rows.length === 0 ? (
        <p className="py-1 pl-8 text-xs text-muted-foreground">No threads</p>
      ) : (
        <div data-sidebar="group-content" className="flex w-full flex-col text-sm">
          {chunk(group.rows).map((rows) => (
            <WindowedChunk
              key={rowKey(rows[0]!)}
              rows={rows}
              rowHeight={rowHeight}
              forceMount={
                inOverflow ||
                rows.some(
                  (row) =>
                    row.type === "thread" &&
                    (row.info.thread.id === activeThreadId || row.info.thread.id === editingId),
                )
              }
            >
              {rows.map((row) =>
                row.type === "thread" ? (
                  <ThreadRowView
                    key={row.key}
                    row={row}
                    controller={rowController}
                    groupId={group.descriptor.id}
                    inPinned={inPinned}
                    dropState={dropStates.get(row.info.thread.id) ?? null}
                    active={row.info.thread.id === activeThreadId}
                    editing={row.info.thread.id === editingId}
                    now={now}
                    startedAt={stamps.startedAt[row.info.thread.id]}
                    finishedAt={stamps.finishedAt[row.info.thread.id]}
                    pendingAt={stamps.pendingAt[row.info.thread.id]}
                  />
                ) : row.type === "older" ? (
                  <OlderRowView key={row.key} row={row} controller={rowController} />
                ) : row.type === "empty" ? (
                  <EmptyRowView key={row.key} row={row} controller={rowController} />
                ) : (
                  <EnvironmentRowView
                    key={row.key}
                    row={row}
                    controller={rowController}
                    environmentProviders={environmentProviders}
                  />
                ),
              )}
            </WindowedChunk>
          ))}
        </div>
      )}
    </section>
  );
});
