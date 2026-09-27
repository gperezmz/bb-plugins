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

/** One task a message asks the agent to look at: stalled, or folded into a keep-warm after 30 minutes of running. */
export type CheckInTask =
  | { kind: "command"; reason: CheckInReason; id: string; description: string; startedAt: number; silentMs: number; runningMs: number; outputFile: string }
  | { kind: "subagent"; reason: CheckInReason; id: string; description: string; startedAt: number; silentMs: number; runningMs: number; lastTool: string };

/** The reply a message asks for when nothing is wrong: the keep-warm's, or the check-in's naming every task. */
export function notFinishedReply(items: readonly WaitItem[], clock: ClockFormat = localClock): string {
  return `Not finished yet, still waiting on ${itemsText(items, clock)}. ${NOTHING_NEEDED}`;
}

export function checkedReply(taskIds: readonly string[]): string {
  return `Checked ${joinAnd(taskIds)}, still running normally, nothing new. ${NOTHING_NEEDED}`;
}

/**
 * A keep-warm: unconditional, with no need to check anything, unless tasks
 * running 30 minutes or more are folded in, when it asks for a look at each.
 */
export function keepWarmText(items: readonly WaitItem[], folded: readonly CheckInTask[] = [], clock: ClockFormat = localClock): string {
  const waiting = `Still waiting on ${itemsText(items, clock)}.`;
  if (folded.length === 0) return `${waiting} There's no need to check anything. Reply with exactly "${notFinishedReply(items, clock)}"`;
  const ordered = orderTasks(folded);
  return [waiting, ...ordered.map(paragraph), checkedEnd(ordered)].join("\n\n");
}

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

/** Commands before subagents, oldest first. */
const orderTasks = (tasks: readonly CheckInTask[]) => [...tasks].sort((a, b) => (a.kind === b.kind ? a.startedAt - b.startedAt : a.kind === "command" ? -1 : 1));

const checkedEnd = (tasks: readonly CheckInTask[]) => `If nothing is wrong, reply with exactly "${checkedReply(tasks.map((t) => t.id))}" ${CHECK_IN_TAIL}`;

/** A check-in on stalled tasks: one paragraph each, then the reply it asks for. */
export function checkInText(tasks: readonly CheckInTask[]): string {
  const ordered = orderTasks(tasks);
  return [...ordered.map(paragraph), checkedEnd(ordered)].join("\n\n");
}

const NOTHING_NEEDED = "Nothing needed from you.";
const CHECK_IN_TAIL = "Otherwise tell me in a line what you found and what you did. Don't wait for me either way.";
/** The endings of the merged version's messages, still recognised in older transcripts and events. */
const OLD_KEEP_WARM_END = 'Nothing to do yet, just reply "OK".';
const OLD_CHECK_IN_END = "Tell me in a line what you found. Don't wait for me either way.";

export type SentKind = "keep-warm" | "check-in" | "compact";

/** Which of Cache Keeper's messages a text is, or null for anything else. */
export function sentKind(text: string): SentKind | null {
  const t = text.trim();
  if (t === COMPACT_MESSAGE) return "compact";
  if (t.startsWith("Still waiting on ") && (t.endsWith(OLD_KEEP_WARM_END) || t.endsWith(`${NOTHING_NEEDED}"`) || t.endsWith(CHECK_IN_TAIL))) return "keep-warm";
  if (t.endsWith(CHECK_IN_TAIL) || t.endsWith(OLD_CHECK_IN_END)) return "check-in";
  return null;
}

/** Whether a message's text is a keep-warm or check-in Cache Keeper sent. */
export function isKeeperMessage(text: string): boolean {
  const kind = sentKind(text);
  return kind === "keep-warm" || kind === "check-in";
}

const unquote = (text: string) => text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();

/**
 * Whether `reply` is the nothing-new reply `sent` asked for. A "Checked"
 * reply is recognised by its shape: it starts "Checked", names every task
 * the message asked about and ends "nothing new. Nothing needed from you.".
 * A compaction has no reply to judge.
 */
export function isNothingNewReply(sent: string, reply: string | null): boolean {
  const kind = sentKind(sent);
  if (kind === "compact") return true;
  if (kind === null || reply === null) return false;
  const r = unquote(reply);
  const asked = /reply with exactly "Checked (.+?), still running normally, nothing new\./.exec(sent);
  if (asked !== null) {
    const ids = asked[1]!.split(/, | and /);
    return r.startsWith("Checked") && /nothing new\. Nothing needed from you\.$/.test(r) && ids.every((id) => r.includes(id));
  }
  return r.startsWith("Not finished yet, still waiting on ") && r.endsWith(`. ${NOTHING_NEEDED}`);
}
