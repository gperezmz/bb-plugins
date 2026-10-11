// bb's thread menu on a row: the "…" button and the right-click menu. The
// menu is bb's own, with the actions this plugin and bb contribute to it.
import { experimental_Icon as Icon, experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_ThreadActionsMenu as ThreadActionsMenu } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useCommands } from "../../store/hooks";

/** The thread as bb's thread menu reads it. */
export function menuTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: thread.environment?.id != null ? { id: thread.environment.id, path: thread.environment.path } : null,
  };
}

/** Right-click (long-press on touch) opens bb's thread menu over `children`. */
export function RowContextMenu({ thread, disabled, dragging, children }: { thread: PluginSidebarThread; disabled: boolean; dragging: boolean; children: ReactNode }) {
  const commands = useCommands();
  return (
    <ThreadActionsContextMenu thread={menuTarget(thread)} disabled={disabled} dragging={dragging} requestRename={commands.beginRename}>
      {children}
    </ThreadActionsContextMenu>
  );
}

/** The "…" button that opens bb's thread menu. */
export function MoreButton({ thread, className }: { thread: PluginSidebarThread; className?: string }) {
  const commands = useCommands();
  return (
    <ThreadActionsMenu
      thread={menuTarget(thread)}
      requestRename={commands.beginRename}
      side="bottom"
      align="end"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          data-no-drag=""
          aria-label={`Thread actions for ${thread.displayTitle}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onClick?.(event);
          }}
          className={cn(props.className, "pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring", className)}
        >
          <Icon name="MoreHorizontal" aria-hidden className="size-3.5" />
        </button>
      )}
    />
  );
}
