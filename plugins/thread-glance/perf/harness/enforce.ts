// What fails a run: a ledger row missed, among the rows that run
// takes. `npm test` takes the deterministic rows (and the deterministic part
// of a row of kind "both"); `npm run perf` takes every row.
import type { Figures } from "../figures";
import { evaluate, failures, type Kind } from "../ledger";

export function missedBudgets(figures: Figures, kinds: readonly Kind[]): string[] {
  return failures(evaluate(figures).filter((verdict) => kinds.includes(verdict.row.kind)));
}
