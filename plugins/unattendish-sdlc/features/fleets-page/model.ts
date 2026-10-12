// What the Fleets page says, decided from its view alone.
import type { FleetsView, LandedRowView } from "@/src/fleet/application/views";
import { dateLabel } from "@/shared/format";

/** The header's count: what waits on the operator, which the server counts (Inbox rows and fleet halves that need an account), and nothing at zero. */
export function headerCount(view: Pick<FleetsView, "waiting"> | null): string | null {
  return view === null || view.waiting <= 0 ? null : String(view.waiting);
}

/** The header's count as a sentence for assistive technology. */
export function headerCountLabel(waiting: number): string {
  return `${waiting} waiting on you`;
}

/** True where the Inbox table has something to draw; with nothing in it and a fleet needing an account, the table's "Nothing waits on you" would contradict the list above it. */
export function showsInbox(view: Pick<FleetsView, "inbox" | "unreadableInbox" | "needsAccount">): boolean {
  return view.inbox.length > 0 || view.unreadableInbox.length > 0 || view.needsAccount.length === 0;
}

export const NO_FLEET_TEXT = "No fleet is registered. A fleet appears here once";
export const NO_FLEET_COMMAND = "/run-fleet";
export const NO_FLEET_TAIL = "from unattendish-sdlc runs with this plugin installed.";
export const NO_LANDED_TEXT = "Nothing landed in the last 7 days";

export function landedDate(row: Pick<LandedRowView, "merged">): string {
  return dateLabel(row.merged);
}
