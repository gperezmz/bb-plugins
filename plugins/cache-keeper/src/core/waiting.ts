/**
 * Whether a thread is waiting on something that will wake it, and what.
 *
 * A thread waits while it has a background command or subagent running, a
 * direct child thread still working or itself waiting, or a queued or
 * scheduled message. A grandchild makes only its own parent wait; the
 * grandparent waits on that child.
 */

/** A thread as the waiting rule reads it. */
export interface WaitThread {
  id: string;
  parentThreadId: string | null;
  status: string;
  archived: boolean;
  deleted: boolean;
  title: string;
  createdAt: number;
  activeBackgroundCommandCount: number;
  activeBackgroundAgentCount: number;
  queuedMessageCount: number;
}

export type WaitItem =
  | { kind: "command"; id: string; description: string; startedAt: number }
  | { kind: "subagent"; id: string; description: string; startedAt: number }
  | { kind: "child"; id: string; title: string; startedAt: number }
  | { kind: "scheduled"; dueAt: number; createdAt: number }
  | { kind: "queued"; createdAt: number };

const KIND_ORDER: Record<WaitItem["kind"], number> = { command: 0, subagent: 1, child: 2, scheduled: 3, queued: 3 };

const createdOf = (item: WaitItem): number => ("startedAt" in item ? item.startedAt : item.createdAt);

/** Background commands, then subagents, then child threads, then queued and scheduled messages; oldest first in each. */
export function orderItems(items: readonly WaitItem[]): WaitItem[] {
  return [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || createdOf(a) - createdOf(b));
}

/** Direct children that make `parentId` wait: working, or themselves waiting. */
export function waitingChildren(parentId: string, threads: readonly WaitThread[]): WaitThread[] {
  const byParent = new Map<string, WaitThread[]>();
  for (const t of threads) {
    if (t.parentThreadId === null || t.archived || t.deleted) continue;
    const list = byParent.get(t.parentThreadId) ?? [];
    list.push(t);
    byParent.set(t.parentThreadId, list);
  }
  const memo = new Map<string, boolean>();
  const waits = (t: WaitThread, seen: Set<string>): boolean => {
    const cached = memo.get(t.id);
    if (cached !== undefined) return cached;
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    const result = ownWork(t) || (byParent.get(t.id) ?? []).some((c) => working(c) || waits(c, seen));
    memo.set(t.id, result);
    return result;
  };
  return (byParent.get(parentId) ?? []).filter((c) => working(c) || waits(c, new Set([parentId])));
}

const working = (t: WaitThread) => t.status !== "idle" && t.status !== "error";
const ownWork = (t: WaitThread) => t.activeBackgroundCommandCount > 0 || t.activeBackgroundAgentCount > 0 || t.queuedMessageCount > 0;

/** Whether `thread` is waiting, from bb's counts and its children. */
export function isWaiting(thread: WaitThread, threads: readonly WaitThread[]): boolean {
  return ownWork(thread) || waitingChildren(thread.id, threads).length > 0;
}
