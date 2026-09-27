/**
 * A thread's turns as bb's event history records them, and which of them
 * count as Cache Keeper's.
 *
 * bb writes a `client/turn/requested` event for every input it hands a
 * thread (its text, who sent it, and for a report the child threads it
 * names as mentions), then `turn/started`, one `turn/input/accepted` per
 * input the turn took, and `turn/completed`. A turn counts as Cache Keeper's
 * when every input it took is a message Cache Keeper sent, or a report of a
 * child's turn that itself counts as Cache Keeper's. Anything else, including
 * a turn with no input at all (a background task finishing), makes it real.
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
export const TURN_EVENT_TYPES = ["client/turn/requested", "client/turn/rejected", "turn/started", "turn/input/accepted", "turn/completed", "item/completed"] as const;

/** One line of bb's report: a child's turn that ended, and whether it completed. */
export interface ReportLine {
  childId: string;
  completed: boolean;
}

export type TurnInput =
  /** A message Cache Keeper sent. */
  | { kind: "sent"; text: string; at: number }
  /** bb's report of child turns, requested at `at`. */
  | { kind: "report"; lines: ReportLine[]; at: number }
  /** Anything else: a message someone typed, another thread's, a report of a failure. */
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

/** The text and thread mentions of one input group. */
function groupOf(blocks: unknown[]): { text: string; mentions: { at: number; threadId: string }[] } {
  let text = "";
  const mentions: { at: number; threadId: string }[] = [];
  for (const block of blocks.map(rec)) {
    if (block.type !== "text") continue;
    const offset = text.length;
    text += str(block.text) ?? "";
    for (const m of arr(block.mentions).map(rec)) {
      const resource = rec(m.resource);
      const threadId = str(resource.threadId);
      if (resource.kind === "thread" && threadId !== null && typeof m.end === "number") mentions.push({ at: offset + m.end, threadId });
    }
  }
  return { text, mentions };
}

/** What one input group is (prompt blocks as bb records them): a Cache Keeper message, a report of child turns, or anything else. */
export function classify(blocks: unknown[], at: number): TurnInput {
  const { text, mentions } = groupOf(blocks);
  if (sentKind(text) !== null) return { kind: "sent", text: text.trim(), at };
  // A report's text is bb's template; each child is a mention followed by its status.
  if (text.startsWith("[bb system]") && mentions.length > 0) {
    return { kind: "report", at, lines: mentions.map((m) => ({ childId: m.threadId, completed: text.startsWith(" completed", m.at) })) };
  }
  return { kind: "other" };
}

/** Folds events, oldest first, into the log. */
export function foldTurns(log: TurnLog, events: readonly BbEvent[]): TurnLog {
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
        const inputs = groups.map((g) => classify(g, e.createdAt));
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

/** The child's turn a report line requested at `at` stands for: its latest turn ended by then. */
export function reportedTurn(child: TurnLog | null, at: number): Turn | null {
  if (child === null) return null;
  for (let i = child.turns.length - 1; i >= 0; i--) {
    const t = child.turns[i]!;
    if (t.endedAt !== null && t.endedAt <= at) return t;
  }
  return null;
}

/** Report lines deeper than this are taken as real: bb's trees are never this deep. */
const MAX_DEPTH = 32;

/** Whether a turn counts as Cache Keeper's. */
export function isKeeperTurn(turn: Turn, lookup: LogLookup, depth = 0): boolean {
  if (turn.inputs.length === 0 || depth > MAX_DEPTH) return false;
  return turn.inputs.every((input) => {
    if (input.kind === "sent") return true;
    if (input.kind === "other") return false;
    return input.lines.every((line) => {
      const child = line.completed ? reportedTurn(lookup(line.childId), input.at) : null;
      return child !== null && isKeeperTurn(child, lookup, depth + 1);
    });
  });
}

/**
 * Whether a Cache Keeper turn brought nothing new: it completed, every
 * message it took got the nothing-new reply it asked for, and every child
 * turn it reports did the same.
 */
export function isQuietTurn(turn: Turn, lookup: LogLookup, depth = 0): boolean {
  if (turn.status !== "completed" || turn.inputs.length === 0 || depth > MAX_DEPTH) return false;
  return turn.inputs.every((input) => {
    if (input.kind === "sent") return isNothingNewReply(input.text, turn.reply);
    if (input.kind === "other") return false;
    return input.lines.every((line) => {
      const child = line.completed ? reportedTurn(lookup(line.childId), input.at) : null;
      return child !== null && isQuietTurn(child, lookup, depth + 1);
    });
  });
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
        const child = reportedTurn(lookup(line.childId), input.at);
        if (child !== null) for (const ref of originsOf(line.childId, child, lookup, depth + 1)) add(ref);
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
