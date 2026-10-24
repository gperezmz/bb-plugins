// What you have seen of a thread that bb does not mark as read: its own
// question or approval, and a queued message that failed to send. Compact all
// threads folds such a thread again once you have opened it, though the
// question or the failure still waits. bb clears neither on opening, so the
// list keeps them itself, on this device, until each clears.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { share } from "./share";

/** What waiting on a thread you can have seen. */
export type WaitKind = "question" | "queued-failed";

type WaitingThread = Pick<PluginSidebarThread, "id" | "hasPendingInteraction" | "indicator">;

/** The entry `seenWaits` keeps for `kind` on `threadId`. */
export function seenKey(kind: WaitKind, threadId: string): string {
  return `${kind}:${threadId}`;
}

function threadOf(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

function waitingKeys(thread: WaitingThread): string[] {
  const keys: string[] = [];
  if (thread.hasPendingInteraction) keys.push(seenKey("question", thread.id));
  if (thread.indicator === "queued-failed") keys.push(seenKey("queued-failed", thread.id));
  return keys;
}

/**
 * `previous` with what waits on the open thread added, and every entry whose
 * question or failure no longer waits on a thread in `threads` dropped, so the
 * next one unfolds the thread again. An entry for a thread `threads` does not
 * list is kept: another window may list it, as one hidden since before the
 * thread was made does not, and the stored cap drops it in time. Returns
 * `previous` itself when nothing changed.
 */
export function seenWaits(
  previous: ReadonlySet<string>,
  threads: readonly WaitingThread[],
  activeThreadId: string | null,
): ReadonlySet<string> {
  const waiting = new Set(threads.flatMap(waitingKeys));
  const listed = new Set(threads.map((thread) => thread.id));
  const next = new Set([...previous].filter((key) => waiting.has(key) || !listed.has(threadOf(key))));
  const open = activeThreadId === null ? undefined : threads.find((thread) => thread.id === activeThreadId);
  if (open !== undefined) for (const key of waitingKeys(open)) next.add(key);
  return share<ReadonlySet<string>>(previous, next);
}
