/**
 * The one timer. Each key (a thread tree, the reconciliation check, the host
 * keep-alive) holds the moment it is next due; a single `setTimeout` is set for
 * the earliest, so nothing runs between due times. Times are on the plugin's
 * clock, and `reset` sets the timer again after the drive harness moves it.
 */
import type { Clock } from "../core/clock";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** setTimeout's longest wait; a later due time is waited for in steps. */
const MAX_WAIT_MS = 2 ** 31 - 1;

export class Scheduler {
  private readonly due = new Map<string, number>();
  private handle: unknown = null;
  private armedFor: number | null = null;
  private stopped = false;

  constructor(
    private readonly clock: Clock,
    private readonly fire: (keys: string[]) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** Sets when `key` is next due; null clears it. */
  set(key: string, at: number | null): void {
    if (at === null) this.due.delete(key);
    else this.due.set(key, at);
    this.arm();
  }

  get(key: string): number | null {
    return this.due.get(key) ?? null;
  }

  /** The earliest due time, or null. */
  next(): number | null {
    let min: number | null = null;
    for (const at of this.due.values()) if (min === null || at < min) min = at;
    return min;
  }

  /** Sets the timer again, as after the clock moved. */
  reset(): void {
    this.armedFor = null;
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }

  size(): number {
    return this.due.size;
  }

  private arm(): void {
    if (this.stopped) return;
    const next = this.next();
    if (next === this.armedFor && this.handle !== null) return;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
    this.armedFor = next;
    if (next === null) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, next - this.clock.now()));
    this.handle = this.timers.set(() => this.run(), wait);
  }

  private run(): void {
    this.handle = null;
    this.armedFor = null;
    const now = this.clock.now();
    const keys: string[] = [];
    for (const [key, at] of this.due) {
      if (at <= now) {
        keys.push(key);
        this.due.delete(key);
      }
    }
    this.arm();
    if (keys.length > 0) this.fire(keys);
  }
}
