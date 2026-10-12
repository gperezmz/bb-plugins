// Tells every open bb window, over bb's realtime channel, that something the
// pages show changed. A signal carries no state: the pages refetch.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Clock, DashboardEvents } from "../application/ports";
import { BOARD_CHANGED, INBOX_NEW, type InboxNewSignal } from "../application/views";

/** Every open window rebuilds every fleet on `board-changed`, so it is published at most this often. */
export const BOARD_CHANGED_EVERY_MS = 1_000;

/** Runs `work` after `ms`, without holding the process open. */
export type Schedule = (work: () => void, ms: number) => void;

const unrefTimeout: Schedule = (work, ms) => {
  setTimeout(work, ms).unref();
};

export class BbDashboardEvents implements DashboardEvents {
  private lastBoardAt = Number.NEGATIVE_INFINITY;
  private boardPending = false;

  constructor(
    private readonly realtime: BbPluginApi["realtime"],
    private readonly log: { warn(message: string): void },
    private readonly clock: Clock,
    private readonly schedule: Schedule = unrefTimeout,
  ) {}

  /**
   * Publishes at once when none went out in the last second, else once more when the second is up: a burst of changes
   * is one signal first and one trailing, so the last change is never lost and none is announced twice in a second.
   */
  boardChanged(): void {
    const sinceLast = this.clock.now().getTime() - this.lastBoardAt;
    if (sinceLast >= BOARD_CHANGED_EVERY_MS) {
      this.lastBoardAt = this.clock.now().getTime();
      this.publish(BOARD_CHANGED, null);
      return;
    }
    if (this.boardPending) return;
    this.boardPending = true;
    this.schedule(() => {
      this.boardPending = false;
      this.lastBoardAt = this.clock.now().getTime();
      this.publish(BOARD_CHANGED, null);
    }, BOARD_CHANGED_EVERY_MS - sinceLast);
  }

  inboxNew(signal: InboxNewSignal): void {
    this.publish(INBOX_NEW, signal);
  }

  /** A signal that cannot be sent costs the pages a refresh, never the poll that raised it. */
  private publish(channel: string, payload: unknown): void {
    try {
      this.realtime.publish(channel, payload);
    } catch {
      this.log.warn(`could not publish on ${channel}`);
    }
  }
}
