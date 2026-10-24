// What the thread menu needs to know about a thread to decide which lifecycle
// actions to offer: a few flags worked out by the shared rules, so the menu's
// data keeps its identity while a thread changes in ways the menu ignores.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isBusy } from "@/shared/busy";
import { isWoke, markShelf, type LifecycleRow, type MarkShelf } from "@/shared/lifecycle";
import { canNotifyParent } from "./notify";

export interface MenuFacts {
  /** One busy rule decides: the thread is working, waiting for input, or has queued work. */
  busy: boolean;
  /** The thread woke from a snooze and its Woke marker is still up. */
  woke: boolean;
  /** The shelf the thread's lifecycle row alone puts it on. */
  mark: MarkShelf;
  /** The branch the thread works on, or null. */
  branch: string | null;
  /** Whether the thread is a child whose outcomes bb reports to its parent: it has a parent and is no fork. */
  notifiable: boolean;
}

export function menuFactsOf(thread: PluginSidebarThread, row: LifecycleRow | null, now: number): MenuFacts {
  return {
    busy: isBusy(thread),
    woke: isWoke(row, thread, now),
    mark: markShelf(row, thread, now),
    branch: thread.environment?.branchName ?? null,
    notifiable: canNotifyParent(thread),
  };
}

function same(a: MenuFacts, b: MenuFacts): boolean {
  return a.busy === b.busy && a.woke === b.woke && a.mark === b.mark && a.branch === b.branch && a.notifiable === b.notifiable;
}

/**
 * `next` with every entry that equals `previous`'s replaced by `previous`'s
 * object, and `previous` itself when nothing differs, so a consumer comparing
 * by identity sees no change.
 */
export function shareFacts(
  previous: ReadonlyMap<string, MenuFacts>,
  next: ReadonlyMap<string, MenuFacts>,
): ReadonlyMap<string, MenuFacts> {
  let unchanged = previous.size === next.size;
  const shared = new Map<string, MenuFacts>();
  for (const [id, facts] of next) {
    const before = previous.get(id);
    if (before !== undefined && same(before, facts)) shared.set(id, before);
    else {
      shared.set(id, facts);
      unchanged = false;
    }
  }
  return unchanged ? previous : shared;
}
