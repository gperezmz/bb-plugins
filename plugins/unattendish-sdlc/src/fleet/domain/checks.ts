// Combining the outcomes of the checks a service reports for one commit.
import type { ChecksOutcome } from "./model";

/**
 * The outcome of several checks taken together: pending while any is pending,
 * else failed when any failed, else passed. No outcomes at all is `passed`;
 * a source that has no checks for a commit reports none rather than combining
 * an empty list.
 */
export const combineChecks = (outcomes: readonly ChecksOutcome[]): ChecksOutcome => {
  if (outcomes.includes("pending")) return "pending";
  return outcomes.includes("failed") ? "failed" : "passed";
};
