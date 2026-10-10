// The list's one "…" menu for group headers, anchored to the header's button.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICONS } from "../../icons";
import { canRename, type GroupDescriptor } from "../../model/groups";
import { useCommands, useGroup, useLayout, useShowArchived } from "../../store/hooks";
import { Anchor } from "./Anchor";
import { useRenameAfterClose, useShownMenu } from "./menu-state";

export function GroupMenuHost() {
  const commands = useCommands();
  const { open, shown } = useShownMenu(["group"] as const);
  const rename = useRenameAfterClose(open);
  const group = useGroup(shown?.groupId ?? "");
  return (
    <DropdownMenu open={open} onOpenChange={(next) => !next && commands.closeMenu()}>
      <DropdownMenuTrigger asChild>
        <Anchor element={shown?.anchor ?? null} />
      </DropdownMenuTrigger>
      {group !== undefined ? (
        <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={rename.onCloseAutoFocus}>
          <GroupMenuItems
            descriptor={group.descriptor}
            hasUnread={group.hasUnread}
            hidden={group.hidden}
            onRename={() => rename.request(() => commands.startRename(group.descriptor.id, null))}
          />
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

/** A group header's menu items. */
function GroupMenuItems({
  descriptor,
  hasUnread,
  hidden,
  onRename,
}: {
  descriptor: GroupDescriptor;
  hasUnread: boolean;
  hidden: boolean;
  onRename(): void;
}) {
  const commands = useCommands();
  const { mode } = useLayout();
  const showArchived = useShowArchived();
  const groupId = descriptor.id;
  const canCreateSections = mode === "chronological";
  return (
    <>
      {hasUnread ? (
        <DropdownMenuItem onSelect={() => commands.markGroupRead(groupId)}>
          <Icon name={ICONS.markRead} aria-hidden className="size-4" />
          Mark all read
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={() => commands.newThreadInGroup(groupId)}>
        <Icon name={ICONS.newThread} aria-hidden className="size-4" />
        New thread
      </DropdownMenuItem>
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
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => commands.removeSection(groupId)}>
          <Icon name={ICONS.remove} aria-hidden className="size-4" />
          Remove section
        </DropdownMenuItem>
      ) : null}
      {descriptor.kind === "project" ? (
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => commands.removeProject(groupId)}>
          <Icon name={ICONS.remove} aria-hidden className="size-4" />
          Remove project
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
