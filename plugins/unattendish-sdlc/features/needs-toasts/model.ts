// What a toast for a fleet that newly needs an account says, decided from the realtime signal alone.
import type { FleetNeedsSignal } from "@/src/fleet/application/views";
import { expiredLine } from "@/shared/card-model";
import type { ConnectRequest } from "@/shared/connect/requests";

/** The expired token a signal carries, or null for a payload that carries none or a malformed one. */
function parseExpired(value: unknown): FleetNeedsSignal["expired"] {
  if (typeof value !== "object" || value === null) return null;
  const { label, accountId, credentialId, expiresAt } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof accountId !== "string" || typeof credentialId !== "string" || typeof expiresAt !== "string") return null;
  return { label, accountId, credentialId, expiresAt };
}

/** Reads a realtime payload as the signal the server publishes; null for anything else. */
export function parseFleetNeeds(payload: unknown): FleetNeedsSignal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { fleet, managerThreadId, role, text, expired } = payload as Record<string, unknown>;
  if (typeof fleet !== "string" || typeof managerThreadId !== "string" || typeof text !== "string") return null;
  if (role !== "forge" && role !== "tracker") return null;
  return { fleet, managerThreadId, role, text, expired: parseExpired(expired) };
}

/** One toast per fleet half, so a signal delivered twice raises one. */
export const toastId = (signal: Pick<FleetNeedsSignal, "fleet" | "role">): string => `needs:${signal.fleet}:${signal.role}`;

/** The toast's title: `other-org/x can't be read`. */
export const toastTitle = (signal: Pick<FleetNeedsSignal, "fleet">): string => `${signal.fleet} can't be read`;

/** The line under the title: what the half needs, or, for a token refused because it has expired, that it expired. */
export const toastDescription = (signal: Pick<FleetNeedsSignal, "text" | "expired">, now: string): string =>
  signal.expired === null ? signal.text : `${signal.expired.label}: ${expiredLine(signal.expired.expiresAt, now)}`;

/** The toast's button: Renew… for a token refused because it has expired, which renews that token; Connect… for the half otherwise. */
export const toastAction = (signal: Pick<FleetNeedsSignal, "fleet" | "role" | "expired">): { readonly label: "Connect…" | "Renew…"; readonly request: ConnectRequest } => {
  const target = { fleet: signal.fleet, role: signal.role };
  return signal.expired === null
    ? { label: "Connect…", request: { target } }
    : { label: "Renew…", request: { target, account: signal.expired.accountId, replaces: signal.expired.credentialId } };
};
