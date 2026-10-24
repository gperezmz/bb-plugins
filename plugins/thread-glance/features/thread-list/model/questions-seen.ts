// The threads you have opened while their own question or approval waits,
// which Compact all threads folds again though the question still waits. bb
// marks nothing when a question arrives, so the list keeps them itself, in
// this window, until the question clears.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * `previous` with the open thread added while it asks, and every thread
 * that no longer asks dropped, so its next question unfolds it again.
 * Returns `previous` itself when nothing changed.
 */
export function questionsSeen(
  previous: ReadonlySet<string>,
  threads: readonly Pick<PluginSidebarThread, "id" | "hasPendingInteraction">[],
  activeThreadId: string | null,
): ReadonlySet<string> {
  const asking = new Set(threads.flatMap((thread) => (thread.hasPendingInteraction ? [thread.id] : [])));
  const next = new Set([...previous].filter((id) => asking.has(id)));
  if (activeThreadId !== null && asking.has(activeThreadId)) next.add(activeThreadId);
  return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
}
