import type { Clock, CostReader } from "./ports";

/** How long a manager's cost is kept, so a refreshed page does not ask Thread Usage again for every fleet. */
export const COST_TTL_MS = 30_000;

/** Remembers each thread's cost, or its absence, for `ttlMs`; a question asked while another for the same thread is out shares its answer. */
export class CachedCost implements CostReader {
  private readonly known = new Map<string, { readonly until: number; readonly answer: Promise<Awaited<ReturnType<CostReader["costOf"]>>> }>();

  constructor(
    private readonly inner: CostReader,
    private readonly clock: Clock,
    private readonly ttlMs: number = COST_TTL_MS,
  ) {}

  costOf(threadId: string): ReturnType<CostReader["costOf"]> {
    const now = this.clock.now().getTime();
    const kept = this.known.get(threadId);
    if (kept !== undefined && kept.until > now) return kept.answer;
    const answer = this.inner.costOf(threadId).catch(() => null);
    this.known.set(threadId, { until: now + this.ttlMs, answer });
    return answer;
  }
}
