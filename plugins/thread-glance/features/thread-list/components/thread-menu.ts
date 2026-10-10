// What a thread row adds to bb's thread menus: Thread Glance's own items,
// each in the bb group it belongs with. bb's items are bb's.
import { experimental_THREAD_ACTION_GROUPS as GROUPS } from "@get-bb/plugin-sdk/app";
import type { PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import type { Commands } from "../commands/commands";
import { ICONS } from "../icons";

/** bb's own actions a row's hover buttons run: Mark read and Archive. A root with an unread thread below it runs Mark tree read in Mark read's place. */
export const QUICK_ACTION_KEYS = ["bb--core/read", "bb--core/archive"] as const;

export interface InlineInputs {
  threadId: string;
  /** A root with an unread thread below it offers Mark tree read. */
  descendantsUnread: boolean;
  archived: boolean;
}

export function inlineThreadActions({ threadId, descendantsUnread, archived }: InlineInputs, commands: Commands): PluginThreadActionsInlineItem[] {
  const items: PluginThreadActionsInlineItem[] = [
    { key: "thread-glance/details", group: GROUPS.open, action: { label: "Details", icon: ICONS.details, run: () => commands.showDetails(threadId) } },
    { key: "thread-glance/copy-id", group: GROUPS.organize, action: { label: "Copy thread ID", icon: ICONS.copy, run: () => commands.copyThreadId(threadId) } },
  ];
  if (descendantsUnread) {
    items.push({
      key: "thread-glance/mark-tree-read",
      group: GROUPS.organize,
      action: { label: "Mark tree read", icon: ICONS.markRead, run: () => commands.markTreeRead(threadId) },
    });
  }
  if (!archived) {
    items.push({ key: "thread-glance/move", group: GROUPS.organize, action: { label: "Move…", icon: ICONS.move, run: () => commands.startMove(threadId) } });
  }
  return items;
}
