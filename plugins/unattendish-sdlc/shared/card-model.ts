// What a fleet's warnings and tracker say, decided from the card's view alone.
import type { WarningView } from "@/src/fleet/application/views";
import { expiredAgoText, plural, polledLabel } from "./format";

export interface WarningLine {
  readonly text: string;
  /** The credential it is about, or `polling`. */
  readonly label: string;
}

export function warningLine(warning: WarningView, now: string): WarningLine {
  switch (warning.kind) {
    case "shares-rate-limit":
      return { text: "shares the agents' rate limit", label: warning.label };
    case "expires":
      return { text: `token expires in ${plural(warning.daysLeft, "day")}`, label: warning.label };
    case "polling-late":
      return { text: `polling is late: ${polledLabel(warning.lastPolledAt, now)}`, label: "polling" };
    case "never-polled":
      return { text: "not polled yet", label: "polling" };
  }
}

/** What an expired token says: `GitHub · yuser for acme: token expired 2 days ago`, counted in the viewer's calendar days. */
export function expiredLine(label: string, expiresAt: string, now: string): string {
  return `${label}: token ${expiredAgoText(expiresAt, now)}`;
}

/** The tracker where it is a service of its own, with the key the board names it by: Linear's team key or Jira's project key. */
export function trackerOf(tracker: string): { readonly service: "linear" | "jira"; readonly key: string } | null {
  const linear = /^linear:(.+)$/.exec(tracker);
  if (linear !== null) return { service: "linear", key: linear[1]! };
  const jira = /^jira:.+\/([^/]+)$/.exec(tracker);
  return jira === null ? null : { service: "jira", key: jira[1]! };
}
