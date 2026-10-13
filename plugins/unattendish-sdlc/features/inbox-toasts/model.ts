// What a toast for a new Inbox row says, decided from the realtime signal alone.
import type { InboxNewSignal } from "@/src/fleet/application/views";
import { rowKey, waitsForText } from "@/shared/inbox/row-model";
import { itemTitle } from "@/shared/item-title";

type WaitsFor = InboxNewSignal["waitsFor"];
type Forge = InboxNewSignal["forge"];
const WAITS_FOR: readonly WaitsFor[] = ["answer", "grant", "ready", "other"];
const FORGES: readonly Forge[] = ["github", "gitlab"];

/** Reads a realtime payload as the signal the server publishes; null for anything else. */
export function parseInboxNew(payload: unknown): InboxNewSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { fleet, ref, what, rowId, waitsFor, forge } = payload as Record<string, unknown>;
  if (typeof fleet !== "string" || typeof ref !== "string" || typeof what !== "string" || typeof rowId !== "string") return null;
  if (!WAITS_FOR.includes(waitsFor as WaitsFor) || !FORGES.includes(forge as Forge)) return null;
  return { fleet, ref, what, rowId, waitsFor: waitsFor as WaitsFor, forge: forge as Forge };
}

/** The toast's id: the fleet and the row, so one row raises one toast and two fleets' rows that say the same raise two. */
export function toastId(signal: Pick<InboxNewSignal, "fleet" | "rowId">): string {
  return rowKey({ fleet: signal.fleet, id: signal.rowId });
}

/** The toast's title: the item's ref and title, `#7 Which cache to use`; a Ref of `—` is left out. */
export function toastTitle(signal: Pick<InboxNewSignal, "ref" | "what">): string {
  return itemTitle(signal.ref, signal.what);
}

/** The line under the title: `org/dash waits for your answer`. */
export function toastLine(signal: Pick<InboxNewSignal, "fleet" | "waitsFor">): string {
  return `${signal.fleet} waits for ${waitsForText(signal.waitsFor)}`;
}
