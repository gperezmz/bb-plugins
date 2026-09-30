// The list's one "…" menu for rows, thread and environment: anchored to the
// button that opened it, a drawer on phones. Rename waits for the menu to
// close, so the editor keeps the focus the closing menu would take back.
import { useEffect, useRef } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ICONS } from "../../icons";
import { rowMenuItems, type RowMenuAction } from "../../model/menu";
import type { EnvironmentRow, ThreadRow } from "../../model/view";
import type { OpenMenu } from "../../store/api";
import { useCommands, useLayout, useOpenMenu, useRowAt, useSplitAvailable } from "../../store/hooks";
import { RowDropdownMenuContent } from "../RowMenu";
import { Anchor } from "./Anchor";

/** How long a closing menu's focus return may take before a rename starts anyway. */
const RENAME_AFTER_CLOSE_MS = 60;

/**
 * Starts a rename chosen in a menu once the menu has closed: at its focus
 * return, which it refuses, or shortly after it closes where no focus return
 * comes (a phone's drawer, a context menu opened from the keyboard).
 */
export function useRenameAfterClose(open: boolean) {
  const pending = useRef<(() => void) | null>(null);
  const refuseFocus = useRef(false);
  useEffect(() => {
    if (open || pending.current === null) return;
    const timer = setTimeout(() => {
      const start = pending.current;
      pending.current = null;
      start?.();
    }, RENAME_AFTER_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return {
    /** Remembers the rename to start once the menu has closed. */
    request(start: () => void) {
      pending.current = start;
      refuseFocus.current = true;
      setTimeout(() => {
        refuseFocus.current = false;
      }, 1500);
    },
    onCloseAutoFocus(event: Event) {
      if (!refuseFocus.current) return;
      refuseFocus.current = false;
      event.preventDefault();
      const start = pending.current;
      pending.current = null;
      start?.();
    },
  };
}

/** The last menu of `kinds` opened, kept while it closes so its content stays for the exit. */
export function useShownMenu<K extends OpenMenu["kind"]>(kinds: readonly K[]): { open: boolean; shown: Extract<OpenMenu, { kind: K }> | null } {
  const menu = useOpenMenu();
  const last = useRef<Extract<OpenMenu, { kind: K }> | null>(null);
  const open = menu !== null && (kinds as readonly string[]).includes(menu.kind);
  if (open) last.current = menu as Extract<OpenMenu, { kind: K }>;
  return { open, shown: last.current };
}

export function RowMenuHost() {
  const commands = useCommands();
  const { open, shown } = useShownMenu(["row", "environment"] as const);
  const rename = useRenameAfterClose(open);
  const row = useRowAt(shown?.groupId ?? "", shown?.rowKey ?? "");
  return (
    <DropdownMenu open={open} onOpenChange={(next) => !next && commands.closeMenu()}>
      <DropdownMenuTrigger asChild>
        <Anchor element={shown?.anchor ?? null} />
      </DropdownMenuTrigger>
      {row?.type === "thread" ? (
        <ThreadMenuContent row={row} onRename={(start) => rename.request(start)} onCloseAutoFocus={rename.onCloseAutoFocus} />
      ) : row?.type === "environment" && shown !== null ? (
        <EnvironmentMenuContent row={row} groupId={shown.groupId} onRename={(start) => rename.request(start)} onCloseAutoFocus={rename.onCloseAutoFocus} />
      ) : null}
    </DropdownMenu>
  );
}

interface ContentProps {
  onRename(start: () => void): void;
  onCloseAutoFocus(event: Event): void;
}

/** A thread row's menu items and what each does, from the keyboard or the pointer. */
export function useThreadMenu(row: ThreadRow, onRename: ContentProps["onRename"]) {
  const commands = useCommands();
  const { compact, sections, hasSections } = useLayout();
  const splitAvailable = useSplitAvailable();
  const thread = row.info.thread;
  const items = rowMenuItems({
    thread,
    unread: row.depth === 0 ? row.treeUnread : row.info.unread,
    splitAvailable,
    isRoot: thread.parentThreadId === null,
    hasSections,
    compact,
  });
  const onAction = (action: RowMenuAction, sectionId?: string | null) => {
    if (action === "rename") onRename(() => commands.editTitle(thread.id));
    else commands.menuAction(action, thread, sectionId);
  };
  return { items, sections, currentSectionId: thread.sectionId, onAction };
}

function ThreadMenuContent({ row, onRename, onCloseAutoFocus }: ContentProps & { row: ThreadRow }) {
  const menu = useThreadMenu(row, onRename);
  return <RowDropdownMenuContent {...menu} onCloseAutoFocus={onCloseAutoFocus} />;
}

function EnvironmentMenuContent({ row, groupId, onRename, onCloseAutoFocus }: ContentProps & { row: EnvironmentRow; groupId: string }) {
  const commands = useCommands();
  return (
    <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
      <DropdownMenuItem onSelect={() => commands.newThreadInEnvironment(row.environmentId, row.projectId, row.sectionId)}>
        <Icon name={ICONS.newThread} aria-hidden className="size-4" />
        New thread in environment
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onRename(() => commands.startRename(groupId, row.key))}>
        <Icon name={ICONS.rename} aria-hidden className="size-4" />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => commands.archiveEnvironment(row.environmentId)}>
        <Icon name={ICONS.archive} aria-hidden className="size-4" />
        Archive
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
