// Row menu items in bb's order, plus Thread Glance's additions. Pure:
// the menu components render this list.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ICONS } from "../icons";

export type RowMenuAction =
  | "open-in-split"
  | "copy-link"
  | "copy-id"
  | "mark-read"
  | "mark-unread"
  | "pin"
  | "unpin"
  | "move-to-section"
  | "move"
  | "rename"
  | "details"
  | "archive"
  | "unarchive"
  | "delete";

export interface RowMenuItem {
  action: RowMenuAction;
  label: string;
  icon: string;
  destructive?: boolean;
  /** Draw a separator before this item. */
  separated?: boolean;
}

export interface RowMenuInputs {
  thread: PluginSidebarThread;
  unread: boolean;
  splitAvailable: boolean;
  /** True for a thread with no parent (bb: Move to section on roots only). */
  isRoot: boolean;
  hasSections: boolean;
  /** Kept for callers; Details is on every viewport. */
  compact: boolean;
}

export function rowMenuItems(inputs: RowMenuInputs): RowMenuItem[] {
  const { thread } = inputs;
  const archived = thread.archivedAt !== null || thread.isArchived;
  const pinned = thread.pinnedAt !== null || thread.isPinned;
  const items: RowMenuItem[] = [];
  items.push({ action: "details", label: "Details", icon: ICONS.details });
  if (inputs.splitAvailable) {
    items.push({ action: "open-in-split", label: "Open in split", icon: ICONS.openInSplit });
  }
  items.push({ action: "copy-link", label: "Copy thread link", icon: ICONS.link });
  items.push({ action: "copy-id", label: "Copy thread ID", icon: ICONS.copy });
  items.push(
    inputs.unread
      ? { action: "mark-read", label: "Mark read", icon: ICONS.markRead }
      : { action: "mark-unread", label: "Mark unread", icon: ICONS.markUnread },
  );
  items.push(
    pinned
      ? { action: "unpin", label: "Unpin", icon: ICONS.unpin }
      : { action: "pin", label: "Pin", icon: ICONS.pin },
  );
  if (inputs.isRoot && !archived && inputs.hasSections) {
    items.push({ action: "move-to-section", label: "Move to section", icon: ICONS.moveToSection });
  }
  if (!archived) items.push({ action: "move", label: "Move…", icon: ICONS.move });
  items.push({ action: "rename", label: "Rename", icon: ICONS.rename });
  items.push(
    archived
      ? { action: "unarchive", label: "Unarchive", icon: ICONS.unarchive, separated: true }
      : { action: "archive", label: "Archive", icon: ICONS.archive, separated: true },
  );
  items.push({ action: "delete", label: "Delete", icon: ICONS.remove, destructive: true });
  return items;
}

/** Mark all read: above this many threads, ask first. */
export const MARK_ALL_CONFIRM_ABOVE = 20;
