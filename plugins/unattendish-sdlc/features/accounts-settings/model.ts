// What the settings section says and asks, decided from the accounts view and the interval typed.
import type { AccountSettingView, CredentialSettingView } from "@/src/fleet/application/views";
import { daysWarning } from "@/shared/card-model";
import type { ConnectRequest } from "@/shared/connect/requests";
import { dateLabel } from "@/shared/format";

/** The shortest poll interval the server accepts. */
export const MIN_INTERVAL_SECONDS = 30;

/** `default for github.com, linear:`; null for an account that is no place's default. */
export function defaultText(account: Pick<AccountSettingView, "defaultFor">): string | null {
  return account.defaultFor.length === 0 ? null : `default for ${account.defaultFor.join(", ")}`;
}

/** What a credential's expiry reads as: refused by the service, expiring on a date, or no expiry reported. */
export function expiryText(credential: Pick<CredentialSettingView, "refused" | "expiresAt">): string {
  if (credential.refused) return "refused by the service";
  return credential.expiresAt === null ? "no expiry reported" : `expires ${dateLabel(credential.expiresAt)}`;
}

/** The warning a credential expiring within the window carries; null otherwise. */
export function expiryWarning(credential: Pick<CredentialSettingView, "expiresInDays">): { text: string; tone: "warning" | "destructive" } | null {
  return credential.expiresInDays === null ? null : daysWarning(credential.expiresInDays);
}

/** The fleets that read with a credential, or that none does. */
export function usedByText(credential: Pick<CredentialSettingView, "fleets">): string {
  return credential.fleets.length === 0 ? "no fleet reads with it" : `read by ${credential.fleets.join(", ")}`;
}

/** What Renew does for a credential: open the popup for it, show the command a login needs, or nothing while it is neither expiring nor refused. */
export type RenewOffer = { readonly kind: "popup"; readonly request: ConnectRequest } | { readonly kind: "command"; readonly command: string } | null;

export function renewOffer(account: Pick<AccountSettingView, "id" | "service" | "place">, credential: CredentialSettingView): RenewOffer {
  if (credential.expiresInDays === null && !credential.refused) return null;
  const { renew } = credential;
  if (renew.kind === "login") return { kind: "command", command: renew.command };
  const owner = renew.kind === "create" && renew.owner !== null ? { owner: renew.owner } : {};
  return { kind: "popup", request: { target: { service: account.service, place: account.place, ...owner }, account: account.id, replaces: credential.id } };
}

/** Add token for another owner: the popup opens at the token step for the account, asking only the owner. */
export function addTokenRequest(account: Pick<AccountSettingView, "id" | "service" | "place">): ConnectRequest {
  return { target: { service: account.service, place: account.place }, account: account.id };
}

/** Add account opens the popup with no fleet. */
export const ADD_ACCOUNT: ConnectRequest = { target: {} };

/** The interval typed in seconds: a whole number, or null. */
export function parseSeconds(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Why an interval cannot be sent, or null. A refusal under 30 seconds is made here, before anything is sent. */
export function intervalProblem(text: string): string | null {
  const seconds = parseSeconds(text);
  if (seconds === null) return "Enter a whole number of seconds.";
  if (seconds < MIN_INTERVAL_SECONDS) return `The poll interval must be at least ${MIN_INTERVAL_SECONDS} seconds.`;
  return null;
}

export const secondsText = (intervalMs: number): string => String(Math.round(intervalMs / 1000));
