// The title a rename edits. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * The title as stored, `@project:`, `@section:` and `@thread:` mentions as
 * typed: what the rename editor holds and what saving compares against.
 * `displayTitle` has the mentions resolved to names, so saving it back would
 * store the names in their place. A thread with no stored title falls back to
 * what bb shows for it.
 */
export function storedTitle(thread: Pick<PluginSidebarThread, "title" | "displayTitle">): string {
  return thread.title ?? thread.displayTitle;
}
