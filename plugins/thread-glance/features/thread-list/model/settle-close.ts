// Which open child lists a settle closes: when a root is settled, the root and
// every thread below it lose theirs. Pure.
import { treeIds } from "@/shared/thread-tree";
import type { ListModel } from "./list-model";

/**
 * The open parents among the roots that `next` has on Settled and `previous`
 * had on another shelf, with every thread below them, where the root's
 * settle mark is not the one `previous` held: a settled thread that works
 * for a while and comes back, or one that is unpinned, was not settled again.
 * A model without a previous one, or a root it did not hold, closes nothing:
 * a tree that is already Settled when the list loads keeps what was opened
 * there.
 */
export function parentsToClose(previous: ListModel | null, next: ListModel, openParents: readonly string[]): string[] {
  if (previous === null || openParents.length === 0) return [];
  const open = new Set(openParents);
  const threads = [...next.rows.values()].map((row) => row.thread);
  const closed = new Set<string>();
  for (const row of next.rows.values()) {
    if (row.shelf !== "settled") continue;
    const before = previous.rows.get(row.id);
    if (before === undefined || before.shelf === null || before.shelf === "settled") continue;
    if ((before.lifecycle?.settledAt ?? null) === (row.lifecycle?.settledAt ?? null)) continue;
    for (const id of treeIds(threads, row.id)) if (open.has(id)) closed.add(id);
  }
  return [...closed];
}
