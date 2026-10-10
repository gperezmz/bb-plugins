// The list's one "…" menu for worktree folder rows: anchored to the button
// that opened it, a drawer on phones. Rename waits for the menu to close, so
// the editor keeps the focus the closing menu would take back. Thread rows
// draw bb's own menus.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ICONS } from "../../icons";
import { useCommands, useRowAt } from "../../store/hooks";
import { Anchor } from "./Anchor";
import { useRenameAfterClose, useShownMenu } from "./menu-state";

export function EnvironmentMenuHost() {
  const commands = useCommands();
  const { open, shown } = useShownMenu(["environment"] as const);
  const rename = useRenameAfterClose(open);
  const row = useRowAt(shown?.groupId ?? "", shown?.rowKey ?? "");
  return (
    <DropdownMenu open={open} onOpenChange={(next) => !next && commands.closeMenu()}>
      <DropdownMenuTrigger asChild>
        <Anchor element={shown?.anchor ?? null} />
      </DropdownMenuTrigger>
      {row?.type === "environment" && shown !== null ? (
        <DropdownMenuContent align="end" onCloseAutoFocus={rename.onCloseAutoFocus}>
          <DropdownMenuItem onSelect={() => commands.newThreadInEnvironment(row.environmentId, row.projectId, row.sectionId)}>
            <Icon name={ICONS.newThread} aria-hidden className="size-4" />
            New thread in environment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rename.request(() => commands.startRename(shown.groupId, row.key))}>
            <Icon name={ICONS.rename} aria-hidden className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => commands.archiveEnvironment(row.environmentId)}>
            <Icon name={ICONS.archive} aria-hidden className="size-4" />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}
