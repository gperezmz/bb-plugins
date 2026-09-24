/**
 * Budget hint: the first time a family's total crosses the
 * "Warn above" amount, a crossing is recorded once per family and amount.
 */

export interface Crossing {
  rootThreadId: string;
  amount: number;
  crossedAt: number;
  totalAtCrossing: number;
}

/**
 * Families (by ancestor id) whose total is at or above `amount` and that
 * have no crossing recorded for that amount yet.
 */
export function newCrossings(
  familyTotals: ReadonlyMap<string, number>,
  amount: number | null,
  recorded: ReadonlySet<string>,
  now: number,
): Crossing[] {
  if (amount === null || !(amount > 0)) return [];
  const out: Crossing[] = [];
  for (const [rootThreadId, total] of familyTotals) {
    if (total < amount) continue;
    if (recorded.has(crossingKey(rootThreadId, amount))) continue;
    out.push({ rootThreadId, amount, crossedAt: now, totalAtCrossing: total });
  }
  return out;
}

export function crossingKey(threadId: string, amount: number): string {
  return `${threadId}@${amount}`;
}
