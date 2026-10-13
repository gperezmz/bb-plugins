// What a fleet's warnings and tracker say, decided from the card's view alone.
import type { WarningView } from "@/src/fleet/application/views";
import { plural, polledLabel } from "./format";

export interface WarningLine {
  readonly text: string;
  /** The credential it is about, or `polling`. */
  readonly label: string;
  /** `destructive` for a credential already expired, `warning` otherwise. */
  readonly tone: "warning" | "destructive";
}

/** What days left on a token warn: expired, expiring today, or expiring in so many days. */
export function daysWarning(daysLeft: number): Pick<WarningLine, "text" | "tone"> {
  if (daysLeft < 0) return { text: `token expired ${plural(-daysLeft, "day")} ago`, tone: "destructive" };
  if (daysLeft === 0) return { text: "token expires today", tone: "warning" };
  return { text: `token expires in ${plural(daysLeft, "day")}`, tone: "warning" };
}

export function warningLine(warning: WarningView, now: string): WarningLine {
  switch (warning.kind) {
    case "shares-rate-limit":
      return { text: "shares the agents' rate limit", label: warning.label, tone: "warning" };
    case "expires":
      return { ...daysWarning(warning.daysLeft), label: warning.label };
    case "polling-late":
      return { text: `polling is late: ${polledLabel(warning.lastPolledAt, now)}`, label: "polling", tone: "warning" };
    case "never-polled":
      return { text: "not polled yet", label: "polling", tone: "warning" };
  }
}

/** The tracker where it is a service of its own, with the key the board names it by: Linear's team key or Jira's project key. */
export function trackerOf(tracker: string): { readonly service: "linear" | "jira"; readonly key: string } | null {
  const linear = /^linear:(.+)$/.exec(tracker);
  if (linear !== null) return { service: "linear", key: linear[1]! };
  const jira = /^jira:.+\/([^/]+)$/.exec(tracker);
  return jira === null ? null : { service: "jira", key: jira[1]! };
}
