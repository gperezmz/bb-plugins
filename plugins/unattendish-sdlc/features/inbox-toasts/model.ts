// What a toast for a new Inbox row says, decided from the realtime signal alone.
import type { InboxNewSignal } from "@/src/fleet/application/views";

/** Reads a realtime payload as the signal the server publishes; null for anything else. */
export function parseInboxNew(payload: unknown): InboxNewSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { fleet, ref, what, rowId } = payload as Record<string, unknown>;
  if (typeof fleet !== "string" || typeof ref !== "string" || typeof what !== "string" || typeof rowId !== "string") return null;
  return { fleet, ref, what, rowId };
}

/** `acme/web waits on you — ENG-212 which locale wins?`; a Ref of `—` is left out. */
export function toastText(signal: Pick<InboxNewSignal, "fleet" | "ref" | "what">): string {
  const row = signal.ref === "—" || signal.ref === "" ? signal.what : `${signal.ref} ${signal.what}`;
  return `${signal.fleet} waits on you — ${row}`;
}
