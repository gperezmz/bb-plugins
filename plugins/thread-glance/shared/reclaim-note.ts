// The note a toast adds after Reclaim, and how long the toast lasts.

/** What a Reclaim did, summed over the threads it covered. */
export interface ReclaimReport {
  /** An agent runtime was stopped. */
  stoppedRuntime: boolean;
  /** Terminals that were running and had never had input, now closed. */
  closedTerminals: number;
  /** Terminals left running because someone typed into them. */
  keptTerminals: number;
}

export const EMPTY_RECLAIM: ReclaimReport = Object.freeze({
  stoppedRuntime: false,
  closedTerminals: 0,
  keptTerminals: 0,
});

/** Adds two reports. */
export function addReclaim(left: ReclaimReport, right: ReclaimReport): ReclaimReport {
  return {
    stoppedRuntime: left.stoppedRuntime || right.stoppedRuntime,
    closedTerminals: left.closedTerminals + right.closedTerminals,
    keptTerminals: left.keptTerminals + right.keptTerminals,
  };
}

function terminals(count: number): string {
  return `${count} terminal${count === 1 ? "" : "s"}`;
}

/**
 * The reclaim note: "Agent session stopped", "closed N terminals nobody used"
 * and "N terminals left running" joined with " · ", leaving out what did not
 * happen. Null when nothing did.
 */
export function reclaimNote(report: ReclaimReport): string | null {
  const parts: string[] = [];
  if (report.stoppedRuntime) parts.push("Agent session stopped");
  if (report.closedTerminals > 0) parts.push(`closed ${terminals(report.closedTerminals)} nobody used`);
  if (report.keptTerminals > 0) parts.push(`${terminals(report.keptTerminals)} left running`);
  return parts.length === 0 ? null : parts.join(" · ");
}
