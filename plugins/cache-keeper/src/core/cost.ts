/** The dollar cost of transcript requests, for a check-in's share of the cost stop. */
import { cacheRatesOf } from "./line";
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
