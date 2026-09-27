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
  warmDue: boolean;
  warmSkipped: boolean;
  nextWarmAt: number | null;
  counts: WaitCounts;
}

export interface WaitCounts {
  commands: number;
  subagents: number;
  children: number;
  messages: number;
}

export function countItems(items: readonly WaitItem[]): WaitCounts {
  const counts: WaitCounts = { commands: 0, subagents: 0, children: 0, messages: 0 };
  for (const item of items) {
    if (item.kind === "command") counts.commands += 1;
    else if (item.kind === "subagent") counts.subagents += 1;
    else if (item.kind === "child") counts.children += 1;
    else counts.messages += 1;
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

/** The chip's text: empty for the icon alone. */
export function chipText(view: ThreadView, now: number): string {
  if (!view.compactOn) return "";
  if (view.hasPendingInteraction) return "paused";
  if (view.compactionDue && view.deadline !== null) return `${minutesTo(view.deadline, now)}m`;
  return `≥ ${formatSize(view.line)}`;
}

/** The chip's hover sentence. */
export function chipSentence(view: ThreadView, now: number): string {
  if (!view.compactOn) return "Compact when idle is off. Click to switch it on for this thread.";
  if (view.hasPendingInteraction) return "Compact when idle is paused while this thread waits on your answer.";
  if (view.compactionDue && view.deadline !== null) {
    return `Compacting in ${minutesTo(view.deadline, now)}m, just before the cache goes cold.`;
  }
  return view.line === null
    ? "Compact when idle is on, but no context up to the window repays compacting at this setting."
    : `When this thread stops at ${formatSize(view.line)} or more, compact it just before its cache goes cold.`;
}

/** The popover's sentence under the switch; with no line, it says the thread is never compacted and why. */
export function popoverSentence(view: ThreadView): string {
  if (view.line === null) {
    return view.rates === null
      ? "With no price for this model yet, there is no line, so this thread is not compacted."
      : `No size up to this thread's ${formatSize(view.window)} window repays compacting at this setting, so it is never compacted. Move the handle lower to set a line.`;
  }
  return `When this thread stops at ${formatSize(view.line)} or more, compact it just before its cache goes cold. Never while it's working.`;
}

/** The status half of the popover's `now {context} · {status}` line. */
export function statusText(view: ThreadView, now: number): string {
  if (view.status !== "idle") return "working";
  if (view.hasPendingInteraction) return "waiting on your answer";
  if (view.compactionDue && view.deadline !== null) return `compacting in ${minutesTo(view.deadline, now)}m`;
  if (view.compactedAt !== null) return `compacted ${ago(view.compactedAt, now)}`;
  if (view.compactSkipped) return "skipped until next idle";
  if (view.waiting) return "waiting on background work";
  if (view.line === null || view.context === null || view.context < view.line) return "idle, under the line";
  return "idle";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The waiting banner's count of what the thread waits on; never any command text. */
export function countsText(counts: WaitCounts): string {
  const parts: string[] = [];
  if (counts.commands > 0) parts.push(plural(counts.commands, "background command", "background commands"));
  if (counts.subagents > 0) parts.push(plural(counts.subagents, "background subagent", "background subagents"));
  if (counts.children > 0) parts.push(plural(counts.children, "child thread", "child threads"));
  if (counts.messages > 0) parts.push(plural(counts.messages, "queued message", "queued messages"));
  return parts.length === 0 ? "background work" : joinAnd(parts);
}

/** A sidebar row showing a Cache Keeper glyph, and which. */
export interface RowGlyph {
  threadId: string;
  status: "compaction" | "clock";
}

/** What the sidebar row shows in place of its status glyph, or null. */
export function rowStatus(view: ThreadView): RowGlyph["status"] | null {
  if (view.compactionDue) return "compaction";
  if (view.warmDue) return "clock";
  return null;
}
