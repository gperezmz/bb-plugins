// One thread row. It draws the row the model built and reports what
// the user did; every decision was made before it rendered.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreadSplit as useThreadSplit,
  useSidebarSplitLayout,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import { chipLabel, rowAriaLabel } from "../model/labels";
import { rowIndent } from "../model/layout";
import { rowMenuItems } from "../model/menu";
import { chipTone, pluginStatusWins } from "../model/state";
import { trailingTime } from "../model/time";
import type { ThreadRow } from "../model/view";
import type { DraggedThread } from "../model/drag";
import type { RowController } from "./controller";
import { CHIP_TONE_CLASS, FlagGlyph, GlyphIcon, PluginStatusGlyph } from "./glyphs";
import { ProviderBadge } from "./ProviderBadge";
import { PullRequestBadge } from "./PullRequestBadge";
import { RenameEditor } from "./RenameEditor";
import { RowContextMenuContent, RowDropdownMenuContent, type ContextMenuInput } from "./RowMenu";
import { SplitMiniMap, type MiniMapPane } from "./SplitMiniMap";
import { ThreadDetails } from "./ThreadDetails";
import { useRowCard } from "./row-card";

/** Two clicks on one row within this window start a rename, as in bb. */
const RENAME_CLICK_MS = 400;
const LONG_PRESS_MS = 700;
const LONG_PRESS_TOLERANCE = 10;
let lastClick: { threadId: string; at: number } | null = null;

/**
 * Drops the click that ends a long-press, wherever it lands, so lifting the
 * finger never selects the menu item that opened under it.
 */
function swallowNextClick(): void {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("click", swallow, true);
  };
  window.addEventListener("click", swallow, true);
  // A long-press that ends without a click must not eat the next real tap.
  window.addEventListener("touchend", () => setTimeout(() => window.removeEventListener("click", swallow, true), 400), {
    capture: true,
    once: true,
  });
}

/**
 * A quiet title, and its chip: the foreground mixed toward the sidebar in
 * oklch, which keeps 4.5:1 in both of bb's themes. Opacity blends in sRGB
 * and lands lower in the light theme.
 */
const QUIET_TEXT = "text-[color:color-mix(in_oklch,var(--foreground)_68%,var(--sidebar))]";

export const ROW_ICON_BUTTON =
  "pointer-events-auto relative z-10 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-state-active";

function useMiniMap(threadId: string): MiniMapPane[] | null {
  const layout = useSidebarSplitLayout();
  return useMemo(() => {
    if (layout === null) return null;
    const panes = layout.panes.map((pane) => ({
      paneId: pane.paneId,
      rect: pane.rect,
      isMe: pane.threadId === threadId,
      isFocused: pane.isFocused,
    }));
    return panes.some((pane) => pane.isMe) ? panes : null;
  }, [layout, threadId]);
}

export interface ThreadRowViewProps {
  row: ThreadRow;
  controller: RowController;
  groupId: string;
  inPinned: boolean;
  /** Drop feedback from the list's drag state. */
  dropState: "valid" | "blocked" | "unchanged" | "before" | "after" | null;
  /** The open thread is this one. */
  active: boolean;
  /** Its title is being renamed. */
  editing: boolean;
  /** The list clock, for the trailing age and timer. */
  now: number;
  /** This thread's stamps, for the trailing time. */
  startedAt: number | undefined;
  finishedAt: number | undefined;
  pendingAt: number | undefined;
}

