// What the Status slot says, by its precedence: a pending question, a queued
// message, the thread's indicator, and otherwise how long ago it last did
// anything. A status another plugin set on the row takes the place of the
// indicators that do not outrank it. Pure.
import type { PluginSidebarThread, PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";

/** The `bb-` tones are the colours bb gives the tones of a status another plugin set, which are not Thread Glance's own. */
export type StatusTone = "failed" | "needs-you" | "working" | "unread" | "draft" | "muted" | "bb-success" | "bb-running" | "bb-error";

/** The glyph a status draws: a bb icon by name, or the unread dot. */
export type StatusGlyph = { kind: "icon"; name: string; spin?: boolean; shine?: boolean; pulse?: boolean } | { kind: "dot" };

export type StatusKind =
  "needs-you" | "send-failed" | "queued" | "failed" | "unread" | "working" | "monitoring" | "workflow" | "agent" | "command" | "planning" | "goal" | "draft" | "drafting" | "plugin" | "age";

export interface StatusSlot {
  kind: StatusKind;
  /** The text the slot shows, with " · 5m" for work that has run a minute. */
  label: string;
  /** The label for assistive technology: bb's, where it has one, and for a plugin's status the label that plugin gave it. */
  ariaLabel: string;
  tone: StatusTone;
  glyph: StatusGlyph | null;
  /** Live work, whose label carries how long it has run. */
  timed: boolean;
}

export interface StatusInput {
  hasPendingInteraction: boolean;
  queuedWork: PluginSidebarThread["queuedWork"];
  indicator: PluginSidebarThread["indicator"];
  indicatorLabel: string | null;
  /** This client's composer holds an unsent draft for the thread. */
  hasDraft: boolean;
  /** The status another plugin set on the row, or null; null too where the surface does not draw it. */
  rowStatus: PluginSidebarThreadRowStatus | null;
  /** When the thread was first seen working in this stretch of work; null if unknown. */
  workingSince: number | null;
  /** The age is counted from here. */
  lastActivityAt: number;
  now: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "Nm", "Nh", "Nd" up to 7 days, then "Nw"; rounded down. */
export function ageLabel(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / (7 * DAY))}w`;
}

/** `label` with " · 5m" once the work has run a minute. */
export function withElapsed(label: string, since: number | null, now: number): string {
  if (since === null) return label;
  const elapsed = ageLabel(since, now);
  return elapsed === "now" ? label : `${label} · ${elapsed}`;
}

/**
 * bb leaves a composer draft out of `indicator`, because it is per client.
 * A draft joins it the way bb's own row does: working with a draft is
 * "working-draft", a quiet thread with one is "draft", and a failure, a
 * question, an unread result or any other status keeps its own.
 */
export function foldDraft(indicator: PluginSidebarThread["indicator"], hasDraft: boolean): PluginSidebarThread["indicator"] {
  if (!hasDraft) return indicator;
  if (isWorkingIndicator(indicator)) return "working-draft";
  return indicator === "none" ? "draft" : indicator;
}

export function isWorkingIndicator(indicator: PluginSidebarThread["indicator"]): boolean {
  switch (indicator) {
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "working-draft":
      return true;
    default:
      return false;
  }
}

const ICON = (name: string, extra: { spin?: boolean; shine?: boolean; pulse?: boolean } = {}): StatusGlyph => ({ kind: "icon", name, ...extra });

const NEEDS_YOU: Omit<StatusSlot, "ariaLabel"> = {
  kind: "needs-you",
  label: "Needs you",
  tone: "needs-you",
  glyph: ICON("CircleQuestion"),
  timed: false,
};

function of(base: Omit<StatusSlot, "ariaLabel">, ariaLabel: string | null): StatusSlot {
  return { ...base, ariaLabel: ariaLabel ?? base.label };
}

/** The indicator's status, or null for the ones the slot gives no label. */
function indicatorStatus(indicator: PluginSidebarThread["indicator"], indicatorLabel: string | null): Omit<StatusSlot, "ariaLabel"> | null {
  switch (indicator) {
    case "unread-error":
      return { kind: "failed", label: "Failed", tone: "failed", glyph: ICON("CircleX"), timed: false };
    case "waiting-for-input":
      return NEEDS_YOU;
    case "unread-success":
      return { kind: "unread", label: "Unread", tone: "unread", glyph: { kind: "dot" }, timed: false };
    case "runtime": {
      const monitoring = indicatorLabel?.toLocaleLowerCase().includes("monitoring") ?? false;
      return {
        kind: monitoring ? "monitoring" : "working",
        label: monitoring ? "Monitoring" : "Working",
        tone: "working",
        glyph: ICON("Loading", { spin: true }),
        timed: true,
      };
    }
    case "workflow":
      return { kind: "workflow", label: "Workflow", tone: "working", glyph: ICON("Workflow", { shine: true }), timed: true };
    case "background-agent":
      return { kind: "agent", label: "Agent", tone: "working", glyph: ICON("UserRoundPlus", { shine: true }), timed: true };
    case "background-command":
      return { kind: "command", label: "Command", tone: "working", glyph: ICON("Terminal", { shine: true }), timed: true };
    case "plan-mode":
      return { kind: "planning", label: "Planning", tone: "working", glyph: ICON("ListTodo", { shine: true }), timed: true };
    case "goal":
      return { kind: "goal", label: "Goal", tone: "working", glyph: ICON("Target", { shine: true }), timed: true };
    case "draft":
      return { kind: "draft", label: "Draft", tone: "draft", glyph: ICON("Edit"), timed: false };
    case "working-draft":
      return { kind: "drafting", label: "Drafting", tone: "draft", glyph: ICON("Edit"), timed: true };
    default:
      return null;
  }
}

/** Whether the indicator keeps the slot from a plugin's status: work in flight, a failure, or a question. */
function outranksRowStatus(indicator: PluginSidebarThread["indicator"]): boolean {
  return isWorkingIndicator(indicator) || indicator === "unread-error" || indicator === "waiting-for-input";
}

const ROW_STATUS_TONE: Record<NonNullable<PluginSidebarThreadRowStatus["tone"]>, StatusTone> = {
  default: "muted",
  error: "bb-error",
  running: "bb-running",
  success: "bb-success",
};

/** A plugin's status as the slot draws it: bb's icon in bb's colour for its tone, the thread's age beside it. */
function pluginStatus(rowStatus: PluginSidebarThreadRowStatus, age: string): StatusSlot {
  const tone = ROW_STATUS_TONE[rowStatus.tone ?? "default"];
  return {
    kind: "plugin",
    label: age,
    ariaLabel: rowStatus.label,
    tone,
    glyph: ICON(rowStatus.icon, tone === "bb-running" ? { shine: true, pulse: true } : {}),
    timed: false,
  };
}

/** The one thing the Status slot shows. */
export function statusSlot(input: StatusInput): StatusSlot {
  if (input.hasPendingInteraction) return of(NEEDS_YOU, "Needs you");
  if (input.queuedWork === "failed") {
    return of({ kind: "send-failed", label: "Send failed", tone: "failed", glyph: ICON("CircleX"), timed: false }, "A queued message failed to send");
  }
  if (input.queuedWork === "waiting") {
    return of({ kind: "queued", label: "Queued", tone: "draft", glyph: ICON("Clock"), timed: false }, "A message is waiting to send");
  }
  const indicator = foldDraft(input.indicator, input.hasDraft);
  if (input.rowStatus !== null && !outranksRowStatus(indicator)) {
    return pluginStatus(input.rowStatus, ageLabel(input.lastActivityAt, input.now));
  }
  const status = indicatorStatus(indicator, input.indicatorLabel);
  if (status === null) {
    const label = ageLabel(input.lastActivityAt, input.now);
    return { kind: "age", label, ariaLabel: label, tone: "muted", glyph: null, timed: false };
  }
  const label = status.timed ? withElapsed(status.label, input.workingSince, input.now) : status.label;
  return { ...status, label, ariaLabel: input.indicatorLabel ?? label };
}
