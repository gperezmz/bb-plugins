/**
 * A thread's turns as bb's event history records them, and which of them
 * count as Cache Keeper's.
 *
 * bb writes a `client/turn/requested` event for every input it hands a
 * thread (its text, who sent it, and for a report what kind of report it is
 * and which child it is about), then `turn/started`, one
 * `turn/input/accepted` per input the turn took, and `turn/completed`. A turn
 * counts as Cache Keeper's when every input it took is a message Cache Keeper
 * sent, or a report of a child's turn that itself counts as Cache Keeper's.
 * Anything else, including a turn with no input at all, or one a background
 * task finished during (Claude Code takes the finished task into the running
 * turn), makes it real.
 *
 * A report is recognised by bb's `initiator` and `systemMessageKind` fields,
 * never by its text, and each child it reports is judged by that child's own
 * turn history, including how its turn ended. A queued report row carries no
 * kind, so it is recognised by its `[bb system]` text and its mentions of the
 * thread's children.
 *
 * bb 0.44 does not carry a send's `pluginSubmission` into its events, so a
 * send is recognised by its text: Cache Keeper's messages are fixed templates.
 */
import { isNothingNewReply, sentKind } from "./messages";

/** An event as `threads.events.list` gives it. */
export interface BbEvent {
  seq: number;
  type: string;
  createdAt: number;
  data: unknown;
}

/** The event types the fold reads. */
export const TURN_EVENT_TYPES = [
  "client/turn/requested",
  "client/turn/rejected",
  "turn/started",
  "turn/input/accepted",
  "turn/completed",
  "item/completed",
  "item/backgroundTask/completed",
] as const;

/** One child a report is about. */
export interface ReportLine {
  childId: string;
  /** Only on lines stored before reports were read by their kind: whether bb's text said the child's turn completed. */
  completed?: boolean;
}

