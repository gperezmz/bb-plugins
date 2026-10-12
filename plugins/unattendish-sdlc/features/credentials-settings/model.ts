// What the settings section checks and says, decided from the form alone.
import type { CredentialDraft, CredentialSettingView } from "@/src/fleet/application/views";
import { credentialKind } from "@/shared/credentials";
import { dateLabel } from "@/shared/format";

/** The shortest poll interval the server accepts. */
export const MIN_INTERVAL_SECONDS = 30;

export type Auth = CredentialDraft["auth"];

export const AUTH_CHOICES: readonly { readonly id: Auth; readonly label: string }[] = [
  { id: "token", label: credentialKind("token") },
  { id: "gh", label: credentialKind("gh") },
  { id: "glab", label: credentialKind("glab") },
];

export const SERVICE_CHOICES = ["", "github", "gitlab", "linear", "jira"] as const;

/** What the form holds while a credential is added or edited. The token is write-only: it is never filled from the server. */
export interface Form {
  /** The prefix of the entry being edited; null when adding. */
  readonly was: string | null;
  readonly prefix: string;
  readonly auth: Auth;
  readonly service: string;
  readonly baseUrl: string;
  readonly token: string;
}

export const emptyForm = (): Form => ({ was: null, prefix: "", auth: "token", service: "", baseUrl: "", token: "" });

export function formFrom(setting: CredentialSettingView): Form {
  return { was: setting.prefix, prefix: setting.prefix, auth: setting.auth, service: setting.service ?? "", baseUrl: setting.baseUrl ?? "", token: "" };
}

/** Why the form cannot be sent yet, or null. */
export function formProblem(form: Form): string | null {
  if (form.prefix.trim() === "") return "Enter the prefix the credential applies to.";
  if (form.auth === "token" && form.was === null && form.token.trim() === "") return "Paste the token.";
  return null;
}

/** The call for a form: empty optional fields are left out, and a blank token leaves the stored one as it is. */
export function draftFrom(form: Form): CredentialDraft {
  const service = form.service.trim();
  const baseUrl = form.baseUrl.trim();
  return {
    ...(form.was !== null ? { was: form.was } : {}),
    prefix: form.prefix.trim(),
    auth: form.auth,
    ...(service !== "" ? { service } : {}),
    ...(baseUrl !== "" ? { baseUrl } : {}),
    ...(form.auth === "token" && form.token.trim() !== "" ? { token: form.token.trim() } : {}),
  };
}

/** A listed credential's parts: its kind, expiry where known, and whether a token is stored. */
export function settingParts(setting: CredentialSettingView): string[] {
  return [
    credentialKind(setting.auth),
    ...(setting.auth === "token" ? [setting.hasToken ? "token stored" : "no token stored"] : []),
    ...(setting.expiresAt !== null ? [`expires ${dateLabel(setting.expiresAt)}`] : []),
  ];
}

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
