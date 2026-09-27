/** What Cache Keeper's turns cost, read from transcripts, and what the next keep-warm is expected to. */
import { cacheRatesOf, type Rates } from "./line";
import type { ModelPrice } from "./pricing";
import type { TranscriptRequest } from "./transcript";

/** The cost of transcript requests at `price`. */
export function requestsUsd(requests: readonly TranscriptRequest[], price: ModelPrice): number {
  const cache = cacheRatesOf(price);
  let usd = 0;
  for (const r of requests) {
    usd += r.input * price.input + r.output * price.output + r.cacheRead * cache.read + r.cacheWrite5m * cache.write5m + r.cacheWrite1h * cache.write1h;
  }
  return usd;
}

/** The requests of a turn that ran from `start` to `end`, allowing for the host's clock being a little off bb's. */
export function requestsIn<T extends { at: number }>(requests: readonly T[], start: number, end: number, slackMs = 2_000): T[] {
  return requests.filter((r) => r.at >= start - slackMs && r.at <= end + slackMs);
}

/**
 * The forecast of a keep-warm no earlier one of the thread measured: a warm
 * read of its own context, and of the context of each thread above it that the
 * report will wake.
 */
export function estimateKeepWarmUsd(threads: readonly { rates: Rates | null; context: number | null }[]): number {
  return threads.reduce((sum, t) => sum + (t.rates === null || t.context === null ? 0 : t.rates.r * t.context), 0);
}