/** The kinds of bb's system messages that report a child's turn. */
export const REPORT_KINDS = ["child-completed", "child-failed", "child-interrupted", "child-needs-attention", "child-outcome-batch"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
/** bb's other system messages: they report no child's turn. */
const OTHER_SYSTEM_KINDS = ["ownership-assigned", "ownership-removed", "tool-result-delivered", "unlabeled"] as const;

export type TurnInput =
  /** A message Cache Keeper sent. */
  | { kind: "sent"; text: string; at: number }
  /** bb's report of child turns, requested at `at`; `report` is absent on reports stored before it was read. */
  | { kind: "report"; report?: ReportKind; lines: ReportLine[]; at: number }
  /** Anything else: a message someone typed, another thread's, a notice that reports no child. */
  | { kind: "other" };

export interface Turn {
  startSeq: number;
  startedAt: number;
  endedAt: number | null;
  /** bb's end status: completed, failed or interrupted; null while running. */
  status: string | null;
  inputs: TurnInput[];
  /** The last agent message of the turn. */
  reply: string | null;
}

/** What the fold keeps of a thread's history between reads; stored, so a restart reads on from it. */
export interface TurnLog {
  afterSeq: number;
  /** Requests bb recorded that no turn has taken yet, by request id. */
  requests: Record<string, { at: number; inputs: TurnInput[] }>;
  /** Most recent last. */
  turns: Turn[];
  /** Every report line delivered into this thread, and when, most recent last. */
  delivered: { childId: string; at: number }[];
}

export const emptyTurnLog = (afterSeq = 0): TurnLog => ({ afterSeq, requests: {}, turns: [], delivered: [] });

const KEEP_TURNS = 40;
const KEEP_DELIVERED = 100;
/** A request no turn took within this long never will. */
const REQUEST_MS = 60 * 60_000;

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The text of one input group and the threads it mentions. */
function groupOf(blocks: unknown[]): { text: string; mentions: string[] } {
  let text = "";
  const mentions: string[] = [];
  for (const block of blocks.map(rec)) {
    if (block.type !== "text") continue;
    text += str(block.text) ?? "";
    for (const m of arr(block.mentions).map(rec)) {
      const resource = rec(m.resource);
      const threadId = str(resource.threadId);
      if (resource.kind === "thread" && threadId !== null && !mentions.includes(threadId)) mentions.push(threadId);
    }
  }
  return { text, mentions };
}

/** What the fold knows of the thread whose history it reads. */
export interface ThreadContext {
  threadId: string;
  /** Whether `id` is a child of this thread, one level down. */
  isChild(id: string): boolean;
  /** Told of each input the fold cannot read as bb's fields say it should be; the input counts as other. */
  warn(message: string): void;
}

/** The fields of a `client/turn/requested` event that say who sent it and what it reports. */
export interface RequestFields {
  requestId: string;
  /** Which of the request's input groups this is, from 1, where it has more than one. */
  group: number | null;
  initiator: string | null;
  systemMessageKind: string | null;
  /** The child a single report is about. */
  subjectThreadId: string | null;
}

/**
 * What one input group of a request is (prompt blocks as bb records them): a
 * Cache Keeper message, a report of child turns, or anything else.
 */
export function classify(blocks: unknown[], at: number, request: RequestFields, thread: ThreadContext): TurnInput {
  const { text, mentions } = groupOf(blocks);
  const logPrefix = `request ${request.requestId}${request.group === null ? "" : ` (input ${request.group})`} into ${thread.threadId}`;
  const kind = request.systemMessageKind;
  const system = request.initiator === "system";
  if (system && REPORT_KINDS.some((k) => k === kind)) {
    const report = kind as ReportKind;
    const children = report === "child-outcome-batch" ? mentions.filter((id) => thread.isChild(id)) : request.subjectThreadId === null ? [] : [request.subjectThreadId];
    if (children.length === 0) {
      thread.warn(`${logPrefix}: bb's ${report} report names no child thread; its turn counts as real`);
      return { kind: "other" };
    }
    return { kind: "report", report, at, lines: children.map((childId) => ({ childId })) };
  }
  if (sentKind(text) !== null) return { kind: "sent", text: text.trim(), at };
  if (system && mentions.length > 0 && !OTHER_SYSTEM_KINDS.some((k) => k === kind)) {
    thread.warn(`${logPrefix}: a system message mentioning a thread has ${kind === null ? "no systemMessageKind" : `the unknown systemMessageKind "${kind}"`}; it is not read as a report`);
  }
  return { kind: "other" };
}

/** A queued row as `threads.queuedMessages.list` gives it, in the fields read here. */
export interface QueuedReportRow {
  createdAt: number;
  failed: boolean;
  /** bb queued it itself. */
  system: boolean;
  content: unknown[];
}

/**
 * Whether a queued row is bb's report of child turns. bb's queued rows carry
 * no `systemMessageKind`, so a report is told by its `[bb system]` text; it
 * names each child of the thread it mentions, and no other thread.
 */
export function classifyQueued(row: QueuedReportRow, isChild: (id: string) => boolean): TurnInput {
  const { text, mentions } = groupOf(row.content);
  if (!row.system || row.failed || !text.startsWith("[bb system]") || mentions.length === 0) return { kind: "other" };
  return { kind: "report", at: row.createdAt, lines: mentions.filter(isChild).map((childId) => ({ childId })) };
}

/** The children an input reports: none unless it is a report. */
export const reportLines = (input: TurnInput): ReportLine[] => (input.kind === "report" ? input.lines : []);

/** Folds events, oldest first, into the log. */
export function foldTurns(log: TurnLog, events: readonly BbEvent[], thread: ThreadContext): TurnLog {
  const requests = { ...log.requests };
  const turns = log.turns.map((t) => ({ ...t, inputs: [...t.inputs] }));
  const delivered = [...log.delivered];
  let afterSeq = log.afterSeq;
  const open = () => {
    const last = turns[turns.length - 1];
    return last !== undefined && last.endedAt === null ? last : null;
  };
  for (const e of events) {
    if (e.seq <= afterSeq) continue;
    afterSeq = e.seq;
    const data = rec(e.data);
    switch (e.type) {
      case "client/turn/requested": {
        const requestId = str(data.requestId);
        if (requestId === null) break;
        const groups = arr(data.inputGroups).length > 0 ? arr(data.inputGroups).map(arr) : [arr(data.input)];
        const subject = rec(data.systemMessageSubject);
        const fields: Omit<RequestFields, "group"> = {
          requestId,
          initiator: str(data.initiator),
          systemMessageKind: str(data.systemMessageKind),
          subjectThreadId: subject.kind === "thread" ? str(subject.threadId) : null,
        };
        const inputs = groups.map((g, i) => classify(g, e.createdAt, { ...fields, group: groups.length > 1 ? i + 1 : null }, thread));
        requests[requestId] = { at: e.createdAt, inputs };
        for (const input of inputs) if (input.kind === "report") for (const line of input.lines) delivered.push({ childId: line.childId, at: e.createdAt });
        break;
      }
      case "client/turn/rejected": {
        const requestId = str(data.requestId);
        if (requestId !== null) delete requests[requestId];
        break;
      }
      case "turn/started": {
        const running = open();
        // A turn bb never saw end is closed where the next begins.
        if (running !== null) running.endedAt = e.createdAt;
        turns.push({ startSeq: e.seq, startedAt: e.createdAt, endedAt: null, status: null, inputs: [], reply: null });
        break;
      }
      case "turn/input/accepted": {
        const turn = open();
        if (turn === null) break;
        const requestId = str(data.clientRequestId);
        const request = requestId === null ? undefined : requests[requestId];
        // A request read before the log's first event is unknown, and unknown is real.
        turn.inputs.push(...(request?.inputs ?? [{ kind: "other" as const }]));
        if (requestId !== null) delete requests[requestId];
        break;
      }
      case "item/backgroundTask/completed": {
        // Claude Code hands a finished task to the running turn, which then takes it as an input of its own.
        const turn = open();
        if (turn !== null) turn.inputs.push({ kind: "other" });
        break;
      }
      case "item/completed": {
        const turn = open();
        const item = rec(data.item);
        if (turn !== null && item.type === "agentMessage") turn.reply = str(item.text);
        break;
      }
      case "turn/completed": {
        const turn = open();
        if (turn === null) break;
        turn.endedAt = e.createdAt;
        turn.status = str(data.status) ?? "completed";
        break;
      }
    }
  }
  const newest = events.length > 0 ? events[events.length - 1]!.createdAt : 0;
  for (const [id, r] of Object.entries(requests)) if (newest - r.at > REQUEST_MS) delete requests[id];
  return { afterSeq, requests, turns: turns.slice(-KEEP_TURNS), delivered: delivered.slice(-KEEP_DELIVERED) };
}

/** Reads other threads' logs; null for a thread whose history was not read. */
export type LogLookup = (threadId: string) => TurnLog | null;

/**
 * The child's turns a report line delivered into `parent` at `at` may stand
 * for: those that ended after the child's previous report was delivered, and
 * by `at`. bb reports every turn, but a report held in a queue arrives late,
 * so where several turns ended since, the line could be any of them.
 */
export function reportedTurns(parent: TurnLog | null, child: TurnLog | null, childId: string, at: number): Turn[] {
  if (child === null) return [];
  const before = Math.max(-Infinity, ...(parent?.delivered ?? []).filter((d) => d.childId === childId && d.at < at).map((d) => d.at));
  const ended = child.turns.filter((t) => t.endedAt !== null && t.endedAt <= at);
  const since = ended.filter((t) => t.endedAt! > before);
  return since.length > 0 ? since : ended.slice(-1);
}

/** Report lines deeper than this are taken as real: bb's trees are never this deep. */
const MAX_DEPTH = 32;

/** Whether a report's kind alone says the child's turn did not end as asked, so the turn that takes it is real. */
const isRealReport = (kind: ReportKind | undefined) => kind === "child-failed" || kind === "child-interrupted" || kind === "child-needs-attention";

/**
 * Whether a report line holds by `test`: every child turn it may stand for
 * completed and passes. A line of a failure, one that cannot be traced, or
 * one stored as not completed does not: an unknown line is taken as news.
 */
export function lineHolds(parent: TurnLog | null, child: TurnLog | null, line: ReportLine, at: number, test: (t: Turn) => boolean): boolean {
  if (line.completed === false) return false;
  const candidates = reportedTurns(parent, child, line.childId, at);
  return candidates.length > 0 && candidates.every((t) => t.status === "completed" && test(t));
}

/** Whether every report line of the turn holds by `test`. */
function linesHold(threadId: string, turn: Turn, lookup: LogLookup, test: (childId: string, t: Turn) => boolean): boolean {
  return turn.inputs.every((input) => {
    if (input.kind !== "report") return true;
    if (isRealReport(input.report)) return false;
    return input.lines.every((line) => lineHolds(lookup(threadId), lookup(line.childId), line, input.at, (t) => test(line.childId, t)));
  });
}

/** Whether a turn in `threadId` counts as Cache Keeper's. */
export function isKeeperTurn(threadId: string, turn: Turn, lookup: LogLookup, depth = 0): boolean {
  if (turn.inputs.length === 0 || depth > MAX_DEPTH || turn.inputs.some((i) => i.kind === "other")) return false;
  return linesHold(threadId, turn, lookup, (childId, t) => isKeeperTurn(childId, t, lookup, depth + 1));
}

/**
 * Whether a Cache Keeper turn brought nothing new: it completed, every
 * message it took got the nothing-new reply it asked for, and every child
 * turn it reports did the same.
 */
export function broughtNothingNew(threadId: string, turn: Turn, lookup: LogLookup, depth = 0): boolean {
  if (turn.status !== "completed" || turn.inputs.length === 0 || depth > MAX_DEPTH || turn.inputs.some((i) => i.kind === "other")) return false;
  if (!turn.inputs.every((i) => i.kind !== "sent" || isNothingNewReply(i.text, turn.reply))) return false;
  return linesHold(threadId, turn, lookup, (childId, t) => broughtNothingNew(childId, t, lookup, depth + 1));
}

/** A Cache Keeper message a turn traces back to: sent to `threadId`, requested at `at`. */
export interface SentRef {
  threadId: string;
  at: number;
  text: string;
}

/**
 * The messages Cache Keeper sent that caused a turn: its own, and through
 * each report line, those behind the child's turn, at any depth.
 */
export function originsOf(threadId: string, turn: Turn, lookup: LogLookup, depth = 0): SentRef[] {
  if (depth > MAX_DEPTH) return [];
  const out: SentRef[] = [];
  const add = (ref: SentRef) => {
    if (!out.some((o) => o.threadId === ref.threadId && o.at === ref.at)) out.push(ref);
  };
  for (const input of turn.inputs) {
    if (input.kind === "sent") add({ threadId, at: input.at, text: input.text });
    else if (input.kind === "report") {
      for (const line of input.lines) {
        for (const child of reportedTurns(lookup(threadId), lookup(line.childId), line.childId, input.at)) {
          for (const ref of originsOf(line.childId, child, lookup, depth + 1)) add(ref);
        }
      }
    }
  }
  return out;
}

/** How long a parent waits on a report bb has not delivered before taking it as never coming. */
export const REPORT_WAIT_MS = 2 * 60_000;

/**
 * Whether bb's report of the child's last turn is still on its way into the
 * parent: the turn ended under two minutes ago and no report of it has been
 * delivered into the parent.
 */
export function reportPending(parent: TurnLog | null, childId: string, child: TurnLog | null, now: number): boolean {
  const last = child?.turns[child.turns.length - 1];
  if (last === undefined || last.endedAt === null || now - last.endedAt >= REPORT_WAIT_MS) return false;
  return !(parent?.delivered ?? []).some((d) => d.childId === childId && d.at >= last.endedAt!);
}
