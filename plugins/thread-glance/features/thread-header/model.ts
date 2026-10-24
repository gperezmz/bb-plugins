// What the thread header's Parent and Children buttons say. Pure.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Settings } from "@/shared/settings";
import { childComparator, isListed } from "../thread-list";

/** The thread's parent, when bb lists it. */
export function parentOf(threads: readonly PluginSidebarThread[], threadId: string): PluginSidebarThread | null {
  const parentId = threads.find((thread) => thread.id === threadId)?.parentThreadId ?? null;
  if (parentId === null) return null;
  const parent = threads.find((thread) => thread.id === parentId);
  return parent !== undefined && isListed(parent) ? parent : null;
}

/** The thread's direct, non-archived children, sorted by the Child threads settings. */
export function directChildren(threads: readonly PluginSidebarThread[], threadId: string, settings: Pick<Settings, "childOrder" | "childDirection">): PluginSidebarThread[] {
  return threads.filter((thread) => thread.parentThreadId === threadId && isListed(thread)).sort(childComparator(settings));
}

/** "Needs you" when a direct child needs you, else "N child" or "N children". */
export function childrenLabel(children: readonly PluginSidebarThread[]): string {
  if (children.some((child) => child.hasPendingInteraction || child.indicator === "waiting-for-input")) return "Needs you";
  return `${children.length} ${children.length === 1 ? "child" : "children"}`;
}

/** What the parent button says before the parent's title. */
export const BACK_TO_PARENT = "Back to parent: ";

export function backToParentLabel(parent: Pick<PluginSidebarThread, "displayTitle">): string {
  return `${BACK_TO_PARENT}${parent.displayTitle}`;
}
