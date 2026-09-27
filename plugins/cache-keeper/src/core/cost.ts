/** Dollar estimates of what Cache Keeper sends. */
import { SUMMARY_TOKENS, type Rates } from "./line";
import type { ModelPrice } from "./pricing";
import type { TranscriptRequest } from "./transcript";

/** A compaction reads the context warm and writes a summary: r·C + o·S. */
export const compactionUsd = (rates: Rates, context: number) => rates.r * context + rates.o * SUMMARY_TOKENS;

/** The cost of transcript requests at `price`; cache rates missing from the list are taken from input. */
export function requestsUsd(requests: readonly TranscriptRequest[], price: ModelPrice): number {
  let usd = 0;
  for (const r of requests) {
    usd +=
      r.input * price.input +
      r.output * price.output +
      r.cacheRead * (price.cacheRead ?? 0.1 * price.input) +
      r.cacheWrite5m * (price.cacheWrite ?? 1.25 * price.input) +
      r.cacheWrite1h * (price.cacheWrite1h ?? 2 * price.input);
  }
  return usd;
}
