/**
 * The text of every message Cache Keeper sends. They are fixed templates,
 * written like a person's prompt, so the same state always sends the same
 * words.
 */
import type { CheckInReason } from "./checkins";
import { orderItems, type WaitItem } from "./waiting";

/** What `/compact` is given on top of Claude Code's own summary prompt. */
export const COMPACT_ADDITIONS =
  "Also record: approaches that were tried or considered and ruled out, with the reason for each; decisions taken and the reason for each; commands verified to work. If your last message asks the user something, quote the question verbatim with each option and what choosing it would mean.";

export const COMPACT_MESSAGE = `/compact ${COMPACT_ADDITIONS}`;

const CUT = 60;

/** Cuts text to 60 characters, the last one "…". */
export function cut(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= CUT ? oneLine : `${oneLine.slice(0, CUT - 1)}…`;
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "{n} minutes" under an hour, "{h} h {m} min" from an hour on. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Formats an epoch ms as HH:MM on the server's clock. */
export type ClockFormat = (ms: number) => string;

export const localClock: ClockFormat = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function entry(item: WaitItem, clock: ClockFormat): string {
  switch (item.kind) {
    case "command":
      return `background command ${item.id} ("${cut(item.description)}")`;
    case "subagent":
      return `background subagent ${item.id} ("${cut(item.description)}")`;
    case "child":
      return `child thread ${item.id} ("${cut(item.title)}")`;
    case "scheduled":
      return `a scheduled message due at ${clock(item.dueAt)}`;
    case "queued":
      return "a queued message";
  }
}

/** Everything a thread waits on, in order, as one phrase. */
export function itemsText(items: readonly WaitItem[], clock: ClockFormat = localClock): string {
  return joinAnd(orderItems(items).map((item) => entry(item, clock)));
}

export function keepWarmText(items: readonly WaitItem[], clock: ClockFormat = localClock): string {
  return `Still waiting on ${itemsText(items, clock)}. ${KEEP_WARM_END}`;
}

/** One task due a check-in. */
export type CheckInTask =
  | { kind: "command"; reason: CheckInReason; id: string; description: string; startedAt: number; silentMs: number; runningMs: number; outputFile: string }
  | { kind: "subagent"; reason: CheckInReason; id: string; description: string; startedAt: number; silentMs: number; runningMs: number; lastTool: string };

function paragraph(task: CheckInTask): string {
  const name = `${task.id} ("${cut(task.description)}")`;
  if (task.kind === "command") {
    return task.reason === "stalled"
      ? `Background command ${name} hasn't printed anything in ${duration(task.silentMs)}. Can you check it's still moving? Its output is in ${task.outputFile}. If it's stuck, stop it, fix whatever's blocking it and keep going with the task. If it's fine, leave it running.`
      : `Background command ${name} has been running ${duration(task.runningMs)} and is still printing. Have a look at the latest output in ${task.outputFile} for repeated errors or retries. If it's looping, stop it, fix it and carry on. If it's fine, leave it running.`;
  }
  return task.reason === "stalled"
    ? `Background subagent ${name} hasn't made progress in ${duration(task.silentMs)}; its last tool was ${task.lastTool}. Can you check on it? If it's stuck, stop it, then fix the problem or do that part yourself and keep going. If it's fine, leave it.`
    : `Background subagent ${name} has been running ${duration(task.runningMs)}; its last tool was ${task.lastTool}. Check it's on track. If it's going in circles, stop it and take over that part. If it's fine, leave it.`;
}

/** One paragraph per due task, commands before subagents and oldest first, then the closing line. */
export function checkInText(tasks: readonly CheckInTask[]): string {
  const ordered = [...tasks].sort((a, b) => (a.kind === b.kind ? a.startedAt - b.startedAt : a.kind === "command" ? -1 : 1));
  return [...ordered.map(paragraph), CHECK_IN_END].join("\n\n");
}

const KEEP_WARM_END = 'Nothing to do yet, just reply "OK".';
const CHECK_IN_END = "Tell me in a line what you found. Don't wait for me either way.";

/** Whether a message's text is a keep-warm or check-in Cache Keeper sent. */
export function isKeeperMessage(text: string): boolean {
  const t = text.trim();
  return (t.startsWith("Still waiting on ") && t.endsWith(KEEP_WARM_END)) || t.endsWith(CHECK_IN_END);
}
