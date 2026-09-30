// The list's one "…" menu for rows, thread and environment: anchored to the
// button that opened it, a drawer on phones. Rename waits for the menu to
// close, so the editor keeps the focus the closing menu would take back.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ICONS } from "../../icons";
import { rowMenuItems, type RowMenuAction } from "../../model/menu";
import type { EnvironmentRow, ThreadRow } from "../../model/view";
import { useCommands, useLayout, useRowAt, useSplitAvailable } from "../../store/hooks";
import { RowDropdownMenuContent } from "../RowMenu";
import { Anchor } from "./Anchor";
import { useRenameAfterClose, useShownMenu } from "./menu-state";

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
  const { sections, hasSections } = useLayout();
  const splitAvailable = useSplitAvailable();
  const thread = row.info.thread;
  const items = rowMenuItems({
    thread,
    unread: row.depth === 0 ? row.treeUnread : row.info.unread,
    splitAvailable,
    isRoot: thread.parentThreadId === null,
    hasSections,
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
