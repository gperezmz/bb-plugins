// Which expanded parents a settle folds: when a root moves onto Settled, the
// root and every thread below it lose their open child lists. Pure.
import type { ListModel } from "./list-model";

/**
 * The expanded parents among the roots that `next` has on Settled and
 * `previous` had on another shelf, with every thread below them. A model
 * without a previous one, or a root it did not hold, folds nothing: a tree
 * that is already Settled when the list loads keeps what was expanded there.
 */
export function parentsToFold(previous: ListModel | null, next: ListModel, expandedParents: readonly string[]): string[] {
  if (previous === null || expandedParents.length === 0) return [];
  const open = new Set(expandedParents);
  const folded: string[] = [];
  const visit = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (open.has(id)) folded.push(id);
    for (const childId of next.rows.get(id)?.children?.ids ?? []) visit(childId, seen);
  };
  for (const row of next.rows.values()) {
    if (row.shelf !== "settled") continue;
    const before = previous.rows.get(row.id)?.shelf ?? null;
    if (before === null || before === "settled") continue;
    visit(row.id, new Set());
  }
  return folded;
}
