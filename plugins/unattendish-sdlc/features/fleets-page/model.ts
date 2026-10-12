// What the Fleets page says, decided from its view alone.
import type { FleetsView, LandedRowView } from "@/src/fleet/application/views";
import { dateLabel } from "@/shared/format";

/** The header's count: every Inbox row of every fleet, and nothing at zero. */
export function headerCount(view: Pick<FleetsView, "waiting"> | null): string | null {
  return view === null || view.waiting <= 0 ? null : String(view.waiting);
}

/** The header's count as a sentence for assistive technology. */
export function headerCountLabel(waiting: number): string {
  return `${waiting} waiting on you`;
}

export const NO_FLEET_TEXT = "No fleet is registered. A fleet appears here once";
export const NO_FLEET_COMMAND = "/run-fleet";
export const NO_FLEET_TAIL = "from unattendish-sdlc runs with this plugin installed.";
export const NO_LANDED_TEXT = "Nothing landed in the last 7 days";

/** A landed spec in the strip: the item and its title. */
export function landedTitle(row: Pick<LandedRowView, "ref" | "spec">): string {
  return row.ref === "—" || row.ref === "" ? row.spec : `${row.ref} ${row.spec}`;
}

export function landedDate(row: Pick<LandedRowView, "merged">): string {
  return dateLabel(row.merged);
}
