// Tells every open bb window, over bb's realtime channel, that something the
// pages show changed. A signal carries no state: the pages refetch.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { DashboardEvents } from "../application/ports";
import { BOARD_CHANGED, INBOX_NEW, type InboxNewSignal } from "../application/views";

export class BbDashboardEvents implements DashboardEvents {
  constructor(
    private readonly realtime: BbPluginApi["realtime"],
    private readonly log: { warn(message: string): void },
  ) {}

  boardChanged(): void {
    this.publish(BOARD_CHANGED, null);
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
