/**
 * Arithmetic on figures that the frontend needs too. Kept free of pricing
 * and validation imports so the app bundle stays small.
 */
import type { CostBuckets, Figure } from "./summary";
import { totalTokens } from "./tokens";

export function costTotal(c: CostBuckets): number {
  return c.gateway + c.harness + c.estimate;
}

export function figureTokenCount(f: Pick<Figure, "tokens" | "untrackedTokens">): number {
  return totalTokens(f.tokens) + f.untrackedTokens;
}
