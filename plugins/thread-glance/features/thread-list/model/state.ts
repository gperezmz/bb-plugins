// Thread state model and unread rule. Pure functions over the
// sidebar payload; no React.
import type {
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";

export type StateKind =
  | "waits-on-you"
  | "failed"
  | "queue-failed"
  | "offline"
  | "working"
  | "background"
  | "scheduled"
  | "queued"
  | "unread"
  | "draft"
  | "idle";

/** A rollup flag. Set independently of the first-match state. */
export type Flag = "waits-on-you" | "unread-failed" | "queue-failed" | "offline" | "working" | "unread";

/** Flags, most urgent first. */
export const FLAG_ORDER: readonly Flag[] = [
  "waits-on-you",
  "unread-failed",
  "queue-failed",
  "offline",
  "working",
  "unread",
];

/**
 * `working` is bb's timeline accent, so a running thread stands out in both
 * themes; `background` draws background activity in the grey `muted` has,
 * and its glyph shines, which keeps it apart from a draft.
 */
export type Tone = "attention" | "destructive" | "working" | "background" | "muted" | "muted-strong" | "none";

/** What a thread that needs attention is waiting for, from its note. */
export type NeedsKind = "question" | "approval" | "plan" | "input";

const NEEDS: Record<NeedsKind, { icon: string; label: string }> = {
  question: { icon: "CircleQuestion", label: "Asks a question" },
  approval: { icon: "SecurityCheck", label: "Needs approval" },
  plan: { icon: "ListTodo", label: "Plan to review" },
  input: { icon: "MessageQuestion", label: "Needs your input" },
};

/**
 * How a glyph is drawn. `dot` is the unread dot, `ring` the Idle state's
 * faint ring; everything else a host icon.
 */
export interface Glyph {
  icon: string | "dot" | "ring";
  tone: Tone;
  spin: boolean;
  shine: boolean;
}

export interface ThreadState {
  kind: StateKind;
  label: string;
  glyph: Glyph;
  /** Earliest scheduled send time, for the `scheduled` tooltip. */
  sendAt: number | null;
}

const KNOWN_STATUSES = new Set(["pending", "starting", "active", "stopping", "idle", "error"]);
const WORKING_RUNTIME = new Set([
  "provisioning",
  "starting",
  "active",
  "stopping",
  "host-reconnecting",
]);
const KNOWN_RUNTIME = new Set([...KNOWN_STATUSES, ...WORKING_RUNTIME, "waiting-for-host"]);

/** `status`, with unknown values read as idle. */
export function normalizeStatus(thread: Pick<PluginSidebarThread, "status">): string {
  return KNOWN_STATUSES.has(thread.status) ? thread.status : "idle";
}

/** `runtimeStatus`, with unknown values read as the thread's status. */
export function normalizeRuntime(
  thread: Pick<PluginSidebarThread, "status" | "runtimeStatus">,
): string {
  return KNOWN_RUNTIME.has(thread.runtimeStatus) ? thread.runtimeStatus : normalizeStatus(thread);
}

/** `queuedWork`, with unknown values read as none. */
export function normalizeQueued(
  thread: Pick<PluginSidebarThread, "queuedWork">,
): "none" | "waiting" | "failed" {
  return thread.queuedWork === "waiting" || thread.queuedWork === "failed"
    ? thread.queuedWork
    : "none";
}

export function isWorking(thread: Pick<PluginSidebarThread, "status" | "runtimeStatus">): boolean {
  return WORKING_RUNTIME.has(normalizeRuntime(thread));
}

export function isOffline(thread: Pick<PluginSidebarThread, "status" | "runtimeStatus">): boolean {
  return normalizeRuntime(thread) === "waiting-for-host";
}

/** Per-thread facts the host payload doesn't carry. */
export interface ThreadContext {
  activeThreadId: string | null;
  /**
   * Threads shown in a visible pane of the window besides the active one:
   * bb's split panes. Absent, only the active (focused) thread is open.
   */
  openThreadIds?: ReadonlySet<string>;
  /** Stamps, from the plugin server. */
  finishedAt: Readonly<Record<string, number>>;
  seenAt: Readonly<Record<string, number>>;
  /**
   * Threads shown read while their read request is pending: each id with the
   * `latestAttentionAt` it had when it was marked. Absent, none are.
   */
  pendingRead?: ReadonlyMap<string, number>;
}

/** Whether the thread is shown in a visible pane: the active one or another split pane. */
export function isOpenThread(thread: Pick<PluginSidebarThread, "id">, context: ThreadContext): boolean {
  return thread.id === context.activeThreadId || (context.openThreadIds?.has(thread.id) ?? false);
}

/**
 * bb's rule for every thread: unread when it has finished (idle or
 * error) since it was last read. Children are also unread when they finished
 * after you last looked at them (done-unseen). An open thread is never
 * unread: bb marks it read moments after it finishes or fails, and counting
 * it until then only flashes the need-you filter. Nor is a thread whose read
 * request is pending (`isPendingRead`).
 */
export function isUnread(thread: PluginSidebarThread, context: ThreadContext): boolean {
  if (isOpenThread(thread, context)) return false;
  if (isPendingRead(thread, context)) return false;
  const status = normalizeStatus(thread);
  const lastRead = thread.lastReadAt ?? 0;
  if ((status === "idle" || status === "error") && lastRead < thread.latestAttentionAt) {
    return true;
  }
  return isDoneUnseen(thread, context);
}

/**
 * Shown read while its read request is pending, until bb reports attention
 * newer than when it was marked (a new turn finishing).
 */
export function isPendingRead(thread: Pick<PluginSidebarThread, "id" | "latestAttentionAt">, context: ThreadContext): boolean {
  const markedAt = context.pendingRead?.get(thread.id);
  return markedAt !== undefined && thread.latestAttentionAt <= markedAt;
}

/** Done-unseen: a child that finished after you last read or viewed it. */
export function isDoneUnseen(thread: PluginSidebarThread, context: ThreadContext): boolean {
  if (thread.parentThreadId === null) return false;
  if (normalizeStatus(thread) !== "idle") return false;
  if (isOpenThread(thread, context)) return false;
  const finished = context.finishedAt[thread.id];
  if (finished === undefined) return false;
  return finished > Math.max(thread.lastReadAt ?? 0, context.seenAt[thread.id] ?? 0);
}

export interface StateInputs {
  unread: boolean;
  hasDraft: boolean;
  /** Earliest future `sendAt` for this thread, or null. */
  scheduledAt: number | null;
  now: number;
  /** What the pending interaction asks for, when the server saw it. */
  needsKind?: NeedsKind | null;
}

const BACKGROUND: readonly [keyof PluginSidebarThread["activity"], string, string][] = [
  ["planMode", "ListTodo", "Plan mode active"],
  ["goals", "Target", "Goal active"],
  ["workflows", "Workflow", "Workflow running"],
  ["backgroundAgents", "UserRoundPlus", "Background agent running"],
  ["backgroundCommands", "Terminal", "Background command running"],
];

function glyph(icon: Glyph["icon"], tone: Tone, spin = false, shine = false): Glyph {
  return { icon, tone, spin, shine };
}

function workingLabel(runtime: string): string {
  switch (runtime) {
    case "provisioning":
      return "Setting up";
    case "host-reconnecting":
      return "Reconnecting";
    case "stopping":
      return "Stopping";
    default:
      return "Working";
  }
}

/** First match wins. */
export function computeState(thread: PluginSidebarThread, inputs: StateInputs): ThreadState {
  const status = normalizeStatus(thread);
  const runtime = normalizeRuntime(thread);
  const queued = normalizeQueued(thread);
  const none = { sendAt: null };
  if (thread.hasPendingInteraction) {
    const needs = NEEDS[inputs.needsKind ?? "input"] ?? NEEDS.input;
    const icon = inputs.needsKind ? needs.icon : "CircleQuestion";
    return { kind: "waits-on-you", label: needs.label, glyph: glyph(icon, "attention"), ...none };
  }
  if (status === "error") {
    return {
      kind: "failed",
      label: "Failed",
      glyph: glyph("CircleX", "destructive"),
      ...none,
    };
  }
  if (queued === "failed") {
    return {
      kind: "queue-failed",
      label: "Queued message failed to send",
      glyph: glyph("AlertTriangle", "destructive"),
      ...none,
    };
  }
  if (runtime === "waiting-for-host") {
    return { kind: "offline", label: "Machine offline", glyph: glyph("CloudOff", "attention"), ...none };
  }
  if (WORKING_RUNTIME.has(runtime)) {
    const label = workingLabel(runtime);
    if (inputs.hasDraft) {
      return { kind: "working", label: `${label}, unsubmitted draft`, glyph: glyph("Edit", "working", false, true), ...none };
    }
    if (thread.activity.planMode > 0) {
      return { kind: "working", label: `${label}, plan mode`, glyph: glyph("ListTodo", "working", false, true), ...none };
    }
    if (thread.activity.goals > 0) {
      return { kind: "working", label: `${label}, goal active`, glyph: glyph("Target", "working", false, true), ...none };
    }
    return { kind: "working", label, glyph: glyph("Loading", "working", true), ...none };
  }
  for (const [field, icon, label] of BACKGROUND) {
    if (thread.activity[field] > 0) {
      return { kind: "background", label, glyph: glyph(icon, "background", false, true), ...none };
    }
  }
  if (queued === "waiting") {
    if (inputs.scheduledAt !== null && inputs.scheduledAt > inputs.now) {
      return {
        kind: "scheduled",
        label: "Scheduled message",
        glyph: glyph("Calendar", "muted-strong"),
        sendAt: inputs.scheduledAt,
      };
    }
    return { kind: "queued", label: "Message waiting to send", glyph: glyph("Clock", "muted-strong"), ...none };
  }
  if (inputs.unread) return { kind: "unread", label: "Unread", glyph: glyph("dot", "none"), ...none };
  if (inputs.hasDraft) return { kind: "draft", label: "Unsubmitted draft", glyph: glyph("Edit", "muted"), ...none };
  return { kind: "idle", label: "Idle", glyph: glyph("ring", "muted-strong"), ...none };
}

/**
 * A plugin row status replaces the glyph for every state except
 * waits-on-you, failed, and working with its plain spinner (the rule bb's list uses).
 */
export function pluginStatusWins(
  state: ThreadState,
  rowStatus: PluginSidebarThreadRowStatus | null,
): boolean {
  if (rowStatus === null) return false;
  if (state.kind === "waits-on-you" || state.kind === "failed") return false;
  if (state.kind === "working" && state.glyph.spin) return false;
  return true;
}

/** The rollup flags a single thread carries. */
export function threadFlags(thread: PluginSidebarThread, unread: boolean): Set<Flag> {
  const flags = new Set<Flag>();
  if (thread.hasPendingInteraction) flags.add("waits-on-you");
  if (normalizeStatus(thread) === "error" && unread) flags.add("unread-failed");
  if (normalizeQueued(thread) === "failed") flags.add("queue-failed");
  if (isOffline(thread)) flags.add("offline");
  if (isWorking(thread)) flags.add("working");
  if (unread) flags.add("unread");
  return flags;
}

/** Flags hidden threads contribute: waits-on-you and unread-failed only. */
export function hiddenThreadFlags(flags: ReadonlySet<Flag>): Set<Flag> {
  const kept = new Set<Flag>();
  if (flags.has("waits-on-you")) kept.add("waits-on-you");
  if (flags.has("unread-failed")) kept.add("unread-failed");
  return kept;
}

/** Flags a hidden thread adds to the children chip above it: what asks for you or failed, and offline. */
const HIDDEN_CHIP_FLAGS: ReadonlySet<Flag> = new Set<Flag>(["waits-on-you", "unread-failed", "queue-failed", "offline"]);

/**
 * The flags a thread adds to the children chip of the threads above it. A
 * hidden thread adds only waits-on-you, failed, queued message failed and
 * offline; which trees need attention reads `hiddenThreadFlags` instead,
 * so this leaves it unchanged.
 */
export function chipFlagsOf(flags: ReadonlySet<Flag>, isHidden: boolean): Set<Flag> {
  return isHidden ? new Set([...flags].filter((flag) => HIDDEN_CHIP_FLAGS.has(flag))) : new Set(flags);
}

/** The most urgent flag, or null. */
export function mostUrgent(flags: ReadonlySet<Flag>): Flag | null {
  return FLAG_ORDER.find((flag) => flags.has(flag)) ?? null;
}

/** The tone a children chip takes for a state: its glyph's, and the unread dot's accent for unread. */
export function chipTone(flag: Flag): Tone {
  const tone = FLAG_GLYPHS[flag].tone;
  return tone === "none" ? "working" : tone;
}

export const FLAG_GLYPHS: Readonly<Record<Flag, Glyph & { label: string }>> = {
  "waits-on-you": { ...glyph("CircleQuestion", "attention"), label: "needs your input" },
  "unread-failed": { ...glyph("CircleX", "destructive"), label: "failed" },
  "queue-failed": { ...glyph("AlertTriangle", "destructive"), label: "queued message failed" },
  offline: { ...glyph("CloudOff", "attention"), label: "machine offline" },
  working: { ...glyph("Loading", "working", true), label: "working" },
  unread: { ...glyph("dot", "none"), label: "unread" },
};

/** A thread is quiet when idle, a draft, or failed and read, and read. */
export function isQuietThread(
  state: ThreadState,
  unread: boolean,
  isActive: boolean,
): boolean {
  if (unread || isActive) return false;
  return state.kind === "idle" || state.kind === "draft" || state.kind === "failed";
}

/** Every host icon name this module can draw. */
export const STATE_ICON_NAMES: readonly string[] = [
  "CircleQuestion",
  "CircleX",
  "AlertTriangle",
  "CloudOff",
  "Loading",
  "Edit",
  "ListTodo",
  "Target",
  "Workflow",
  "UserRoundPlus",
  "Terminal",
  "Calendar",
  "Clock",
  "SecurityCheck",
  "MessageQuestion",
];
