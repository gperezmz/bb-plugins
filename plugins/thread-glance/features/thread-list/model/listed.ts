// Which threads make it onto the list at all. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** Threads that make it onto the list: not archived and not hidden. */
export function isListed(thread: PluginSidebarThread): boolean {
  return !thread.isArchived && thread.archivedAt === null && !thread.isHidden;
}
