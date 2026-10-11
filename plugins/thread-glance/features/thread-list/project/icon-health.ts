// How long an unreadable project icon waits before it is tried again: 15 s,
// then 30 s and onward, up to 10 minutes. Pure.

export const RETRY_BASE_MS = 15_000;
export const RETRY_MAX_MS = 10 * 60_000;

/** The wait after the `count`th failure in a row. */
export function retryDelay(count: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, count - 1), RETRY_MAX_MS);
}

export class IconHealth {
  private failures = new Map<string, number>();

  /** Notes a failure for the project and returns how long to wait before the next try. */
  failed(projectId: string): number {
    const count = (this.failures.get(projectId) ?? 0) + 1;
    this.failures.set(projectId, count);
    return retryDelay(count);
  }

  loaded(projectId: string): void {
    this.failures.delete(projectId);
  }

  clear(): void {
    this.failures.clear();
  }
}
