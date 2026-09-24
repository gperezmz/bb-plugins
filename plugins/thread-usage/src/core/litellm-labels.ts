/** Test connection check ids and labels, shared with the frontend. */

export type ConnectionCheckId = "reachable" | "key-valid" | "spend-readable" | "sees-rows";

export const CHECK_LABELS: Record<ConnectionCheckId, string> = {
  reachable: "Gateway URL answers",
  "key-valid": "Read key is valid",
  "spend-readable": "Key may read /spend/logs/v2",
  "sees-rows": "Key sees bb- rows in the last 7 days",
};
