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
  const trimmed = text.trim();
  return trimmed.length <= CUT ? trimmed : `${trimmed.slice(0, CUT - 1)}…`;
}

/**
 * Text from outside the plugin (a task id or description, a thread title, a
 * tool name) as a message quotes it: cut to 60 characters, then with
 * backslashes, quotes and line breaks escaped, so it cannot end the quote it
 * sits in or start a line of its own.
 */
export function outside(text: string): string {
  return escaped(cut(text));
}

/**
 * A path from outside the plugin (a background command's output file) as a
 * message quotes it: escaped as `outside` does, but not cut, since a cut path
 * points nowhere.
 */
export function escaped(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, "\\n").replace(/\t/g, " ");
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
      return `background command ${outside(item.id)} ("${outside(item.description)}")`;
    case "subagent":
      return `background subagent ${outside(item.id)} ("${outside(item.description)}")`;
    case "child":
      return `child thread ${outside(item.id)} ("${outside(item.title)}")`;
    case "scheduled":
      return `a scheduled message due at ${clock(item.dueAt)}`;
    case "queued":
      return "a queued message";
  }
}

/** Everything a thread waits on, in order, as one phrase; "background work" while bb counts tasks not yet read. */
export function itemsText(items: readonly WaitItem[], clock: ClockFormat = localClock): string {
  return items.length === 0 ? "background work" : joinAnd(orderItems(items).map((item) => entry(item, clock)));
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
  return `Checked ${joinAnd(taskIds.map(outside))}, still running normally, nothing new. ${NOTHING_NEEDED}`;
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
  const name = `${outside(task.id)} ("${outside(task.description)}")`;
  if (task.kind === "command") {
    return task.reason === "stalled"
      ? `Background command ${name} hasn't printed anything in ${duration(task.silentMs)}. Can you check on it? Its output is in ${escaped(task.outputFile)}.`
      : `Background command ${name} has been running ${duration(task.runningMs)} and is still printing. Have a look at the latest output in ${escaped(task.outputFile)} for repeated errors or retries.`;
  }
  return task.reason === "stalled"
    ? `Background subagent ${name} hasn't made progress in ${duration(task.silentMs)}; its last tool was ${outside(task.lastTool)}. Can you check on it?`
    : `Background subagent ${name} has been running ${duration(task.runningMs)}; its last tool was ${outside(task.lastTool)}. Can you check it's on track?`;
}

/** Commands before subagents, oldest first. */
const orderTasks = (tasks: readonly CheckInTask[]) => [...tasks].sort((a, b) => (a.kind === b.kind ? a.startedAt - b.startedAt : a.kind === "command" ? -1 : 1));

const checkedEnd = (tasks: readonly CheckInTask[]) =>
  `${QUIET_ON_PURPOSE} If nothing is wrong, reply with exactly "${checkedReply(tasks.map((t) => t.id))}" ${CHECK_IN_TAIL}`;

/** A check-in on stalled tasks: one paragraph each, then the reply it asks for. */
export function checkInText(tasks: readonly CheckInTask[]): string {
  const ordered = orderTasks(tasks);
  return [...ordered.map(paragraph), checkedEnd(ordered)].join("\n\n");
}

const NOTHING_NEEDED = "Nothing needed from you.";
const QUIET_ON_PURPOSE = "A task that's quiet on purpose, such as a server or a watcher, is fine to leave running.";
const CHECK_IN_TAIL = "Otherwise tell me in a line what you found. Don't wait for me either way.";
/** The endings of earlier versions' messages, still recognised in older transcripts and events. */
const OLD_KEEP_WARM_END = 'Nothing to do yet, just reply "OK".';
const OLD_CHECK_IN_ENDS = [
  "Otherwise tell me in a line what you found and what you did. Don't wait for me either way.",
  "Tell me in a line what you found. Don't wait for me either way.",
];

export type SentKind = "keep-warm" | "check-in" | "compact";

/** Which of Cache Keeper's messages a text is, or null for anything else. */
export function sentKind(text: string): SentKind | null {
  const t = text.trim();
  if (t === COMPACT_MESSAGE) return "compact";
  const checkInEnd = t.endsWith(CHECK_IN_TAIL) || OLD_CHECK_IN_ENDS.some((end) => t.endsWith(end));
  if (t.startsWith("Still waiting on ") && (t.endsWith(OLD_KEEP_WARM_END) || t.endsWith(`${NOTHING_NEEDED}"`) || checkInEnd)) return "keep-warm";
  if (checkInEnd) return "check-in";
  return null;
}

/** Whether a message's text is a keep-warm or check-in Cache Keeper sent. */
export function isKeeperMessage(text: string): boolean {
  const kind = sentKind(text);
  return kind === "keep-warm" || kind === "check-in";
}

const unquote = (text: string) => text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();

/** The nothing-new reply a message asks for: none for a compaction, a "Not finished yet" one, or a "Checked" one naming these tasks. */
export type Expectation = { kind: "compact" } | { kind: "not-finished" } | { kind: "checked"; ids: string[] };

/** What reply `sent`, a message of Cache Keeper's, asks for when nothing is wrong; null for any other text. */
export function expectationOf(sent: string): Expectation | null {
  const kind = sentKind(sent);
  if (kind === null) return null;
  if (kind === "compact") return { kind: "compact" };
  const asked = /reply with exactly "Checked (.+?), still running normally, nothing new\./.exec(sent);
  return asked === null ? { kind: "not-finished" } : { kind: "checked", ids: asked[1]!.split(/, | and /) };
}

/**
 * Whether `reply` meets what a message asked for. A "Checked" reply is
 * recognised by its shape: it starts "Checked", names every task the message
 * asked about and ends "nothing new. Nothing needed from you.". A compaction
 * has no reply to judge.
 */
export function meetsExpectation(expected: Expectation, reply: string | null): boolean {
  if (expected.kind === "compact") return true;
  if (reply === null) return false;
  const r = unquote(reply);
  if (expected.kind === "checked") return r.startsWith("Checked") && /nothing new\. Nothing needed from you\.$/.test(r) && expected.ids.every((id) => r.includes(id));
  return r.startsWith("Not finished yet, still waiting on ") && r.endsWith(`. ${NOTHING_NEEDED}`);
}

/** Whether `reply` is the nothing-new reply `sent` asked for. */
export function isNothingNewReply(sent: string, reply: string | null): boolean {
  const expected = expectationOf(sent);
  return expected !== null && meetsExpectation(expected, reply);
}

/**
 * A short fingerprint of a message's text, by which a send is found again
 * from bb's record of it without storing the text: two 32-bit FNV-1a hashes
 * with different seeds, as 16 hex digits.
 */
export function textHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
