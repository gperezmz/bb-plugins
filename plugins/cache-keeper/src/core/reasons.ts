/**
 * Why a send that fell due was held back. Each is logged with the thread and
 * what was due, kept as the thread's last decision for `status`, and, when the
 * check made immediately before a send fails, written to history.
 */
export const HOLD_REASONS = {
  "cost-stop": "cost stop",
  "no-price": "no price",
  busy: "thread busy",
  "pending-interaction": "pending interaction",
  "switched-off": "switched off",
  skipped: "skipped",
  never: "Never",
  archived: "archived",
  deleted: "deleted",
  "not-claude-code": "not a Claude Code thread",
  "missing-field": "missing field",
  "already-sent": "already sent",
  "host-offline": "host offline",
  "transcript-unreadable": "transcript unreadable",
  "window-unknown": "window unknown",
} as const;

export type HoldReason = keyof typeof HOLD_REASONS;

/** The reason as `status` and the log word it. */
export const reasonText = (reason: HoldReason) => HOLD_REASONS[reason];
