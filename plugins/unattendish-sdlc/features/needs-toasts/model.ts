// What a toast for a fleet that newly needs an account says, decided from the realtime signal alone.
import type { FleetNeedsSignal } from "@/src/fleet/application/views";

/** Reads a realtime payload as the signal the server publishes; null for anything else. */
export function parseFleetNeeds(payload: unknown): FleetNeedsSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { fleet, managerThreadId, role, text } = payload as Record<string, unknown>;
  if (typeof fleet !== "string" || typeof managerThreadId !== "string" || typeof text !== "string") return null;
  if (role !== "forge" && role !== "tracker") return null;
  return { fleet, managerThreadId, role, text };
}

/** One toast per fleet half, so a signal delivered twice raises one. */
export const toastId = (signal: Pick<FleetNeedsSignal, "fleet" | "role">): string => `needs:${signal.fleet}:${signal.role}`;

/** The toast's title: `other-org/x can't be read`. */
export const toastTitle = (signal: Pick<FleetNeedsSignal, "fleet">): string => `${signal.fleet} can't be read`;
