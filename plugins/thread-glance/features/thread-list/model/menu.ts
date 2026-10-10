// Row menu items in bb's order, plus Thread Glance's additions and the
// thread actions bb lists that Thread Glance does not draw itself. Pure: the
// menu components render this list.
import type { PluginSidebarSection, PluginSidebarThread, PluginThreadActionEntry, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { ICONS } from "../icons";
import { isPinnedThread } from "./groups";

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

/** One pick in an item's choice list. */
export interface MenuChoice {
  id: string;
  label: string;
  icon?: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface RowMenuItem {
  /** Unique in the menu: a `RowMenuAction`, or the key bb gives a thread action. */
  key: string;
  label: string;
  /** A muted second line under the label. */
  detail?: string;
  icon: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Draw a separator before this item. */
  separated?: boolean;
  /** Picks drawn as a submenu, or under the item's heading in a phone's drawer. */
  choices?: { heading?: string; hint?: string; items: readonly MenuChoice[] };
}

export interface RowMenuInputs {
  thread: PluginSidebarThread;
  /** The thread is unread; for a root, anything in its tree is, and Mark read marks the tree. */
  unread: boolean;
  splitAvailable: boolean;
  /** True for a thread with no parent (bb: Move to section on roots only). */
  isRoot: boolean;
  hasSections: boolean;
  sections: readonly PluginSidebarSection[];
  /** Every thread action bb lists for the thread, in bb's menu order. */
  threadActions: readonly PluginThreadActionEntry[];
}

/** The choice that moves a thread back to Threads, out of every section. */
export const THREADS_CHOICE = "";

/** bb's own thread actions that Thread Glance draws its own way: tree-wide Mark read, its inline rename. */
const DRAWN_BY_THREAD_GLANCE: ReadonlySet<string> = new Set(
  ["split", "copyLink", "read", "pin", "rename", "archive", "delete"].map((id) => `bb--core/${id}`),
);

/** bb's group of archive and delete, which Thread Glance's Archive and Delete stand for. */
const LIFECYCLE_GROUP = "4_lifecycle";

/** A thread as bb's thread actions read it. */
export function actionTargetOf(thread: PluginSidebarThread): PluginThreadActionTarget {
  const { environment } = thread;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: environment?.id != null ? { id: environment.id, path: environment.path } : null,
  };
}

/**
 * Thread actions as menu items, each group set off by a separator as bb's
 * menus set them off; `after` is the group of the item drawn before them.
 */
function threadActionItems(entries: readonly PluginThreadActionEntry[], after: string | null): RowMenuItem[] {
  let group = after;
  return entries.map(({ key, group: entryGroup, action }) => {
    const separated = entryGroup !== group;
    group = entryGroup;
    return {
      key,
      label: action.label,
      icon: action.icon,
      separated,
      ...(action.detail !== undefined ? { detail: action.detail } : {}),
      ...(action.variant === "destructive" ? { destructive: true } : {}),
      ...(action.disabled ? { disabled: true } : {}),
      ...(action.choices !== undefined ? { choices: action.choices } : {}),
    };
  });
}

function sectionChoices(sections: readonly PluginSidebarSection[], currentSectionId: string | null): MenuChoice[] {
  return [{ id: THREADS_CHOICE, name: "Threads" }, ...sections].map(({ id, name }) => {
    const current = id === (currentSectionId ?? THREADS_CHOICE);
    return { id, label: name, selected: current, disabled: current };
  });
}

export function rowMenuItems(inputs: RowMenuInputs): RowMenuItem[] {
  const { thread } = inputs;
  const archived = thread.archivedAt !== null || thread.isArchived;
  const pinned = isPinnedThread(thread);
  const items: RowMenuItem[] = [];
  items.push({ key: "details", label: "Details", icon: ICONS.details });
  if (inputs.splitAvailable) {
    items.push({ key: "open-in-split", label: "Open in split", icon: ICONS.openInSplit });
  }
  items.push({ key: "copy-link", label: "Copy thread link", icon: ICONS.link });
  items.push({ key: "copy-id", label: "Copy thread ID", icon: ICONS.copy });
  items.push(
    inputs.unread
      ? { key: "mark-read", label: "Mark read", icon: ICONS.markRead }
      : { key: "mark-unread", label: "Mark unread", icon: ICONS.markUnread },
  );
  items.push(
    pinned
      ? { key: "unpin", label: "Unpin", icon: ICONS.unpin }
      : { key: "pin", label: "Pin", icon: ICONS.pin },
  );
  if (inputs.isRoot && !archived && inputs.hasSections) {
    items.push({
      key: "move-to-section",
      label: "Move to section",
      icon: ICONS.moveToSection,
      choices: { items: sectionChoices(inputs.sections, thread.sectionId) },
    });
  }
  if (!archived) items.push({ key: "move", label: "Move…", icon: ICONS.move });
  items.push({ key: "rename", label: "Rename", icon: ICONS.rename });
  // bb's groups sort as strings; a plugin's own group sorts after bb's lifecycle.
  const added = inputs.threadActions.filter((entry) => !DRAWN_BY_THREAD_GLANCE.has(entry.key));
  items.push(...threadActionItems(added.filter((entry) => entry.group < LIFECYCLE_GROUP), null));
  items.push(
    archived
      ? { key: "unarchive", label: "Unarchive", icon: ICONS.unarchive, separated: true }
      : { key: "archive", label: "Archive", icon: ICONS.archive, separated: true },
  );
  items.push({ key: "delete", label: "Delete", icon: ICONS.remove, destructive: true });
  items.push(...threadActionItems(added.filter((entry) => entry.group >= LIFECYCLE_GROUP), LIFECYCLE_GROUP));
  return items;
}

/** Mark all read: above this many threads, ask first. */
export const MARK_ALL_CONFIRM_ABOVE = 20;
