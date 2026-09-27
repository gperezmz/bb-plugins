/**
 * What the chip, popover, banners, sidebar row, page and CLI show for one
 * thread, as data. Every surface reads this rather than working it out.
 */
import { formatSize, type CacheLifetime } from "./line";
import { joinAnd } from "./messages";
import type { WaitItem } from "./waiting";

/** The realtime channel every surface refetches on; its payload names the changed threads. */
export const CHANGED = "cache-keeper-changed";

export interface ThreadView {
  threadId: string;
  title: string;
  /** False for a thread whose provider is not Claude Code: no chip, nothing sent. */
  eligible: boolean;
  status: string;
  hasPendingInteraction: boolean;
  compactOn: boolean;
  setting: number;
  /** The line for each setting 1–10; null is "never". */
  lines: (number | null)[];
  line: number | null;
  context: number | null;
  window: number;
  model: string | null;
  lifetime: CacheLifetime | null;
  callsPerMessage: number;
  callsMeasured: boolean;
  postCompaction: number;
  postMeasured: boolean;
  /** Where the prices came from; null when the model has none. */
  priceOrigin: string | null;
  rates: { w: number; r: number; o: number } | null;
  deadline: number | null;
  compactionDue: boolean;
  compactSkipped: boolean;
  compactedAt: number | null;
  canCompactNow: boolean;
  waiting: boolean;
  /** "Check in on background work" is on. */
  checkIns: boolean;
  /** A keep-warm is planned for this thread, or for a thread below it whose report will reach it. */
  warmPlanned: boolean;
  warmSkipped: boolean;
  nextWarmAt: number | null;
  counts: WaitCounts;
}

export interface WaitCounts {
  threads: number;
  commands: number;
  subagents: number;
  queued: number;
  scheduled: number;
}

export function countItems(items: readonly WaitItem[]): WaitCounts {
  const counts: WaitCounts = { threads: 0, commands: 0, subagents: 0, queued: 0, scheduled: 0 };
  for (const item of items) {
    if (item.kind === "command") counts.commands += 1;
    else if (item.kind === "subagent") counts.subagents += 1;
    else if (item.kind === "child") counts.threads += 1;
    else if (item.kind === "scheduled") counts.scheduled += 1;
    else counts.queued += 1;
  }
  return counts;
}

/** Whole minutes to `at`, never below 0. */
export const minutesTo = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / 60_000));

/** "3 minutes ago", "2 h ago", "4 d ago". */
export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Why a thread has no line, or null when it has one. */
export type NoLine = "no-price" | "no-setting" | "this-setting";

export function noLineReason(view: ThreadView): NoLine | null {
  if (view.line !== null) return null;
  if (view.rates === null) return "no-price";
  return view.lines.some((l) => l !== null) ? "this-setting" : "no-setting";
}

/** The chip's text: empty for the icon alone. */
export function chipText(view: ThreadView, now: number): string {
  if (!view.compactOn) return "";
  if (view.hasPendingInteraction) return "paused";
  if (view.compactionDue && view.deadline !== null) return `${minutesTo(view.deadline, now)}m`;
  return view.line === null ? "no line" : `≥ ${formatSize(view.line)}`;
}

/** The chip's hover sentence. */
export function chipSentence(view: ThreadView, now: number): string {
  if (!view.compactOn) return "Compact when idle is off. Click to switch it on for this thread.";
  if (view.hasPendingInteraction) return "Compact when idle is paused while this thread waits on your answer.";
  if (view.compactionDue && view.deadline !== null) {
    return `Compacting in ${minutesTo(view.deadline, now)}m, just before the cache goes cold.`;
  }
  switch (noLineReason(view)) {
    case "no-price":
      return "Compact when idle is on, but this model has no price yet, so there is no line and the thread is not compacted.";
    case "no-setting":
      return "Compact when idle is on, but compacting never repays itself on this thread at any setting, so it is not compacted.";
    case "this-setting":
      return "Compact when idle is on, but no size up to the context window repays compacting at this setting, so it is not compacted.";
    case null:
      return `When this thread stops at ${formatSize(view.line)} or more, compact it just before its cache goes cold.`;
  }
}

/** The popover's sentence under the switch; with no line, it says the thread is never compacted and why. */
export function popoverSentence(view: ThreadView): string {
  switch (noLineReason(view)) {
    case "no-price":
      return "With no price for this model yet, there is no line, so this thread is not compacted.";
    case "no-setting":
      return `At no setting does compacting this thread repay itself: even at its whole ${formatSize(view.window)} window, your first message back would save less than compacting costs. It is never compacted.`;
    case "this-setting":
      return `No size up to this thread's ${formatSize(view.window)} window repays compacting at this setting, so it is never compacted. Move the handle lower to set a line.`;
    case null:
      return `When this thread stops at ${formatSize(view.line)} or more, compact it just before its cache goes cold. Never while it's working.`;
  }
}

