// One thread row, as plain elements. It draws the row the model built and
// reports what the user did; every decision was made before it rendered. Its
// "…" menu, context menu and hover buttons are bb's own, but for a root's
// Mark tree read; its hover card, drag and drag-to-split are the list's.
import { memo, useMemo, useRef } from "react";
import {
  experimental_Icon as Icon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useThreadActions as useThreadActions,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadActionsTriggerProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { ICONS } from "../icons";
import { isPinnedThread } from "../model/groups";
import { hasTwoLines } from "../model/heights";
import { chipLabel, rowAriaLabel } from "../model/labels";
import { rowIndent } from "../model/layout";
import { itemKeyOf } from "../model/layout-items";
import { noteText } from "../model/notes";
import { actionTargetOf } from "../model/thread-target";
import { chipTone, pluginStatusWins } from "../model/state";
import { TRAILING_SLOT_SIZERS } from "../model/time";
import type { ThreadRow } from "../model/view";
import { useCommands, useLayout, useProviderDisplay, useRow } from "../store/hooks";
import { ChipStateGlyph, GlyphIcon, NoteLine, PluginStatusGlyph, TONE_CLASS } from "./glyphs";
import { useOverlays } from "./overlays/overlays";
import { useRenameAfterClose } from "./overlays/menu-state";
import { ProviderBadge } from "./ProviderBadge";
import { PullRequestBadge } from "./PullRequestBadge";
import { RenameEditor } from "./RenameEditor";
import { SplitMiniMap } from "./SplitMiniMap";
import { inlineThreadActions, QUICK_ACTION_KEYS } from "./thread-menu";
import { NESTED_MARK_TWO_LINES, threadRowHeight } from "./row-heights";
import { ROW_HOVER_HIDES, ROW_HOVER_LAYS_OUT, ROW_HOVER_SHOWS } from "./input-modality";

/** Two clicks on one row within this window start a rename, as in bb. */
const RENAME_CLICK_MS = 400;
let lastClick: { threadId: string; at: number } | null = null;

/**
 * A quiet title, and its chip: the foreground mixed toward the sidebar in
 * oklch, which keeps 4.5:1 in both of bb's themes. Opacity blends in sRGB and
 * lands lower in the light theme.
 */
const QUIET_TEXT = "text-[color:color-mix(in_oklch,var(--foreground)_68%,var(--sidebar))]";

export const ROW_ICON_BUTTON =
  "pointer-events-auto relative z-10 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-state-active";

export interface ThreadRowViewProps {
  row: ThreadRow;
  groupId: string;
}

/**
 * One thread row. It reads its own part of the list store (focus, rename,
 * split mini-map, draft, row status, its menu and drag, settings), so it
 * renders when that part or its row changes, and no other time. The bb hooks
 * it calls are its shortcut and its hover buttons' thread actions.
 */
export const ThreadRowView = memo(function ThreadRowView({ row, groupId }: ThreadRowViewProps) {
  const { info } = row;
  const thread = info.thread;
  const archived = thread.archivedAt !== null || thread.isArchived;
  const commands = useCommands();
  const overlays = useOverlays();
  const { compact, density, harnessIcon } = useLayout();
  const { focused: isActive, editing, miniMap, hasDraft, rowStatus, menuOpen, dragging } = useRow(thread.id, groupId, row.key);
  const provider = useProviderDisplay(thread.providerId);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const element = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  const key = itemKeyOf(groupId, row.key);
  const place = { groupId, rowKey: row.key, threadId: thread.id };
  const cardTarget = () => ({ ...place, anchor: element.current! });

  const showPlugin = pluginStatusWins(info.state, rowStatus);
  const label = rowAriaLabel(row, {
    providerName: provider.name,
    pluginLabel: showPlugin ? rowStatus!.label : null,
    hasDraft,
  });
  const time = row.time;

  // bb's menus for this thread, with Thread Glance's items added and its
  // inline editor for Rename, started once the menu has closed.
  const target = useMemo(() => actionTargetOf(thread), [thread]);
  const inline = useMemo(
    () => inlineThreadActions({ threadId: thread.id, descendantsUnread: row.descendantsUnread, archived }, commands),
    [thread.id, row.descendantsUnread, archived, commands],
  );
  const rename = useRenameAfterClose(menuOpen);
  const menu = {
    thread: target,
    inline,
    requestRename: (threadId: string) => rename.request(() => commands.editTitle(threadId)),
    onCloseAutoFocus: rename.onCloseAutoFocus,
    onOpenChange: (open: boolean) => (open ? commands.openMenu({ kind: "thread", ...place }) : commands.closeMenu()),
  };
  const quick = useThreadActions(target, { keys: QUICK_ACTION_KEYS });
  // A root with an unread thread below it marks its tree on hover, as its
  // menu's Mark tree read does; any other unread thread runs bb's Mark read.
  const bbRead = quick.find((entry) => entry.key === "bb--core/read");
  const markRead = row.descendantsUnread
    ? { label: "Mark tree read", icon: ICONS.markRead, run: () => commands.markTreeRead(thread.id) }
    : thread.isUnread && bbRead !== undefined
      ? { label: bbRead.action.label, icon: bbRead.action.icon, run: () => void bbRead.action.run() }
      : undefined;
  const archive = quick.find((entry) => entry.key === "bb--core/archive");

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
    if ((event.metaKey || event.ctrlKey) && commands.splitAvailable()) {
      event.preventDefault();
      commands.openInSplit(thread.id);
      return;
    }
    const now = Date.now();
    if (lastClick !== null && lastClick.threadId === thread.id && now - lastClick.at < RENAME_CLICK_MS) {
      lastClick = null;
      event.preventDefault();
      commands.editTitle(thread.id);
      return;
    }
    lastClick = { threadId: thread.id, at: now };
    commands.navigate();
  };

  // Desktop: the pointer and focus drive the hover card and bb's drag-to-split,
  // and the context-menu key or Shift+F10 opens bb's context menu at the row.
  const desktop = compact
    ? {}
    : {
        onPointerEnter: (event: React.PointerEvent) => {
          overlays.card.pointerEnter(event);
          commands.pointAt(thread.id);
        },
        onPointerMove: (event: React.PointerEvent) => overlays.card.pointerMove(cardTarget(), event),
        onPointerLeave: () => overlays.card.pointerLeave(),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (editing || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
          event.preventDefault();
          // The context menu opens where a contextmenu event lands on its row.
          const box = element.current!.getBoundingClientRect();
          element.current!.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 16, clientY: box.bottom, button: 2 }),
          );
        },
      };

  const chip = row.chip;
  const indent = rowIndent(row.depth);
  const note = row.note;
  const twoLines = hasTwoLines(row);
  const dimmed = row.dimmed && !editing;
  // A pressed shortcut's pill takes the machine's place, as it takes the time's.
  const showMachine = row.machine !== null && shortcut === null;
  const badgesShown = row.harness || showMachine;
  const actionsShown = !compact && shortcut === null;
  // Desktop: on hover the harness and machine fade out for Mark read and
  // Archive, and the time for "…". Compact: nothing fades.
  const fadeClass = compact
    ? ""
    : menuOpen
      ? "opacity-0"
      : ROW_HOVER_HIDES;

  // What a press on the row drags, read by the list's one drag.
  const drag =
    editing || compact
      ? {}
      : {
          "data-drag-thread": thread.id,
          "data-drag-parent": thread.parentThreadId ?? "",
          "data-drag-section": thread.sectionId ?? "",
          "data-drag-pinned": String(isPinnedThread(thread)),
          "data-drag-group": groupId,
          "data-drag-row": row.key,
        };

  return (
    <ThreadActionsContextMenu {...menu} disabled={editing} dragging={dragging}>
      <div
        ref={element}
        data-sidebar-rename-row=""
        {...drag}
        {...desktop}
        onPointerDown={(event) => {
          overlays.card.press();
          if (!editing && !compact) overlays.forwardSplit(thread.id, event);
        }}
        onFocus={() => {
          commands.focusRow(key);
          if (!compact) overlays.card.focus(cardTarget());
        }}
        onBlur={(event) => {
          if (element.current?.contains(event.relatedTarget as Node | null)) return;
          commands.focusRow(null, key);
          overlays.card.blur();
        }}
        className={cn(
          "group/row relative flex w-full items-center gap-1.5 rounded-md pr-1 text-sm transition-colors",
          threadRowHeight(density, compact, twoLines),
          isActive
            ? "bg-state-active text-sidebar-foreground"
            : "cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          !isActive && menuOpen && "bg-sidebar-accent",
          miniMap && !isActive && "bb-sidebar-open-in-split-row",
          dragging && "opacity-50",
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
            commands.editTitle(thread.id);
          }}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        />
        <span className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center">
          {stateSlot}
        </span>
        {row.nested ? (
          // Tight against the title, and over the row's gap, so it adds 8px.
          <span
            aria-hidden
            title={`Child of ${row.parentTitle ?? "a thread"}`}
            className={cn(
              "pointer-events-none relative -ml-[3px] -mr-px w-1.5 shrink-0 text-center text-[10px] leading-none text-muted-foreground",
              // On two-line rows it sits beside the title, not between the lines.
              twoLines && NESTED_MARK_TWO_LINES[density],
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
              onSave={(title) => commands.renameThread(thread.id, title)}
              onDone={() => {
                commands.editTitle(null);
                anchor.current?.focus();
              }}
            />
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                title={thread.displayTitle}
                className={cn(
                  "min-w-0 truncate",
                  row.bold ? "font-semibold" : "font-normal",
                  // Quiet threads step back so live ones lead; hover brings them back.
                  dimmed && `${QUIET_TEXT} group-hover/row:text-foreground`,
                )}
              >
                {/* Plain text rather than mention pills, so the title truncates. */}
                {thread.displayTitle}
              </span>
              {/* On a two-line row the badge stays on the title's line, not centred beside both. */}
              {row.pullRequest === "title" && twoLines ? <PullRequestBadge threadId={thread.id} /> : null}
            </span>
          )}
          {!editing && note !== null ? (
            <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground" title={noteText(note)}>
              <NoteLine note={note} />
            </span>
          ) : row.branchLine !== null && !editing ? (
            <BranchLine row={row} branch={row.branchLine} />
          ) : null}
        </span>
        {row.hiddenBadge ? (
          <span role="img" aria-label="Hidden thread" title="Hidden thread" className="pointer-events-none relative shrink-0 text-muted-foreground">
            <Icon name={ICONS.hidden} aria-hidden className="size-3.5" />
          </span>
        ) : null}
        {row.pullRequest === "title" && !twoLines && !editing ? (
          <span className="pointer-events-none relative">
            <PullRequestBadge threadId={thread.id} />
          </span>
        ) : null}
        {!editing && (badgesShown || actionsShown) ? (
          // One cell: the harness and machine at rest, Mark read and Archive
          // on hover. The actions take no width at rest, so no title is
          // shorter for them; on hover the title gives up only what they
          // need beyond the badges they replace.
          <span className="relative -ml-1.5 grid shrink-0 items-center">
            {badgesShown ? (
              <span className={cn("flex items-center gap-1.5 pl-1.5 [grid-area:1/1] transition-opacity", shortcut === null && fadeClass)}>
                {row.harness ? (
                  <span className="pointer-events-none relative inline-flex shrink-0">
                    <ProviderBadge display={provider} mode={harnessIcon} />
                  </span>
                ) : null}
                {showMachine ? (
                  <span
                    title={`On ${row.machine}`}
                    aria-label={`On ${row.machine}`}
                    className="pointer-events-none max-w-20 truncate text-xs text-muted-foreground"
                  >
                    {row.machine}
                  </span>
                ) : null}
              </span>
            ) : null}
            {actionsShown ? (
              <span
                className={cn(
                  "items-center justify-self-end gap-0.5 pl-1.5 [grid-area:1/1]",
                  menuOpen ? "flex" : ROW_HOVER_LAYS_OUT,
                )}
              >
                {markRead !== undefined ? (
                  <button
                    type="button"
                    aria-label={markRead.label}
                    title={markRead.label}
                    data-no-drag=""
                    className={ROW_ICON_BUTTON}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      markRead.run();
                    }}
                  >
                    <Icon name={markRead.icon} aria-hidden className="size-4" />
                  </button>
                ) : null}
                {archive !== undefined ? (
                  <button
                    type="button"
                    aria-label={archived ? "Unarchive thread" : "Archive thread"}
                    title={archive.action.label}
                    data-no-drag=""
                    className={ROW_ICON_BUTTON}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void archive.action.run();
                    }}
                  >
                    <Icon name={archive.action.icon} aria-hidden className="size-4" />
                  </button>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
        {!editing ? (
          // The chip sits 4px before the trailing slot, whose width never
          // changes, so hover never moves it.
          <span className="relative flex shrink-0 items-center gap-1">
            {chip !== null ? (
              <button
                type="button"
                aria-expanded={chip.expanded}
                aria-label={chipLabel(thread.displayTitle, chip)}
                title={chipLabel(thread.displayTitle, chip)}
                data-no-drag=""
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  commands.toggleChip(row);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                className={cn(
                  "pointer-events-auto relative z-10 inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-0.5 text-xs leading-none tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  chip.flag === null
                    ? cn("text-muted-foreground hover:text-foreground", dimmed && QUIET_TEXT)
                    : TONE_CLASS[chipTone(chip.flag)],
                )}
              >
                {chip.flag !== null ? <ChipStateGlyph flag={chip.flag} /> : null}
                {chip.count > 0 ? chip.count : null}
                <Icon
                  name={ICONS.expand}
                  aria-hidden
                  className={cn("size-3 transition-transform duration-150", chip.expanded && "rotate-90")}
                />
              </button>
            ) : null}
            {/* The trailing slot: one grid cell, as wide as "…" or the widest
                time, whichever is wider, holding the time at rest and "…" on hover. */}
            <span data-trailing-slot="" className="relative grid h-6 shrink-0 items-center">
              <span aria-hidden className="invisible w-6 [grid-area:1/1]" />
              {TRAILING_SLOT_SIZERS.map((text) => (
                <span key={text} aria-hidden className="invisible text-xs font-medium tabular-nums [grid-area:1/1]">
                  {text}
                </span>
              ))}
              {shortcut !== null ? (
                <kbd aria-hidden className="pointer-events-none justify-self-end rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground [grid-area:1/1]">
                  {shortcut.label}
                </kbd>
              ) : (
                <>
                  {time !== null ? (
                    <span
                      title={time.label}
                      aria-label={time.label}
                      className={cn(
                        "pointer-events-none justify-self-end text-xs tabular-nums transition-opacity [grid-area:1/1]",
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
                      "flex items-center justify-self-end transition-opacity [grid-area:1/1]",
                      compact
                        ? "relative"
                        : menuOpen
                          ? "opacity-100"
                          : ROW_HOVER_SHOWS,
                    )}
                  >
                    <ThreadActionsMenu
                      {...menu}
                      side="right"
                      align="start"
                      sideOffset={8}
                      trigger={(props) => <MenuButton {...props} compact={compact} />}
                    />
                  </span>
                </>
              )}
            </span>
          </span>
        ) : null}
      </div>
    </ThreadActionsContextMenu>
  );
});

/**
 * The "…" button bb's thread menu opens from. Phones open the menu by
 * long-press, as bb's lists do; the button stays for keyboards and screen
 * readers. A press opens the menu and nothing under it: no drag, no split.
 */
function MenuButton({ compact, onPointerDown, className, ...props }: PluginThreadActionsTriggerProps & { compact: boolean }) {
  return (
    <button
      type="button"
      aria-label="Thread actions"
      data-no-drag=""
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        event.stopPropagation();
      }}
      className={cn(className, compact ? "sr-only" : ROW_ICON_BUTTON)}
    >
      <Icon name={ICONS.more} aria-hidden className="size-4" />
    </button>
  );
}

/** The branch line: the branch, then its pull request badge. */
function BranchLine({ row, branch }: { row: ThreadRow; branch: string }) {
  const environment = row.info.thread.environment;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-0.5">
        <Icon name={environment?.isWorktree ? ICONS.worktree : ICONS.branch} aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{branch}</span>
        {environment?.isWorktree ? <span className="sr-only"> (worktree)</span> : null}
      </span>
      {row.pullRequest === "second-line" ? <PullRequestBadge threadId={row.info.thread.id} /> : null}
    </span>
  );
}
