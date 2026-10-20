/**
 * Arithmetic on figures that the frontend needs too. Kept free of pricing
 * and validation imports so the app bundle stays small.
 */
import type { CostBuckets, Figure } from "./summary";
import { totalTokens } from "./tokens";

export function costTotal(c: CostBuckets): number {
  return c.gateway + c.harness + c.estimate;
}

export function figureTokenCount(f: Pick<Figure, "tokens">): number {
  return totalTokens(f.tokens);
}

/** True when the figure has tokens and every one of them is unpriced. */
export function allTokensUnpriced(f: Pick<Figure, "tokens" | "unpricedTokens">): boolean {
  const tokens = figureTokenCount(f);
  return tokens > 0 && f.unpricedTokens >= tokens;
}