/** The status half of the popover's `now {context} · {status}` line. */
export function statusText(view: ThreadView, now: number): string {
  if (view.status !== "idle") return "working";
  if (view.hasPendingInteraction) return "waiting on your answer";
  if (view.compactionDue && view.deadline !== null) return `compacting in ${minutesTo(view.deadline, now)}m`;
  if (view.compactedAt !== null) return `compacted ${ago(view.compactedAt, now)}`;
  if (view.compactSkipped) return "skipped until this thread next runs";
  if (view.waiting) return "waiting on background work";
  if (view.line === null) return "idle, no line";
  if (view.context === null || view.context < view.line) return "idle, under the line";
  return "idle";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 threads and 1 command": how many things of each kind a thread waits on, never what they are. */
export function countsText(counts: WaitCounts): string {
  const parts: string[] = [];
  if (counts.threads > 0) parts.push(plural(counts.threads, "thread", "threads"));
  if (counts.commands > 0) parts.push(plural(counts.commands, "command", "commands"));
  if (counts.subagents > 0) parts.push(plural(counts.subagents, "subagent", "subagents"));
  if (counts.queued > 0) parts.push(plural(counts.queued, "queued message", "queued messages"));
  if (counts.scheduled > 0) parts.push(plural(counts.scheduled, "scheduled message", "scheduled messages"));
  return parts.length === 0 ? "background work" : joinAnd(parts);
}

export type BannerAction = "skip-compaction" | "compact-now" | "undo-compaction" | "skip-warm" | "undo-warm";

/** The one line above the composer, and its buttons; null for none. */
export function bannerOf(view: ThreadView, now: number): { text: string; actions: BannerAction[] } | null {
  if (!view.eligible || view.status !== "idle" || view.hasPendingInteraction) return null;
  if (view.compactionDue && view.deadline !== null) {
    return { text: `Compacting in ${minutesTo(view.deadline, now)}m, before the cache goes cold`, actions: ["skip-compaction", "compact-now"] };
  }
  if (view.compactOn && view.compactSkipped && view.compactedAt === null && !view.waiting) {
    return { text: "Skipped until this thread next runs", actions: ["undo-compaction"] };
  }
  if (!view.waiting || !view.checkIns) return null;
  if (view.warmSkipped) return { text: "Skipped for this wait", actions: ["undo-warm"] };
  if (view.warmPlanned) return { text: `Waiting on ${countsText(view.counts)}, keeping cache warm`, actions: ["skip-warm"] };
  return { text: `Waiting on ${countsText(view.counts)}, letting cache go cold`, actions: [] };
}

/** A sidebar row showing a Cache Keeper glyph, and which. */
export interface RowGlyph {
  threadId: string;
  status: "compaction" | "clock";
}

/** What the sidebar row shows in place of its status glyph, or null. */
export function rowStatus(view: ThreadView): RowGlyph["status"] | null {
  if (view.compactionDue) return "compaction";
  if (view.warmPlanned) return "clock";
  return null;
}

/** What a Cache Keeper page entry records of what was sent. */
export interface EntryFacts {
  contextBefore?: number | null;
  contextAfter?: number | null;
  /** A check-in's tasks. */
  tasks?: { id: string }[];
  /** A keep-warm's threads, sent at the same moment. */
  threads?: string[];
  /** The tasks a keep-warm asked about. */
  folded?: string[];
}

/** "Kept warm, 3 threads, checked b0vq", "Checked b1", "Compacted 300k → 12k". */
export function entryText(kind: "compaction" | "keep-warm" | "check-in", facts: EntryFacts): string {
  if (kind === "compaction") return `Compacted ${formatSize(facts.contextBefore ?? null)} → ${facts.contextAfter == null ? "…" : formatSize(facts.contextAfter)}`;
  if (kind === "check-in") return `Checked ${joinAnd((facts.tasks ?? []).map((t) => t.id))}`;
  const n = facts.threads?.length ?? 1;
  const parts = ["Kept warm"];
  if (n > 1) parts.push(`${n} threads`);
  if ((facts.folded ?? []).length > 0) parts.push(`checked ${joinAnd(facts.folded!)}`);
  return parts.join(", ");
}
