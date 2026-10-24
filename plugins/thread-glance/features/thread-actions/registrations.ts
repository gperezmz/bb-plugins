// Thread Glance's actions in bb's thread menu: the row's "…" and right-click
// menus, the thread header's menu and the compact long-press drawer.
//
// bb sorts a menu by group, then by `order` (an action without one sorts
// last in its group), then by registration order. bb's own actions sit in
// `open` (Open in split, with no order), and in `organize`: New thread in
// environment 10, Copy thread link 20, Mark read or unread 30, Pin 40,
// Rename 60. So Parent… and Project follow Open in split by registering in
// `open` without an order; Copy branch and Copy thread ID follow Copy thread
// link at 21 and 22; the lifecycle actions follow Pin at 41 to 46; and Notify
// parent follows them at 50 (order 50).
import { experimental_THREAD_ACTION_GROUPS as GROUPS } from "@get-bb/plugin-sdk/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useMenuData } from "./data";
import {
  copyBranchAction,
  copyThreadIdAction,
  notifyParentAction,
  parentAction,
  parkAction,
  projectAction,
  resumeAction,
  settleAction,
  snoozeAction,
  unsettleAction,
  wakeAction,
} from "./model/menu";
import type { MenuData } from "./model/menu";
import type { PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";

interface Entry {
  id: string;
  title: string;
  icon: string;
  group: string;
  order?: number;
  build(thread: PluginThreadActionTarget, data: MenuData): PluginThreadAction | null;
}

/** The registrations, in the order they are registered. */
export const THREAD_MENU_ENTRIES: readonly Entry[] = [
  { id: "parent", title: "Parent…", icon: "CornerDownRight", group: GROUPS.open, build: parentAction },
  { id: "project", title: "Project", icon: "Folder", group: GROUPS.open, build: projectAction },
  { id: "copy-branch", title: "Copy branch", icon: "GitBranch", group: GROUPS.organize, order: 21, build: copyBranchAction },
  { id: "copy-thread-id", title: "Copy thread ID", icon: "Copy", group: GROUPS.organize, order: 22, build: copyThreadIdAction },
  { id: "snooze", title: "Snooze", icon: "Clock", group: GROUPS.organize, order: 41, build: snoozeAction },
  { id: "wake", title: "Wake now", icon: "RotateCcw", group: GROUPS.organize, order: 42, build: wakeAction },
  { id: "park", title: "Park thread", icon: "thread-glance-car", group: GROUPS.organize, order: 43, build: parkAction },
  { id: "resume", title: "Resume", icon: "Play", group: GROUPS.organize, order: 44, build: resumeAction },
  { id: "settle", title: "Settle", icon: "thread-glance-meditation", group: GROUPS.organize, order: 45, build: settleAction },
  { id: "unsettle", title: "Un-settle", icon: "Undo", group: GROUPS.organize, order: 46, build: unsettleAction },
  { id: "notify-parent", title: "Notify parent", icon: "BellDot", group: GROUPS.organize, order: 50, build: notifyParentAction },
];

/** Adds Thread Glance's actions to bb's thread menu. */
export function registerThreadActions(app: PluginAppBuilder): void {
  for (const entry of THREAD_MENU_ENTRIES) {
    app.slots.experimental_threadAction<MenuData>({
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      group: entry.group,
      ...(entry.order === undefined ? {} : { order: entry.order }),
      useData: useMenuData,
      item: ({ thread, data }) => entry.build(thread, data),
    });
  }
}
