// What a slim row says for its shelf: "Waiting Nd" on Parked and the time
// until the wake on Snoozed. Settled says the Status slot's. Pure.
import { snoozeWakeLabel } from "@/shared/snooze";
import type { RowView } from "./list-model";

const DAY_MS = 86_400_000;

export function shelfLabel(row: Pick<RowView, "shelf" | "lifecycle">, now: number): string | null {
  if (row.shelf === "parked" && row.lifecycle?.parkedAt != null) {
    return `Waiting ${Math.max(0, Math.floor((now - row.lifecycle.parkedAt) / DAY_MS))}d`;
  }
  if (row.shelf === "snoozed" && row.lifecycle?.snoozeUntil != null) return snoozeWakeLabel(row.lifecycle.snoozeUntil, now);
  return null;
}

/** The slim row's restore button: what it is named and which command it runs, by shelf. */
export function restoreAction(shelf: RowView["shelf"]): { name: string; text: string; command: "resume" | "wakeNow" | "unsettle" } | null {
  switch (shelf) {
    case "parked":
      return { name: "Resume thread", text: "Resume", command: "resume" };
    case "snoozed":
      return { name: "Wake thread now", text: "Wake", command: "wakeNow" };
    case "settled":
      return { name: "Un-settle thread", text: "Un-settle", command: "unsettle" };
    default:
      return null;
  }
}
