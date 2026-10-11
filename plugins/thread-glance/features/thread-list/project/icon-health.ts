// Whether a project's icon loads. A failure is shared by every row of the
// project and retried with a growing wait: 15 s, then 30 s and onward, up to
// 10 minutes. Pure over an injected clock.

export const RETRY_BASE_MS = 15_000;
export const RETRY_MAX_MS = 10 * 60_000;

/** The wait after the `count`th failure in a row. */
export function retryDelay(count: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, count - 1), RETRY_MAX_MS);
}

export interface IconFailure {
  count: number;
  retryAt: number;
}

export class IconHealth {
  private failures = new Map<string, IconFailure>();

  /**
   * Notes that attempt number `attempt` (counted from 0) for the project failed. Every row of
   * a project sees the same failed request, so a failure is counted once per attempt.
   */
  failed(projectId: string, attempt: number, now: number): void {
    if ((this.failures.get(projectId)?.count ?? 0) !== attempt) return;
    const count = attempt + 1;
    this.failures.set(projectId, { count, retryAt: now + retryDelay(count) });
  }

  loaded(projectId: string): void {
    this.failures.delete(projectId);
  }

  /** The failures in a row so far; the next attempt's number. */
  attempt(projectId: string): number {
    return this.failures.get(projectId)?.count ?? 0;
  }

  /** When the icon may be tried again, or null while it is not waiting. */
  retryAt(projectId: string, now: number): number | null {
    const failure = this.failures.get(projectId);
    return failure !== undefined && failure.retryAt > now ? failure.retryAt : null;
  }

  clear(): void {
    this.failures.clear();
  }
}

/** The window's health of project icons: one per window, shared by every row. */
export const iconHealth = new IconHealth();