export const ThreadRowView = memo(function ThreadRowView({
  row,
  controller,
  groupId,
  inPinned,
  dropState,
  active: isActive,
  editing,
  now,
  startedAt,
  finishedAt,
  pendingAt,
}: ThreadRowViewProps) {
  const { info } = row;
  const thread = info.thread;
  const archived = thread.archivedAt !== null || thread.isArchived;
  const compact = controller.compact;

  const shortcut = useSidebarThreadShortcut(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const split = useThreadSplit(thread.id);
  const miniMap = useMiniMap(thread.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const card = useRowCard(isActive, !compact && !editing && !menuOpen && !contextOpen);
  const contextInput = useRef<ContextMenuInput>({ pressed: false, keyed: false });
  const anchor = useRef<HTMLAnchorElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const dragData: DraggedThread = {
    threadId: thread.id,
    parentThreadId: thread.parentThreadId,
    sectionId: thread.sectionId,
    pinned: thread.pinnedAt !== null || thread.isPinned,
  };
  const draggable = useDraggable({
    id: `thread:${thread.id}:${groupId}`,
    data: { kind: "thread", thread: dragData, groupId },
    disabled: editing || compact,
  });
  const droppable = useDroppable({
    id: `drop-thread:${thread.id}:${groupId}`,
    data: { kind: "thread", threadId: thread.id, inPinned, groupId },
  });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    [draggable.setNodeRef, droppable.setNodeRef],
  );

  const provider = controller.provider(thread.providerId);
  const showPlugin = pluginStatusWins(info.state, rowStatus);
  const label = rowAriaLabel(row, {
    providerName: provider.name,
    pluginLabel: showPlugin ? rowStatus!.label : null,
    hasDraft: hasUnsubmittedDraft,
  });
  const time = archived
    ? null
    : trailingTime(
        thread,
        info.flags.has("working"),
        {
          startedAt: startedAt === undefined ? {} : { [thread.id]: startedAt },
          finishedAt: finishedAt === undefined ? {} : { [thread.id]: finishedAt },
        },
        now,
        info.state.kind === "waits-on-you" ? (pendingAt ?? null) : undefined,
      );
  const menuItems = rowMenuItems({
    thread,
    unread: info.unread,
    splitAvailable: split.isAvailable,
    isRoot: thread.parentThreadId === null,
    hasSections: controller.mode === "chronological" || controller.sections.length > 0,
    compact,
  });
  // Rename waits for the menu to close: an open menu traps focus and would
  // take it back from the editor, and a closing one returns it to the row.
  const renameFromMenu = useRef(false);
  // Set until the closing menu's focus return has been refused, whichever
  // path started the rename: a returned focus would blur and close the editor.
  const refuseCloseFocus = useRef(false);
  const onMenuAction = (action: Parameters<RowController["onMenuAction"]>[0], sectionId?: string | null) => {
    if (action === "rename") {
      renameFromMenu.current = true;
      refuseCloseFocus.current = true;
      setTimeout(() => {
        refuseCloseFocus.current = false;
      }, 1500);
      return;
    }
    controller.onMenuAction(action, thread, sectionId);
  };
  // Fallback for menus that close without a close-focus event (the compact
  // drawer; a context menu opened from the keyboard): start once every menu
  // has closed and its focus return has settled.
  useEffect(() => {
    if (menuOpen || contextOpen || !renameFromMenu.current) return;
    const timer = setTimeout(() => {
      if (!renameFromMenu.current) return;
      renameFromMenu.current = false;
      controller.setEditingId(thread.id);
    }, 60);
    return () => clearTimeout(timer);
  }, [menuOpen, contextOpen, controller, thread.id]);
  const onMenuCloseAutoFocus = (event: Event) => {
    if (!refuseCloseFocus.current) return;
    refuseCloseFocus.current = false;
    event.preventDefault();
    if (!renameFromMenu.current) return;
    renameFromMenu.current = false;
    controller.setEditingId(thread.id);
  };

  const defaultBranch = controller.showPullRequests && row.depth === 0 ? controller.defaultBranchOf(thread) : undefined;
  const branch = thread.environment?.branchName ?? null;
  const showPullRequest =
    controller.showPullRequests && row.depth === 0 && branch !== null && defaultBranch !== undefined && branch !== defaultBranch;

  const stateSlot = miniMap ? (
    <SplitMiniMap panes={miniMap} label={`${thread.displayTitle} — open in split; ${info.state.label}`} working={info.flags.has("working")} />
  ) : showPlugin ? (
    <PluginStatusGlyph status={rowStatus!} />
  ) : (
    <span title={info.state.label} className="inline-flex">
      <GlyphIcon glyph={info.state.glyph} label={info.state.label} />
    </span>
  );

  const onAnchorClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (editing) {
      event.preventDefault();
      return;
    }
    if (split.isAvailable && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      controller.onMenuAction("open-in-split", thread);
      return;
    }
    const now = Date.now();
    if (lastClick !== null && lastClick.threadId === thread.id && now - lastClick.at < RENAME_CLICK_MS) {
      lastClick = null;
      event.preventDefault();
      controller.setEditingId(thread.id);
      return;
    }
    lastClick = { threadId: thread.id, at: now };
    controller.onNavigate();
  };

  const cancelPress = () => {
    if (press.current !== null) clearTimeout(press.current.timer);
    press.current = null;
  };
  const longPressFired = useRef(false);
  const longPress = compact
    ? {
        onTouchStart: (event: React.TouchEvent) => {
          const touch = event.touches[0];
          if (touch === undefined) return;
          cancelPress();
          longPressFired.current = false;
          press.current = {
            x: touch.clientX,
            y: touch.clientY,
            timer: setTimeout(() => {
              press.current = null;
              longPressFired.current = true;
              swallowNextClick();
              setMenuOpen(true);
            }, LONG_PRESS_MS),
          };
        },
        onTouchMove: (event: React.TouchEvent) => {
          const touch = event.touches[0];
          if (press.current === null || touch === undefined) return;
          if (Math.hypot(touch.clientX - press.current.x, touch.clientY - press.current.y) > LONG_PRESS_TOLERANCE) {
            cancelPress();
          }
        },
        onTouchEnd: (event: React.TouchEvent) => {
          cancelPress();
          // The finger lifts over the drawer that just opened: without this,
          // the click that follows would select the item under it.
          if (longPressFired.current) event.preventDefault();
        },
        onTouchCancel: cancelPress,
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
        style: { WebkitTouchCallout: "none" } as React.CSSProperties,
      }
    : {};

  const chip = row.chip;
  const indent = rowIndent(row.depth);
  const twoLines = controller.comfortable || info.note !== null;
  const dimmed = row.dimmed && !editing;
  const menuShowing = menuOpen || contextOpen;
  // Desktop: the actions cross-fade over the harness and age, as bb's
  // trailing slot does. Compact: "…" always shows beside them.
  const fadeClass = compact
    ? ""
    : menuShowing
      ? "opacity-0"
      : "group-hover/row:opacity-0 group-focus-within/row:opacity-0";

  const body = (
    <div
      ref={setRefs}
      data-sidebar-rename-row=""
      data-sidebar-nest-target={
        dropState === "valid" || dropState === "blocked" || dropState === "unchanged" ? dropState : undefined
      }
      data-sidebar-reorder-placement={dropState === "before" || dropState === "after" ? dropState : undefined}
      {...draggable.attributes}
      {...draggable.listeners}
      role={undefined}
      tabIndex={undefined}
      aria-roledescription={undefined}
      onPointerEnter={card.rowProps.onPointerEnter}
      onPointerMove={card.rowProps.onPointerMove}
      onPointerDown={(event) => {
        card.rowProps.onPointerDown();
        if (!editing) split.splitProps.onPointerDown?.(event);
      }}
      onPointerLeave={card.rowProps.onPointerLeave}
      onFocus={card.rowProps.onFocus}
      onBlur={card.rowProps.onBlur}
      {...longPress}
      className={cn(
        "group/row relative flex w-full items-center gap-1.5 rounded-md pr-1 text-sm transition-colors",
        twoLines ? "h-11 max-md:pointer-coarse:h-12" : "h-7 max-md:pointer-coarse:h-9",
        isActive
          ? "bg-state-active text-sidebar-foreground"
          : "cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        !isActive && menuShowing && "bg-sidebar-accent",
        miniMap && !isActive && "bb-sidebar-open-in-split-row",
        draggable.isDragging && "opacity-50",
        dropState === "valid" && "ring-1 ring-inset ring-sidebar-ring/80 bg-sidebar-accent/45",
        dropState === "blocked" && "ring-1 ring-inset ring-destructive/60",
        dropState === "before" && "shadow-[inset_0_2px_0_0_var(--sidebar-ring)]",
        dropState === "after" && "shadow-[inset_0_-2px_0_0_var(--sidebar-ring)]",
      )}
      style={{ paddingLeft: indent }}
    >
      <a
        ref={anchor}
        href={thread.href}
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        data-sidebar-rename-anchor=""
        aria-label={label}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        aria-current={isActive ? "page" : undefined}
        onClick={onAnchorClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          controller.setEditingId(thread.id);
        }}
        className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      />
      <span className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center">{stateSlot}</span>
      {row.nested ? (
        // Tight against the title, and over the row's gap, so it adds 8px.
        <span
          aria-hidden
          title={`Child of ${row.parentTitle ?? "a thread"}`}
          className={cn(
            "pointer-events-none relative -ml-[3px] -mr-px w-1.5 shrink-0 text-center text-[10px] leading-none text-muted-foreground",
            // On two-line rows it sits beside the title, not between the lines.
            twoLines && "mt-[9px] self-start",
          )}
        >
          ↳
        </span>
      ) : null}
      {row.crossGroupLabel !== null ? (
        <span
          role="img"
          aria-label={row.crossGroupLabel}
          title={row.crossGroupLabel}
          data-sidebar-thread-cross-project=""
          className="pointer-events-none relative inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <Icon name={ICONS.crossGroup} aria-hidden className="size-3.5" />
        </span>
      ) : null}
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col justify-center">
        {editing ? (
          <RenameEditor
            initial={thread.displayTitle}
            label="Thread name"
            onSave={(title) => controller.onRename(thread.id, title)}
            onDone={() => {
              controller.setEditingId(null);
              anchor.current?.focus();
            }}
          />
        ) : (
          <span
            title={thread.displayTitle}
            className={cn(
              "min-w-0 truncate",
              info.unread ? "font-semibold" : "font-normal",
              // Children sit a step below their parent.
              row.depth > 0 && "text-xs",
              // Quiet threads step back so live ones lead; hover brings them back.
              dimmed && `${QUIET_TEXT} group-hover/row:text-foreground`,
            )}
          >
            {/* Plain text: mention pills lost the truncation fight. */}
            {thread.displayTitle}
          </span>
        )}
        {!editing && info.note !== null ? (
          <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground" title={`${info.note.prefix}: ${info.note.text}`}>
            <span className={info.note.tone === "destructive" ? "text-destructive" : "text-attention"}>{info.note.prefix}:</span>{" "}
            {info.note.text}
          </span>
        ) : controller.comfortable && !editing ? (
          <SecondLine row={row} multiHost={controller.multiHost} defaultBranch={controller.defaultBranchOf(thread)} />
        ) : null}
      </span>
      {row.hiddenBadge ? (
        <span role="img" aria-label="Hidden thread" title="Hidden thread" className="pointer-events-none relative shrink-0 text-muted-foreground">
          <Icon name={ICONS.hidden} aria-hidden className="size-3.5" />
        </span>
      ) : null}
      {showPullRequest && !editing ? (
        <span className="pointer-events-none relative">
          <PullRequestBadge threadId={thread.id} />
        </span>
      ) : null}
      {chip !== null && !editing ? (
        <button
          type="button"
          aria-expanded={chip.expanded}
          aria-label={chipLabel(thread.displayTitle, chip.count, chip.flag, chip.expanded)}
          title={chipLabel(thread.displayTitle, chip.count, chip.flag, chip.expanded)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            controller.onToggleChip(row);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          data-tone={chipTone(chip.flag)}
          className={cn(
            "pointer-events-auto relative z-10 inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md border px-1 text-[11px] leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            CHIP_TONE_CLASS[chipTone(chip.flag)],
            dimmed && QUIET_TEXT,
          )}
        >
          {chip.count}
          {chip.flag !== null ? <FlagGlyph flag={chip.flag} className="size-3" /> : null}
          {controller.harnessIcon !== "hidden"
            ? chip.providerIds.map((providerId) => (
                <ProviderBadge key={providerId} display={controller.provider(providerId)} className="size-3 [&_*]:size-3" />
              ))
            : null}
          <Icon
            name={ICONS.expand}
            aria-hidden
            className={cn("size-3 transition-transform duration-150", chip.expanded && "rotate-90")}
          />
        </button>
      ) : null}
      {!editing ? (
        <span
          className={cn(
            "pointer-events-none relative inline-flex shrink-0 transition-opacity",
            // The hover actions take this slot too, as bb's trailing slot does.
            shortcut === null && fadeClass,
          )}
        >
          <ProviderBadge display={provider} mode={controller.harnessIcon} />
        </span>
      ) : null}
      {!editing ? (
        <span className="relative flex h-6 min-w-8 shrink-0 items-center justify-end gap-1">
          {shortcut !== null ? (
            <kbd aria-hidden className="pointer-events-none rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">
              {shortcut.label}
            </kbd>
          ) : (
            <>
              {row.homeGroupLabel !== null ? (
                <span
                  title={`In ${row.homeGroupLabel}`}
                  className={cn("pointer-events-none max-w-24 truncate text-[11px] text-muted-foreground transition-opacity", fadeClass)}
                >
                  {row.homeGroupLabel}
                </span>
              ) : time !== null ? (
                <span
                  title={time.label}
                  aria-label={time.label}
                  className={cn(
                    "pointer-events-none text-[11px] tabular-nums transition-opacity",
                    // A running timer reads as work, an age as history.
                    time.kind === "timer" ? "font-medium text-[var(--timeline-accent)]" : "text-muted-foreground",
                    fadeClass,
                  )}
                >
                  {time.text}
                </span>
              ) : null}
              <span
                className={cn(
                  "flex items-center gap-0.5 transition-opacity",
                  compact
                    ? "relative"
                    : menuShowing
                      ? "absolute right-0 opacity-100"
                      : "absolute right-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
                )}
              >
                {!compact ? (
                  <button
                    type="button"
                    aria-label={archived ? "Unarchive thread" : "Archive thread"}
                    title={archived ? "Unarchive" : "Archive"}
                    className={ROW_ICON_BUTTON}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      controller.onMenuAction(archived ? "unarchive" : "archive", thread);
                    }}
                  >
                    <Icon name={archived ? ICONS.unarchive : ICONS.archive} aria-hidden className="size-4" />
                  </button>
                ) : null}
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Thread actions"
                      // Phones open the menu by long-press, as bb's lists do;
                      // the button stays for keyboards and screen readers.
                      className={compact ? "sr-only" : ROW_ICON_BUTTON}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Icon name={ICONS.more} aria-hidden className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <RowDropdownMenuContent
                    items={menuItems}
                    sections={controller.sections}
                    currentSectionId={thread.sectionId}
                    onAction={onMenuAction}
                    onCloseAutoFocus={onMenuCloseAutoFocus}
                  />
                </DropdownMenu>
              </span>
            </>
          )}
        </span>
      ) : null}
    </div>
  );

  if (compact) return body;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) contextInput.current = { pressed: false, keyed: false };
        setContextOpen(open);
      }}
    >
      <HoverCard
        closeDelay={100}
        open={card.open}
        onOpenChange={card.onOpenChange}
      >
        <ContextMenuTrigger asChild disabled={editing}>
          <HoverCardTrigger asChild>{body}</HoverCardTrigger>
        </ContextMenuTrigger>
        {!editing && !menuOpen && !contextOpen ? (
          <HoverCardContent side="right" align="start" collisionPadding={8} className="z-[100] w-72 p-3">
            <ThreadDetails info={info} controller={controller} showPullRequest={showPullRequest} />
          </HoverCardContent>
        ) : null}
      </HoverCard>
      <RowContextMenuContent
        items={menuItems}
        sections={controller.sections}
        currentSectionId={thread.sectionId}
        onAction={onMenuAction}
        onCloseAutoFocus={onMenuCloseAutoFocus}
        input={contextInput}
      />
    </ContextMenu>
  );
});

function SecondLine({
  row,
  multiHost,
  defaultBranch,
}: {
  row: ThreadRow;
  multiHost: boolean;
  defaultBranch: string | null | undefined;
}) {
  const thread = row.info.thread;
  const environment = thread.environment;
  const parts: React.ReactNode[] = [];
  // The branch earns the line only when it isn't the project's default:
  // "main" on every row said nothing.
  const branch = environment?.branchName ?? null;
  if (branch !== null && branch !== defaultBranch) {
    parts.push(
      <span key="branch" className="inline-flex min-w-0 items-center gap-0.5">
        <Icon name={environment?.isWorktree ? ICONS.worktree : ICONS.branch} aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{branch}</span>
        {environment?.isWorktree ? <span className="sr-only"> (worktree)</span> : null}
      </span>,
    );
  }
  if (multiHost && thread.host !== null) {
    parts.push(
      <span key="host" className="inline-flex shrink-0 items-center gap-0.5">
        <Icon name={ICONS.machine} aria-hidden className="size-3" />
        {thread.host.name}
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return <span className="flex min-w-0 items-center gap-2 text-xs leading-4 text-muted-foreground">{parts}</span>;
}
