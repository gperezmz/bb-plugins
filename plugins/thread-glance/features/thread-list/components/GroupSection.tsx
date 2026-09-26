// A top-level group: its header with counters, and its rows, windowed
// in chunks; and the Needs attention section above every group.
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
import { ATTENTION_GROUP_ID, type GroupView, type AttentionView, type Row } from "../model/view";
import { chunk, windowedNavValue } from "../model/windowing";
import type { RowController } from "./controller";
import { EnvironmentRowView, LeftOutRowView, OlderRowView } from "./FoldRows";
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
export const TOOLBAR_HEIGHT = 28;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const label = group.descriptor.label;
  const draggable = useDraggable({
    id: `group:${group.descriptor.id}`,
    data: { kind: "group", groupId: group.descriptor.id },
    disabled: controller.compact || inOverflow || renaming,
  });
  const compact = controller.compact;
  // Desktop: the counter sits flush right, and "+" and "…" fade in over its
  // place on hover or focus, as a row's actions fade over its age. Nothing is
  // kept for them otherwise. Phones keep them in line, always shown.
  const counterFade = compact
    ? ""
    : menuOpen
      ? "opacity-0"
      : "group-hover/header:opacity-0 group-focus-within/header:opacity-0";
  const actionsFade = compact
    ? ""
    : cn(
        "absolute top-1/2 right-0 -translate-y-1/2 pl-1",
        dropActive ? "bg-sidebar-accent" : "bg-sidebar",
        menuOpen
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover/header:pointer-events-auto group-hover/header:opacity-100 group-focus-within/header:pointer-events-auto group-focus-within/header:opacity-100",
      );
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
        <span className="relative ml-auto flex shrink-0 items-center">
          <CounterStrip
            counters={visibleCounters(group.counters, { collapsed: group.collapsed, more: false })}
            className={cn("transition-opacity", counterFade)}
          />
          <span className={cn("flex items-center transition-opacity", actionsFade)}>
            {group.descriptor.kind !== "pinned" &&
            (group.descriptor.newThreadProjectId !== null || group.descriptor.kind === "machine") &&
            (!controller.compact || controller.activeGroupId === group.descriptor.id) ? (
              <button
                type="button"
                aria-label={`New thread in ${label}`}
                title={`New thread in ${label}`}
                data-sidebar-hover-actions-mobile={controller.compact ? "always" : undefined}
                className={ROW_ICON_BUTTON}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => controller.onNewThread(group)}
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
          </span>
        </span>
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

interface RowsProps {
  rows: readonly Row[];
  /** The group the rows are drawn in, for drag ids. */
  groupId: string;
  inPinned: boolean;
  /** Mount every chunk, whatever is on screen (the More popover). */
  forceMount: boolean;
  rowController: RowController;
  environmentProviders: readonly PluginEnvironmentProvider[];
  dropStates: DropStates;
  activeThreadId: string | null;
  editingId: string | null;
  now: number;
  /** Rows get their own stamps as props, so a stamp renders one row. */
  stamps: Stamps;
}

/** A group's rows, windowed in chunks. */
function Rows({
  rows: all,
  groupId,
  inPinned,
  forceMount,
  rowController,
  environmentProviders,
  dropStates,
  activeThreadId,
  editingId,
  now,
  stamps,
}: RowsProps) {
  const rowHeight = rowController.comfortable ? ROW_HEIGHT.comfortable : ROW_HEIGHT.compact;
  return (
    <div data-sidebar="group-content" className="flex w-full flex-col text-sm">
      {chunk(all).map((rows) => (
        <WindowedChunk
          key={rowKey(rows[0]!)}
          rows={rows}
          rowHeight={rowHeight}
          forceMount={
            forceMount ||
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
                groupId={groupId}
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
            ) : row.type === "left-out" ? (
              <LeftOutRowView key={row.key} row={row} controller={rowController} />
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
  );
}

type SectionProps = Omit<RowsProps, "rows" | "groupId" | "inPinned" | "forceMount">;

export const GroupSection = memo(function GroupSection({
  group,
  groupController,
  dropTargetGroupId,
  inOverflow = false,
  ...rest
}: SectionProps & {
  group: GroupView;
  groupController: GroupController;
  dropTargetGroupId: string | null;
  inOverflow?: boolean;
}) {
  const droppable = useDroppable({
    id: `drop-group:${group.descriptor.id}`,
    data: { kind: "group", groupId: group.descriptor.id },
  });
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
        // A group whose every family sits in Needs attention draws only its header.
        group.rootIds.length === 0 ? <p className="py-1 pl-8 text-xs text-muted-foreground">No threads</p> : null
      ) : (
        <Rows
          {...rest}
          rows={group.rows}
          groupId={group.descriptor.id}
          inPinned={group.descriptor.id === "pinned"}
          forceMount={inOverflow}
        />
      )}
    </section>
  );
});

// bb's attention colour, thinned over the sidebar: the one colour the section
// adds. Opaque, so the sticky header hides the rows scrolling under it. Mixed
// in oklab: the sidebar's grey has hue 0 in oklch, which would pull the tint
// toward pink. Set as the surface quiet titles mix toward; the band is
// lighter than the sidebar in the dark theme, so they keep 70% of the
// foreground there to stay above 4.5:1 (68% measured 4.44:1).
const ATTENTION_BAND =
  "[--tg-surface:color-mix(in_oklab,var(--attention)_8%,var(--sidebar))] [--tg-quiet:70%] bg-[var(--tg-surface)]";
const ATTENTION_COUNT =
  "bg-[color-mix(in_oklab,var(--attention)_20%,transparent)] text-[color:color-mix(in_oklab,var(--attention),var(--foreground)_55%)]";

/**
 * The Needs attention section: a header with its family count, then its rows,
 * on one band of bb's attention colour. It has no collapse, menu or drag, and
 * no drop target of its own.
 */
export const AttentionSection = memo(function AttentionSection({ view, ...rest }: SectionProps & { view: AttentionView }) {
  return (
    <section aria-label="Needs attention" className={cn("relative mb-1 flex w-full min-w-0 flex-col rounded-md pb-0.5", ATTENTION_BAND)}>
      <h2
        style={{ top: TOOLBAR_HEIGHT }}
        className="sticky z-20 flex h-7 items-center gap-1 rounded-t-md bg-[var(--tg-surface)] pl-2 pr-1 text-xs font-medium text-muted-foreground max-md:pointer-coarse:h-9"
      >
        <span className="min-w-0 flex-1 truncate">Needs attention</span>
        <span
          className={cn("rounded-full px-1.5 text-[11px] leading-4 tabular-nums", ATTENTION_COUNT)}
          aria-label={`${view.familyCount} ${view.familyCount === 1 ? "family" : "families"}`}
        >
          {view.familyCount}
        </span>
      </h2>
      <Rows {...rest} rows={view.rows} groupId={ATTENTION_GROUP_ID} inPinned={false} forceMount={false} />
    </section>
  );
});
