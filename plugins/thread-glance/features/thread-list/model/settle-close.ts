// Which open child lists a settle closes: when a root is settled, the root and
// every thread below it lose theirs. Pure.
import type { Shelf } from "@/shared/lifecycle";
import { treeIds } from "@/shared/thread-tree";
import type { ListModel } from "./list-model";

/** Each root's settle mark (`settledAt`, null for none) as of the last model it was not held on a shelf in. */
export type SettleMarks = ReadonlyMap<string, number | null>;

export const NO_MARKS: SettleMarks = new Map();

/**
 * The marks `model` shows, except for the roots in `held`, which keep the one
 * they had in `marks`: a rename holds a root on its shelf while its row goes
 * on changing, and the mark it held before is what a later settle differs from.
 */
export function settleMarksOf(model: ListModel, marks: SettleMarks, held: ReadonlyMap<string, Shelf>): SettleMarks {
  const next = new Map<string, number | null>();
  for (const row of model.rows.values()) next.set(row.id, held.has(row.id) ? (marks.get(row.id) ?? null) : (row.lifecycle?.settledAt ?? null));
  return next;
}

/**
 * The open parents among the roots that `next` has on Settled and `previous`
 * had on another shelf, with every thread below them, where the root's settle
 * mark is not the one in `marks`: a settled thread that works for a while and
 * comes back, or one that is unpinned, was not settled again. A model without
 * a previous one, or a root it did not hold, closes nothing: a tree that is
 * already Settled when the list loads keeps what was opened there.
 */
export function parentsToClose(previous: ListModel | null, next: ListModel, openParents: readonly string[], marks: SettleMarks): string[] {
  if (previous === null || openParents.length === 0) return [];
  const open = new Set(openParents);
  const threads = [...next.rows.values()].map((row) => row.thread);
  const closed = new Set<string>();
  for (const row of next.rows.values()) {
    if (row.shelf !== "settled") continue;
    const before = previous.rows.get(row.id);
    if (before === undefined || before.shelf === null || before.shelf === "settled") continue;
    if ((marks.get(row.id) ?? null) === (row.lifecycle?.settledAt ?? null)) continue;
    for (const id of treeIds(threads, row.id)) if (open.has(id)) closed.add(id);
  }
  return [...closed];
}
