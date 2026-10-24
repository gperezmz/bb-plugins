// What you have seen of a thread that bb does not mark as read: its own
// question or approval, and a queued message that failed to send. Compact all
// threads folds such a thread again once you have opened it, though the
// question or the failure still waits. bb clears neither on opening, so the
// list keeps them itself, on this device, until each clears.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { share } from "./share";

/** What waiting on a thread you can have seen. */
export type SeenKind = "question" | "queued-failed";

type AttentionThread = Pick<PluginSidebarThread, "id" | "hasPendingInteraction" | "indicator">;

/** The entry `seenAttention` keeps for `kind` on `threadId`. */
export function seenKey(kind: SeenKind, threadId: string): string {
  return `${kind}:${threadId}`;
}

function waitingKeys(thread: AttentionThread): string[] {
  const keys: string[] = [];
  if (thread.hasPendingInteraction) keys.push(seenKey("question", thread.id));
  if (thread.indicator === "queued-failed") keys.push(seenKey("queued-failed", thread.id));
  return keys;
}

/**
 * `previous` with what waits on the open thread added, and every entry whose
 * question or failure no longer waits dropped, so the next one unfolds the
 * thread again. Returns `previous` itself when nothing changed.
 */
export function seenAttention(
  previous: ReadonlySet<string>,
  threads: readonly AttentionThread[],
  activeThreadId: string | null,
): ReadonlySet<string> {
  const waiting = new Set(threads.flatMap(waitingKeys));
  const next = new Set([...previous].filter((key) => waiting.has(key)));
  const open = activeThreadId === null ? undefined : threads.find((thread) => thread.id === activeThreadId);
  if (open !== undefined) for (const key of waitingKeys(open)) next.add(key);
  return share<ReadonlySet<string>>(previous, next);
}
