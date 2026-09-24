// Rechecks a machine when it reconnects, at most once per cooldown. A machine
// whose connection flaps would otherwise start a full recheck of itself on
// every reconnect; later reconnects inside the cooldown fold into one
// recheck at its end, so the machine's last state is still checked. A
// recheck the machine dropped out of does not start a cooldown.

/** A reconnect waits this long, so the machine's daemon is ready. */
export const RECONNECT_SETTLE_MS = 3_000;
/** At most one reconnect recheck per machine in this window. */
export const RECONNECT_COOLDOWN_MS = 5 * 60_000;

/** A disconnect this soon after a recheck may have cut it short: it does not count. */
export const RECHECK_CUT_MS = 30_000;

export class ReconnectRechecks {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastRunAt = new Map<string, number>();

  constructor(
    private readonly recheck: (hostId: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * A machine connected: recheck it once it has settled (each reconnect
   * restarts the wait), or at the end of its cooldown.
   */
  connected(hostId: string): void {
    clearTimeout(this.pending.get(hostId));
    const last = this.lastRunAt.get(hostId);
    const delay = Math.max(RECONNECT_SETTLE_MS, last === undefined ? 0 : last + RECONNECT_COOLDOWN_MS - this.now());
    this.pending.set(
      hostId,
      setTimeout(() => {
        this.pending.delete(hostId);
        this.lastRunAt.set(hostId, this.now());
        this.recheck(hostId);
      }, delay),
    );
  }

  /**
   * A machine disconnected: its pending recheck would find it offline, and
   * one that just ran may have. Neither holds back the recheck of its next
   * connection.
   */
  disconnected(hostId: string): void {
    clearTimeout(this.pending.get(hostId));
    this.pending.delete(hostId);
    const last = this.lastRunAt.get(hostId);
    if (last !== undefined && this.now() - last < RECHECK_CUT_MS) this.lastRunAt.delete(hostId);
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
