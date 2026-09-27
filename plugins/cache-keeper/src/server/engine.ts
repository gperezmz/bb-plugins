/**
 * Cache Keeper's engine: watches Claude Code threads through bb, reads their
 * transcripts on the machine that runs them, and sends the compaction,
 * keep-warm or check-in the rules in `src/core` call for.
 *
 * It works one thread tree at a time. Each pass reads the turns every thread
 * in the tree took from bb's event history, settles which were Cache Keeper's
 * and what they cost, puts back the read state quiet turns changed, then plans
 * the tree's keep-warms together and each thread's compaction and check-ins on
 * their own.
 *
 * Everything bb, the host entry and the clock provide comes in through
 * `EngineDeps`, so a test drives it with fakes.
 */
import { afterActivity, afterCheckIn, foldDue, type TaskClock } from "../core/checkins";
import { estimateKeepWarmUsd, requestsIn, requestsUsd } from "../core/cost";
import { newIdleStretch, pastCostStop, plan, scheduledBeyondStop, type IdleStretch, type KeeperPlan } from "../core/keeper";
import { compactionUsd, DEFAULT_CALLS_PER_MESSAGE, DEFAULT_POST_COMPACTION, DEFAULT_SETTING, linesFor, ratesOf, type Rates } from "../core/line";
import { checkInText, COMPACT_MESSAGE, keepWarmText, type CheckInTask, type SentKind } from "../core/messages";
import type { PriceBook } from "../core/pricing";
import { CACHE_MARGIN_MS, callsPerMessage, deadlineOf, lifetimeMs, type ReportTurn, type TranscriptFacts, type TranscriptRequest } from "../core/transcript";
import { planTree, topOf, type TreeNode, type TreePlan } from "../core/tree";
import {
  classify,
  emptyTurnLog,
  foldTurns,
  isKeeperTurn,
  isQuietTurn,
  originsOf,
  reportedTurn,
  reportPending,
  REPORT_WAIT_MS,
  type BbEvent,
  type Turn,
  type TurnLog,
} from "../core/turns";
import { countItems, type ThreadView, type WaitCounts } from "../core/view";
import { hasOwnWork, waitingChildren, type TaskKind, type WaitItem, type WaitThread } from "../core/waiting";
import type { KeeperSettings } from "./settings";
import type { ReadBefore, Store, TaskRecord, ThreadRecord } from "./store";

/** A thread as `threads.list` gives it. */
export interface ListedThread {
  id: string;
  providerId: string;
  status: string;
  parentThreadId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  title: string | null;
  titleFallback: string | null;
  hasPendingInteraction: boolean;
  environmentHostId: string | null;
  queuedWork: string;
  activity: { activeBackgroundCommandCount: number; activeBackgroundAgentCount: number };
  lastReadAt: number | null;
  latestAttentionAt: number | null;
}

/** A background-task event from bb. */
export interface TaskEvent {
  seq: number;
  type: string;
  createdAt: number;
  item: { type?: string; familyId?: string; taskType?: string; description?: string; taskStatus?: string } | null;
}

/** A queued row as `threads.queuedMessages.list` gives it. */
export interface QueuedRow {
  id: string;
  sendAt: number | null;
  createdAt: number;
  failed: boolean;
  /** bb queued it itself, as a report of child turns or another notice. */
  system: boolean;
  content: unknown[];
}

export interface TranscriptRead {
  found: boolean;
  cwdSlug: string | null;
  facts: TranscriptFacts;
  requests: TranscriptRequest[];
  reports: ReportTurn[];
}

export interface ReadState {
  lastReadAt: number | null;
  latestAttentionAt: number | null;
}

export interface EngineDeps {
  store: Store;
  now(): number;
  settings(): KeeperSettings;
  prices(): PriceBook;
  listThreads(): Promise<ListedThread[]>;
  queuedMessages(threadId: string): Promise<QueuedRow[]>;
  deleteQueued(threadId: string, queuedMessageId: string): Promise<void>;
  contextWindow(threadId: string): Promise<number | null>;
  sessionId(threadId: string): Promise<string | null>;
  taskEvents(threadId: string, afterSeq: number): Promise<TaskEvent[]>;
  /** A page of the thread's turn events after `afterSeq`, oldest first. */
  turnEvents(threadId: string, afterSeq: number): Promise<BbEvent[]>;
  /** The seq of the thread's newest event, 0 for none. */
  latestEventSeq(threadId: string): Promise<number>;
  transcript(hostId: string, sessionId: string, requestsSince: number | null): Promise<TranscriptRead>;
  tasks(
    hostId: string,
    input: { sessionId: string; cwdSlug: string; commands: string[]; subagents: string[] },
  ): Promise<{ commands: { id: string; outputFile: string; changedAt: number | null }[]; subagents: { id: string; lastTool: string | null; changedAt: number | null }[] }>;
  /** Sends as a new turn, with Cache Keeper's `pluginSubmission` marker. */
  send(threadId: string, text: string, marker: { kind: SentKind; sendId: number }): Promise<void>;
  readState(threadId: string): Promise<ReadState>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
  publish(threadIds: string[]): void;
  log: { info(m: string): void; warn(m: string): void };
}

/** Everything read about one thread in one pass. */
interface Observed {
  thread: ListedThread;
  waiting: boolean;
  items: WaitItem[];
  /** Children whose report is on its way. */
  pendingReports: string[];
  facts: TranscriptFacts | null;
  cwdSlug: string | null;
  sessionId: string | null;
  window: number;
  rates: Rates | null;
  priceOrigin: string | null;
  lines: (number | null)[];
  callsPerMessage: number;
  postCompaction: number;
  deadline: number | null;
  lifetimeMs: number | null;
}

const DEFAULT_WINDOW = 200_000;
/** A send whose turn never ended is given up on after this long. */
const IN_FLIGHT_MS = 10 * 60_000;
export const DAY_MS = 86_400_000;
/** The most events bb 0.44 returns for one `threads.events.list` call. */
export const EVENTS_PAGE = 100;
/** How far back a thread's history is read the first time: enough for its recent turns. */
const FIRST_READ_EVENTS = 400;
const LAST_SETTING_META = "lastSetting";
/** How long a thread a surface showed keeps being read on every pass. */
const VIEWED_MS = 10 * 60_000;
/** Allowance between bb's clock and a transcript's when matching a report turn. */
const TURN_SLACK_MS = 5_000;

export class ClaudeOnlyError extends Error {}
export class NotReadyError extends Error {}

const isRead = (s: ReadState) => s.lastReadAt !== null && (s.latestAttentionAt === null || s.lastReadAt >= s.latestAttentionAt);

export class Engine {
  private threads = new Map<string, ListedThread>();
  private views = new Map<string, ThreadView>();
  private observed = new Map<string, Observed>();
  private passing: Promise<void> | null = null;
  private again = false;
  private windows = new Map<string, number>();
  /** Queued rows each thread counts as waiting on, where bb's flag alone does not say. */
  private queuedCounts = new Map<string, number>();
  private queuedRows = new Map<string, QueuedRow[]>();
  /** Queued report rows, by thread, that bring nothing new and are not waited on. */
  private quietRows = new Map<string, Set<string>>();
  /** When a surface last asked for each thread; a thread stays read for a while after. */
  private viewedAt = new Map<string, number>();
  private wake: number | null = null;

  constructor(private readonly deps: EngineDeps) {}

  /** The setting a thread switched on for the first time starts at. */
  lastSetting(): number {
    return this.deps.store.getMeta<number>(LAST_SETTING_META) ?? DEFAULT_SETTING;
  }

  /** When the next send falls due, so the caller can run a pass then rather than on its next poll. */
  wakeAt(): number | null {
    return this.wake;
  }

  // ---- bb events ----

  /** A thread turned idle: its turn is read and settled, and whatever now falls due is sent. */
  async onIdle(_threadId: string): Promise<void> {
    await this.pass();
  }

  /**
   * A thread turned active. If Cache Keeper sent nothing, a report or a message
   * started the turn: its read state now is the one to put back if the turn
   * turns out quiet. A report leaves bb's read state as it was.
   */
  async onActive(threadId: string): Promise<void> {
    if (!this.deps.store.has(threadId) || this.threads.get(threadId)?.providerId !== "claude-code") return;
    const now = this.deps.now();
    const record = this.deps.store.get(threadId);
    if (record.readBefore !== null || record.inFlight !== null) return;
    const state = await this.deps.readState(threadId);
    this.deps.store.update(threadId, now, (r) => (r.readBefore !== null ? r : { ...r, readBefore: { read: isRead(state), lastReadAt: state.lastReadAt, since: now } }));
  }

  // ---- the pass ----

  /** Reads every thread tree and acts where a rule says so; one pass at a time, and one more if asked for during it. */
  async pass(): Promise<void> {
    if (this.passing !== null) {
      this.again = true;
      await this.passing;
      return;
    }
    this.passing = (async () => {
      do {
        this.again = false;
        await this.run();
      } while (this.again);
    })().finally(() => {
      this.passing = null;
    });
    await this.passing;
  }

  /** bb's threads, with the queued rows of any whose queue needs reading. */
  private async load(): Promise<ListedThread[]> {
    const listed = await this.deps.listThreads();
    this.threads = new Map(listed.map((t) => [t.id, t]));
    return listed;
  }

  private toWait = (t: ListedThread): WaitThread => ({
    id: t.id,
    parentThreadId: t.parentThreadId,
    status: t.status,
    archived: t.archivedAt !== null,
    deleted: t.deletedAt !== null,
    title: t.title ?? t.titleFallback ?? t.id,
    createdAt: t.createdAt,
    activeBackgroundCommandCount: t.activity.activeBackgroundCommandCount,
    activeBackgroundAgentCount: t.activity.activeBackgroundAgentCount,
    queuedMessageCount: this.queuedCounts.get(t.id) ?? (t.queuedWork === "waiting" ? 1 : 0),
  });

  private async run(): Promise<void> {
    const listed = await this.load();
    const live = listed.filter((t) => t.archivedAt === null && t.deletedAt === null);
    const liveIds = new Set(live.map((t) => t.id));
    const trees = new Map<string, ListedThread[]>();
    for (const t of live) {
      const top = topOf(t.id, (id) => {
        const parent = this.threads.get(id)?.parentThreadId ?? null;
        return parent !== null && liveIds.has(parent) ? parent : null;
      });
      trees.set(top, [...(trees.get(top) ?? []), t]);
    }
    const changed: string[] = [];
    const wakes: number[] = [];
    for (const members of trees.values()) {
      const before = new Map(members.map((m) => [m.id, JSON.stringify(this.views.get(m.id) ?? null)]));
      try {
        const wake = await this.runTree(members, live);
        if (wake !== null) wakes.push(wake);
      } catch (error) {
        // A view from before the failure would show a state bb has moved on from.
        for (const m of members) this.views.delete(m.id);
        this.deps.log.warn(`tree of ${members[0]!.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const m of members) if (JSON.stringify(this.views.get(m.id) ?? null) !== before.get(m.id)) changed.push(m.id);
    }
    // Threads no longer listed are archived or deleted: forget their stretch.
    const now = this.deps.now();
    for (const { threadId, record } of this.deps.store.all()) {
      if (!liveIds.has(threadId) && (record.stretch !== null || record.inFlight !== null || record.readBefore !== null)) {
        this.deps.store.put(threadId, { ...record, stretch: null, inFlight: null, readBefore: null }, now);
        if (this.views.delete(threadId)) changed.push(threadId);
      }
    }
    for (const id of [...this.views.keys()]) if (!liveIds.has(id) && this.views.delete(id)) changed.push(id);
    this.wake = wakes.length === 0 ? null : Math.min(...wakes);
    if (changed.length > 0) this.deps.publish(changed);
  }

  private isClaude(threadId: string): boolean {
    return this.threads.get(threadId)?.providerId === "claude-code";
  }

  /** Whether keep-warms or check-ins could apply: idle, waiting by bb's counts, and the setting on. */
  private mayAct(thread: ListedThread, live: ListedThread[], settings: KeeperSettings): boolean {
    return settings.checkIns && thread.status === "idle" && this.waitsByCounts(thread, live);
  }

  private waitsByCounts(thread: ListedThread, live: ListedThread[]): boolean {
    return hasOwnWork(this.toWait(thread)) || waitingChildren(thread.id, live.map(this.toWait)).length > 0;
  }

  private interesting(thread: ListedThread, live: ListedThread[], settings: KeeperSettings, now: number): boolean {
    if (thread.providerId !== "claude-code") return false;
    const record = this.deps.store.get(thread.id);
    const viewed = now - (this.viewedAt.get(thread.id) ?? -Infinity) < VIEWED_MS;
    return record.compactOn || record.stretch?.compactedAt != null || viewed || this.mayAct(thread, live, settings);
  }

  /** One thread tree: read, settle, plan, act. Returns when anything in it next falls due. */
  private async runTree(members: ListedThread[], live: ListedThread[]): Promise<number | null> {
    const settings = this.deps.settings();
    let now = this.deps.now();
    await this.readQueues(members);
    const claude = members.filter((m) => m.providerId === "claude-code");
    const open = claude.some((m) => {
      const r = this.deps.store.get(m.id);
      return r.inFlight !== null || r.readBefore !== null;
    });
    const active = claude.filter((m) => this.interesting(m, live, settings, now));
    if (active.length === 0 && !open) {
      for (const m of members) this.views.delete(m.id);
      return null;
    }

    // Every thread's turns, Claude Code or not: a report climbs through all of them.
    const logs = new Map<string, TurnLog>();
    for (const m of members) logs.set(m.id, await this.readTurns(m.id));
    const lookup = (id: string) => logs.get(id) ?? null;

    for (const m of claude) await this.settle(m, lookup);
    await this.deleteQuietReports(claude, logs);
    for (const m of claude) await this.restoreRead(m, lookup);

    now = this.deps.now();
    const observed = new Map<string, Observed>();
    const plans = new Map<string, KeeperPlan>();
    for (const m of claude) {
      if (!active.includes(m)) {
        this.views.delete(m.id);
        continue;
      }
      let record = this.syncStretch(m, live, settings, now);
      let o = await this.observe(m, members, live, record, logs, now);
      if (o.waiting) {
        record = await this.watchTasks(m, o, record);
        o = { ...o, items: [...o.items.filter((i) => i.kind !== "command" && i.kind !== "subagent"), ...taskItems(record)] };
      } else if (Object.keys(record.tasks).length > 0) record = { ...record, tasks: {} };
      this.deps.store.put(m.id, record, now);
      observed.set(m.id, o);
      this.observed.set(m.id, o);
      plans.set(m.id, plan(this.keeperInput(o, record, now, settings)));
    }

    const nodes = members.map((m) => this.treeNode(m, observed, settings));
    const tree = planTree(nodes, now);
    for (const [id, o] of observed) this.views.set(id, this.view(o, this.deps.store.get(id), plans.get(id)!, tree, settings));

    // Own rules first: a check-in or compaction refreshes the cache a keep-warm would.
    const acted = new Set<string>();
    for (const [id, p] of plans) {
      const o = observed.get(id)!;
      if (p.action === null || this.deps.store.get(id).inFlight !== null) continue;
      const sent = p.action.kind === "compact" ? await this.sendCompact(id, o) : await this.sendCheckIn(o, p.action.tasks);
      if (sent) acted.add(id);
    }
    const due = tree.due.filter((d) => !acted.has(d.id) && observed.has(d.id) && this.deps.store.get(d.id).inFlight === null);
    const together = due.filter((d) => d.tree).map((d) => d.id);
    if (together.length > 0) await this.sendKeepWarms(together, observed, members[0]!.id);
    for (const d of due.filter((d) => !d.tree)) await this.sendKeepWarms([d.id], observed, d.id);
    if (acted.size > 0 || due.length > 0) {
      for (const [id, o] of observed) this.views.set(id, this.view(o, this.deps.store.get(id), plans.get(id)!, tree, settings));
    }

    const wakes = [tree.wakeAt, ...[...plans.values()].map((p) => p.wakeAt)].filter((w): w is number => w !== null);
    // A report still on its way stops holding things once it is given up on.
    for (const o of observed.values()) for (const c of o.pendingReports) {
      const ended = logs.get(c)?.turns.at(-1)?.endedAt;
      if (ended != null) wakes.push(ended + REPORT_WAIT_MS);
    }
    return wakes.length === 0 ? null : Math.min(...wakes);
  }

  // ---- reading ----

  /** Lists the queued rows of every thread whose queue holds any, since failed and quiet rows are not waited on. */
  private async readQueues(members: ListedThread[]): Promise<void> {
    for (const m of members) {
      this.queuedRows.delete(m.id);
      this.queuedCounts.delete(m.id);
      this.quietRows.delete(m.id);
      if (m.queuedWork === "none") continue;
      const rows = await this.deps.queuedMessages(m.id).catch(() => null);
      if (rows === null) continue;
      this.queuedRows.set(m.id, rows);
      this.queuedCounts.set(m.id, rows.filter((r) => !r.failed).length);
    }
  }

  /** Brings a thread's turn log up to date from bb's events. */
  private async readTurns(threadId: string): Promise<TurnLog> {
    let log = this.deps.store.turnLog(threadId);
    if (log === null) log = emptyTurnLog(Math.max(0, (await this.deps.latestEventSeq(threadId)) - FIRST_READ_EVENTS));
    const before = log.afterSeq;
    for (let page = 0; page < 100; page++) {
      const events = await this.deps.turnEvents(threadId, log.afterSeq);
      log = foldTurns(log, events);
      if (events.length < EVENTS_PAGE) break;
    }
    if (log.afterSeq !== before || this.deps.store.turnLog(threadId) === null) this.deps.store.putTurnLog(threadId, log);
    return log;
  }

  /**
   * Takes each turn that ended since the last pass: a real one ends the idle
   * stretch; a Cache Keeper one is charged at its real cost, split equally
   * between the messages that caused it.
   */
  private async settle(thread: ListedThread, lookup: (id: string) => TurnLog | null): Promise<void> {
    const log = lookup(thread.id)!;
    const now = this.deps.now();
    let record = this.deps.store.get(thread.id);
    const ended = log.turns.filter((t) => t.startSeq > record.settledSeq && t.endedAt !== null);
    const first = this.deps.store.has(thread.id) ? null : ended.at(-1)?.startSeq;
    // A thread seen for the first time starts from now: its past turns are nobody's to charge.
    if (first != null) {
      this.deps.store.put(thread.id, { ...record, settledSeq: first }, now);
      return;
    }
    const upTo = log.turns.find((t) => t.startSeq > record.settledSeq && t.endedAt === null)?.startSeq ?? Infinity;
    const due = ended.filter((t) => t.startSeq < upTo);
    if (due.length === 0) return;
    let requests: TranscriptRequest[] | null = null;
    let price: ReturnType<PriceBook["lookup"]> = null;
    for (const turn of due) {
      const keeper = isKeeperTurn(turn, lookup);
      if (record.inFlight !== null && turn.startedAt >= record.inFlight.at - TURN_SLACK_MS && turn.inputs.some((i) => i.kind === "sent")) record = { ...record, inFlight: null };
      if (!keeper) {
        if (record.stretch !== null) {
          if (record.stretch.compactedAt != null) this.recordReturn(thread.id, record, turn.startedAt);
          record = { ...record, stretch: null };
        }
      } else {
        if (requests === null) {
          const read = await this.readRequests(thread, due[0]!.startedAt);
          requests = read?.requests ?? [];
          price = read?.price ?? null;
        }
        const usd = price === null ? null : requestsUsd(requestsIn(requests, turn.startedAt, turn.endedAt!), price.price);
        if (usd !== null) this.charge(thread.id, turn, usd, lookup);
        record = this.deps.store.get(thread.id).stretch === record.stretch ? record : { ...record, stretch: this.deps.store.get(thread.id).stretch };
      }
      record = { ...record, settledSeq: turn.startSeq };
    }
    this.deps.store.put(thread.id, record, now);
  }

  private async readRequests(thread: ListedThread, since: number): Promise<{ requests: TranscriptRequest[]; price: ReturnType<PriceBook["lookup"]> } | null> {
    const sessionId = await this.deps.sessionId(thread.id);
    if (sessionId === null || thread.environmentHostId === null) return null;
    const read = await this.deps.transcript(thread.environmentHostId, sessionId, since - TURN_SLACK_MS);
    return { requests: read.requests, price: this.deps.prices().lookup(read.facts.model) };
  }

  /** Charges a Cache Keeper turn in `threadId` to the messages behind it, and to the stretches they were sent in. */
  private charge(threadId: string, turn: Turn, usd: number, lookup: (id: string) => TurnLog | null): void {
    const sends = originsOf(threadId, turn, lookup)
      .map((ref) => this.deps.store.findSend(ref.threadId, ref.text, ref.at))
      .filter((s) => s !== null);
    if (sends.length === 0) return;
    const share = usd / sends.length;
    const now = this.deps.now();
    for (const send of sends) {
      this.deps.store.chargeSend(send.id, threadId, share, send.threadId === threadId);
      this.deps.store.update(send.threadId, now, (r) =>
        r.stretch !== null && r.stretch.startedAt === send.stretchStartedAt ? { ...r, stretch: { ...r.stretch, chargedUsd: r.stretch.chargedUsd + share } } : r,
      );
    }
  }

  /** The first message back after a compaction: what the cold rewrite it spared would have cost. */
  private recordReturn(threadId: string, record: ThreadRecord, now: number): void {
    const c = record.compaction;
    if (c === null || c.w === null || c.lifetimeMs === null || c.contextAfter === null) return;
    // Back before the cache would have gone cold, the compaction spared nothing.
    if (now < c.at + c.lifetimeMs) return;
    this.deps.store.addHistory(threadId, now, "return", { usd: null, avoidedUsd: Math.max(0, c.w * (c.contextBefore - c.contextAfter)) });
  }

  /**
   * Deletes, from a thread waiting on your answer, bb's queued report rows
   * whose every line reports a Cache Keeper turn that brought nothing new.
   * Such rows are not waited on even when the delete fails.
   */
  private async deleteQuietReports(claude: ListedThread[], logs: Map<string, TurnLog>): Promise<void> {
    const lookup = (id: string) => logs.get(id) ?? null;
    for (const m of claude) {
      if (!m.hasPendingInteraction) continue;
      const rows = this.queuedRows.get(m.id) ?? [];
      const quiet = rows.filter((row) => {
        if (row.failed || !row.system) return false;
        const input = classify(row.content, row.createdAt);
        if (input.kind !== "report") return false;
        return input.lines.every((line) => {
          const turn = line.completed ? reportedTurn(lookup(line.childId), row.createdAt) : null;
          return turn !== null && isQuietTurn(turn, lookup);
        });
      });
      if (quiet.length === 0) continue;
      this.quietRows.set(m.id, new Set(quiet.map((r) => r.id)));
      this.queuedCounts.set(m.id, Math.max(0, (this.queuedCounts.get(m.id) ?? 0) - quiet.length));
      const log = logs.get(m.id)!;
      const delivered = [...log.delivered];
      for (const row of quiet) {
        try {
          await this.deps.deleteQueued(m.id, row.id);
        } catch (error) {
          this.deps.log.warn(`could not delete a quiet report row from ${m.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const input = classify(row.content, row.createdAt);
        if (input.kind === "report") for (const line of input.lines) delivered.push({ childId: line.childId, at: row.createdAt });
      }
      const next = { ...log, delivered };
      logs.set(m.id, next);
      this.deps.store.putTurnLog(m.id, next);
    }
  }

  /**
   * Once every turn since a Cache Keeper message or a report arrived has
   * ended, and each brought nothing new, puts the thread's read state back to
   * what it was before, unless you changed it since.
   */
  private async restoreRead(thread: ListedThread, lookup: (id: string) => TurnLog | null): Promise<void> {
    const record = this.deps.store.get(thread.id);
    const before = record.readBefore;
    if (before === null) return;
    const now = this.deps.now();
    const turns = lookup(thread.id)!.turns.filter((t) => t.startedAt >= before.since - TURN_SLACK_MS);
    const clear = () => this.deps.store.update(thread.id, now, (r) => ({ ...r, readBefore: null }));
    if (turns.length === 0) {
      if (now - before.since >= IN_FLIGHT_MS) clear();
      return;
    }
    if (thread.status !== "idle" || turns.some((t) => t.endedAt === null)) return;
    clear();
    if (!turns.every((t) => isQuietTurn(t, lookup))) return;
    await this.putBack(thread.id, before);
  }

  private async putBack(threadId: string, before: ReadBefore): Promise<void> {
    const state = await this.deps.readState(threadId);
    if (state.lastReadAt !== before.lastReadAt) return;
    if (before.read && !isRead(state)) await this.deps.markRead(threadId);
    else if (!before.read && isRead(state)) await this.deps.markUnread(threadId);
  }

  /** After a restart, bb's status is the truth: an idle thread with work for Cache Keeper is in a stretch. */
  private syncStretch(thread: ListedThread, live: ListedThread[], settings: KeeperSettings, now: number): ThreadRecord {
    const stored = this.deps.store.has(thread.id);
    let record = this.deps.store.get(thread.id);
    if (thread.status === "idle" && record.stretch === null && (stored || this.mayAct(thread, live, settings))) {
      record = { ...record, stretch: newIdleStretch(now) };
    }
    if (record.inFlight !== null && now - record.inFlight.at >= IN_FLIGHT_MS) record = { ...record, inFlight: null };
    this.deps.store.put(thread.id, record, now);
    return record;
  }

  private async observe(thread: ListedThread, members: ListedThread[], live: ListedThread[], record: ThreadRecord, logs: Map<string, TurnLog>, now: number): Promise<Observed> {
    const items: WaitItem[] = [...taskItems(record)];
    const children = waitingChildren(thread.id, live.map(this.toWait));
    for (const child of children) items.push({ kind: "child", id: child.id, title: child.title, startedAt: child.createdAt });
    const pendingReports = members
      .filter((c) => c.parentThreadId === thread.id && reportPending(logs.get(thread.id) ?? null, c.id, logs.get(c.id) ?? null, now))
      .map((c) => c.id);
    for (const id of pendingReports) {
      if (children.some((c) => c.id === id)) continue;
      const c = this.threads.get(id)!;
      items.push({ kind: "child", id, title: c.title ?? c.titleFallback ?? id, startedAt: c.createdAt });
    }
    const quiet = this.quietRows.get(thread.id);
    for (const q of this.queuedRows.get(thread.id) ?? []) {
      if (q.failed || quiet?.has(q.id)) continue;
      items.push(q.sendAt !== null ? { kind: "scheduled", dueAt: q.sendAt, createdAt: q.createdAt } : { kind: "queued", createdAt: q.createdAt });
    }
    const waiting = this.waitsByCounts(thread, live) || items.length > 0;

    const sessionId = await this.deps.sessionId(thread.id);
    let facts: TranscriptFacts | null = null;
    let cwdSlug: string | null = null;
    let reports: ReportTurn[] = [];
    if (sessionId !== null && thread.environmentHostId !== null) {
      const read = await this.deps.transcript(thread.environmentHostId, sessionId, null);
      if (read.found) {
        facts = read.facts;
        cwdSlug = read.cwdSlug;
        reports = read.reports;
      }
    }
    // bb learns the window from the thread's turns, so it is asked again until it answers, and again when the model changes.
    const windowKey = `${thread.id}\0${facts?.model ?? ""}`;
    let window = this.windows.get(windowKey);
    if (window === undefined) {
      const known = await this.deps.contextWindow(thread.id).catch(() => null);
      if (known !== null) this.windows.set(windowKey, known);
      window = known ?? DEFAULT_WINDOW;
    }
    const price = this.deps.prices().lookup(facts?.model ?? null);
    const rates = price !== null && facts?.lifetime != null ? ratesOf(price.price, facts.lifetime) : null;
    const k = facts === null ? DEFAULT_CALLS_PER_MESSAGE : callsPerMessage(facts, DEFAULT_CALLS_PER_MESSAGE, keeperReports(reports, logs.get(thread.id)!, (id) => logs.get(id) ?? null));
    const p = facts?.lastCompaction?.postTokens ?? DEFAULT_POST_COMPACTION;
    const lines = rates === null ? Array.from({ length: 10 }, () => null) : linesFor({ rates, k, p, window });
    return {
      thread,
      waiting,
      items,
      pendingReports,
      facts,
      cwdSlug,
      sessionId,
      window,
      rates,
      priceOrigin: price?.origin ?? null,
      lines,
      callsPerMessage: k,
      postCompaction: p,
      deadline: facts === null ? null : deadlineOf(facts),
      lifetimeMs: facts?.lifetime == null ? null : lifetimeMs(facts.lifetime),
    };
  }

  /** Brings the thread's background tasks and their clocks up to date from bb's events and the host. */
  private async watchTasks(thread: ListedThread, observed: Observed, record: ThreadRecord): Promise<ThreadRecord> {
    const tasks: Record<string, TaskRecord> = { ...record.tasks };
    let afterSeq = record.eventsAfterSeq;
    for (let page = 0; page < 100; page++) {
      const events = await this.deps.taskEvents(thread.id, afterSeq);
      for (const e of events) {
        afterSeq = Math.max(afterSeq, e.seq);
        const item = e.item;
        // bb calls a task's id its `familyId`.
        if (item?.type !== "backgroundTask" || item.familyId === undefined) continue;
        const kind = item.taskType === "local_bash" ? "command" : item.taskType === "local_agent" ? "subagent" : null;
        if (kind === null) continue;
        const running = item.taskStatus === "running" || item.taskStatus === "pending";
        if (e.type === "item/backgroundTask/completed" || !running) {
          delete tasks[item.familyId];
        } else if (tasks[item.familyId] === undefined) {
          const clock: TaskClock = { startedAt: e.createdAt, lastActivityAt: e.createdAt, lastCheckInAt: null, stalledStreak: 0 };
          tasks[item.familyId] = { kind, description: item.description ?? "", clock };
        } else if (e.type === "item/backgroundTask/progress" && kind === "subagent") {
          // A command's progress is its output file, read below; bb's events for it say nothing of its output.
          const task = tasks[item.familyId]!;
          tasks[item.familyId] = { ...task, clock: afterActivity(task.clock, e.createdAt) };
        }
      }
      if (events.length < EVENTS_PAGE) break;
    }
    // A command's output file is its progress.
    const commands = Object.entries(tasks).filter(([, t]) => t.kind === "command").map(([id]) => id);
    if (commands.length > 0 && observed.sessionId !== null && observed.cwdSlug !== null && thread.environmentHostId !== null) {
      const read = await this.deps.tasks(thread.environmentHostId, { sessionId: observed.sessionId, cwdSlug: observed.cwdSlug, commands, subagents: [] });
      for (const c of read.commands) {
        const task = tasks[c.id];
        if (task !== undefined && c.changedAt !== null) tasks[c.id] = { ...task, clock: afterActivity(task.clock, c.changedAt) };
      }
    }
    return { ...record, tasks, eventsAfterSeq: afterSeq };
  }

  private keeperInput(observed: Observed, record: ThreadRecord, now: number, settings: KeeperSettings) {
    const setting = record.setting ?? this.lastSetting();
    return {
      now,
      claudeCode: observed.thread.providerId === "claude-code",
      status: observed.thread.status,
      hasPendingInteraction: observed.thread.hasPendingInteraction,
      waiting: observed.waiting,
      tasks: Object.entries(record.tasks).map(([id, t]) => ({ kind: t.kind, id, clock: t.clock })),
      deadline: observed.deadline,
      context: observed.facts?.context ?? null,
      compactOn: record.compactOn,
      line: observed.lines[setting - 1] ?? null,
      stretch: record.stretch,
      checkIns: settings.checkIns,
      waitMs: settings.waitMs,
    };
  }

  /** What the next keep-warm to a thread is expected to cost, with the turns it forces above. */
  private forecast(threadId: string, observed: Map<string, Observed>): number {
    const record = this.deps.store.get(threadId);
    const last = record.lastSendId === null ? null : this.deps.store.getSend(record.lastSendId);
    if (last !== null && last.measured) return last.usd;
    const chain: Observed[] = [];
    for (let id: string | null = threadId, d = 0; id !== null && d < 64; id = this.threads.get(id)?.parentThreadId ?? null, d++) {
      const o = observed.get(id);
      if (o !== undefined) chain.push(o);
    }
    return estimateKeepWarmUsd(chain.map((o) => ({ rates: o.rates, context: o.facts?.context ?? null })));
  }

  private treeNode(m: ListedThread, observed: Map<string, Observed>, settings: KeeperSettings): TreeNode {
    const o = observed.get(m.id);
    const parentId = m.parentThreadId !== null && this.threads.has(m.parentThreadId) ? m.parentThreadId : null;
    if (o === undefined) {
      return { id: m.id, parentId, keepable: false, deadline: null, lifetimeMs: null, blocks: false, selfOff: false, inFlight: false, reportPending: false };
    }
    const record = this.deps.store.get(m.id);
    const stretch = record.stretch;
    const context = o.facts?.context ?? null;
    const forecast = this.forecast(m.id, observed);
    const charged = stretch?.chargedUsd ?? 0;
    return {
      id: m.id,
      parentId,
      keepable: settings.checkIns && m.status === "idle" && !m.hasPendingInteraction && o.waiting && stretch !== null,
      deadline: o.deadline,
      lifetimeMs: o.lifetimeMs,
      blocks: stretch !== null && (stretch.warmSkipped || pastCostStop(charged, forecast, o.rates, context)),
      selfOff: scheduledBeyondStop({ items: o.items, chargedUsd: charged, forecastUsd: forecast, rates: o.rates, context, deadline: o.deadline, lifetimeMs: o.lifetimeMs }),
      inFlight: record.inFlight !== null,
      reportPending: o.pendingReports.length > 0,
    };
  }

  private view(observed: Observed, record: ThreadRecord, decided: KeeperPlan, tree: TreePlan, settings: KeeperSettings): ThreadView {
    const { thread, facts } = observed;
    const setting = record.setting ?? this.lastSetting();
    return {
      threadId: thread.id,
      title: thread.title ?? thread.titleFallback ?? thread.id,
      eligible: thread.providerId === "claude-code",
      status: thread.status,
      hasPendingInteraction: thread.hasPendingInteraction,
      compactOn: record.compactOn,
      setting,
      lines: observed.lines,
      line: observed.lines[setting - 1] ?? null,
      context: facts?.context ?? null,
      window: observed.window,
      model: facts?.model ?? null,
      lifetime: facts?.lifetime ?? null,
      callsPerMessage: observed.callsPerMessage,
      callsMeasured: (facts?.userMessages ?? 0) > 0,
      postCompaction: observed.postCompaction,
      postMeasured: facts?.lastCompaction != null,
      priceOrigin: observed.priceOrigin,
      rates: observed.rates,
      deadline: observed.deadline,
      compactionDue: decided.compactionDue,
      compactSkipped: record.stretch?.compactSkipped ?? false,
      compactedAt: record.stretch?.compactedAt ?? null,
      canCompactNow: thread.status === "idle" && !thread.hasPendingInteraction && !observed.waiting && facts !== null,
      waiting: observed.waiting,
      checkIns: settings.checkIns,
      warmPlanned: tree.planned.has(thread.id),
      warmSkipped: record.stretch?.warmSkipped ?? false,
      nextWarmAt: tree.nextAt.get(thread.id) ?? null,
      counts: withBbCounts(countItems(observed.items), thread),
    };
  }

  // ---- sending ----

  /**
   * Sends keep-warms to `ids` at the same moment, as one page entry. Each asks
   * the agent to look at any task of its own that has run 30 minutes; a task
   * whose files cannot be read is asked about next time instead.
   */
  private async sendKeepWarms(ids: string[], observed: Map<string, Observed>, entryThreadId: string): Promise<void> {
    const now = this.deps.now();
    const texts = new Map<string, { text: string; folded: CheckInTask[] }>();
    for (const id of ids) {
      const o = observed.get(id)!;
      const record = this.deps.store.get(id);
      const due = Object.entries(record.tasks)
        .filter(([, t]) => foldDue(t.clock, now, this.deps.settings().waitMs))
        .map(([taskId]) => ({ id: taskId, reason: "routine" as const }));
      const folded = due.length === 0 ? [] : await this.checkInTasks(o, record, due, now);
      texts.set(id, { text: keepWarmText(o.items, folded), folded });
    }
    const folded = [...texts.values()].flatMap((t) => t.folded.map((f) => f.id));
    const historyId = this.deps.store.addHistory(ids.length === 1 ? ids[0]! : entryThreadId, now, "keep-warm", { usd: null, threads: ids, folded });
    for (const id of ids) {
      const { text, folded: asked } = texts.get(id)!;
      const sendId = await this.sendTracked(id, text, "keep-warm", historyId);
      if (sendId === null) continue;
      this.deps.store.update(id, now, (r) => {
        const tasks = { ...r.tasks };
        for (const t of asked) if (tasks[t.id] !== undefined) tasks[t.id] = { ...tasks[t.id]!, clock: afterCheckIn(tasks[t.id]!.clock, "routine", now) };
        return { ...r, tasks, lastSendId: sendId };
      });
    }
  }

  private async sendCheckIn(o: Observed, taskIds: string[]): Promise<boolean> {
    const now = this.deps.now();
    const record = this.deps.store.get(o.thread.id);
    const tasks = await this.checkInTasks(o, record, taskIds.map((id) => ({ id, reason: "stalled" as const })), now);
    if (tasks.length === 0) return false;
    const historyId = this.deps.store.addHistory(o.thread.id, now, "check-in", {
      usd: null,
      tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, reason: t.reason })),
    });
    const sendId = await this.sendTracked(o.thread.id, checkInText(tasks), "check-in", historyId);
    if (sendId === null) return false;
    this.deps.store.update(o.thread.id, now, (r) => {
      const next = { ...r.tasks };
      for (const t of tasks) if (next[t.id] !== undefined) next[t.id] = { ...next[t.id]!, clock: afterCheckIn(next[t.id]!.clock, "stalled", now) };
      return { ...r, tasks: next };
    });
    return true;
  }

  /**
   * The paragraphs for the tasks asked about. A task whose output file or
   * transcript could not be read on its machine is left for a later pass
   * rather than asked about without them.
   */
  private async checkInTasks(observed: Observed, record: ThreadRecord, asked: { id: string; reason: "stalled" | "routine" }[], now: number): Promise<CheckInTask[]> {
    const ids = (kind: TaskKind) => asked.filter((t) => record.tasks[t.id]?.kind === kind).map((t) => t.id);
    const hostId = observed.thread.environmentHostId;
    if (hostId === null || observed.sessionId === null || observed.cwdSlug === null) return [];
    let read: Awaited<ReturnType<EngineDeps["tasks"]>>;
    try {
      read = await this.deps.tasks(hostId, { sessionId: observed.sessionId, cwdSlug: observed.cwdSlug, commands: ids("command"), subagents: ids("subagent") });
    } catch (error) {
      this.deps.log.warn(`could not read ${observed.thread.id}'s background tasks; asking about them waits: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    const out: CheckInTask[] = [];
    for (const { id, reason } of asked) {
      const task = record.tasks[id];
      if (task === undefined) continue;
      const common = { id, reason, description: task.description, startedAt: task.clock.startedAt, silentMs: now - task.clock.lastActivityAt, runningMs: now - task.clock.startedAt };
      if (task.kind === "command") {
        const command = read.commands.find((c) => c.id === id);
        if (command !== undefined) out.push({ kind: "command", ...common, outputFile: command.outputFile });
      } else {
        const subagent = read.subagents.find((a) => a.id === id);
        if (subagent !== undefined) out.push({ kind: "subagent", ...common, lastTool: subagent.lastTool ?? "none yet" });
      }
    }
    return out;
  }

  private async sendCompact(threadId: string, observed: Observed): Promise<boolean> {
    const now = this.deps.now();
    const context = observed.facts?.context ?? 0;
    const rates = observed.rates;
    const lifetime = observed.facts?.lifetime ?? null;
    const historyId = this.deps.store.addHistory(threadId, now, "compaction", {
      usd: rates === null ? null : compactionUsd(rates, context),
      contextBefore: context,
      contextAfter: null,
    });
    const compaction = { historyId, at: now, contextBefore: context, contextAfter: null, w: rates?.w ?? null, lifetimeMs: lifetime === null ? null : lifetimeMs(lifetime) };
    this.deps.store.update(threadId, now, (r) => ({ ...r, compaction }));
    const sendId = await this.sendTracked(threadId, COMPACT_MESSAGE, "compact", historyId);
    if (sendId === null) return false;
    this.deps.store.update(threadId, now, (r) => ({ ...r, stretch: { ...(r.stretch ?? newIdleStretch(now)), compactedAt: now } }));
    return true;
  }

  /**
   * Records the send, marks it in flight and sends it. The thread's read state
   * from before is kept, with `lastReadAt` as bb left it after taking the
   * message (bb marks a thread read when a message is sent to it), so the turn
   * can put it back.
   */
  private async sendTracked(threadId: string, text: string, kind: SentKind, historyId: number): Promise<number | null> {
    const now = this.deps.now();
    const record = this.deps.store.get(threadId);
    const stretch: IdleStretch = record.stretch ?? newIdleStretch(now);
    const sendId = this.deps.store.addSend({ threadId, at: now, historyId, kind, text, stretchStartedAt: stretch.startedAt });
    const listed = this.threads.get(threadId);
    const wasRead = listed === undefined ? true : isRead({ lastReadAt: listed.lastReadAt, latestAttentionAt: listed.latestAttentionAt });
    this.deps.store.put(threadId, { ...record, stretch, inFlight: { kind, at: now, sendId } }, now);
    try {
      await this.deps.send(threadId, text, { kind, sendId });
    } catch (error) {
      this.deps.store.update(threadId, now, (r) => ({ ...r, inFlight: null }));
      this.deps.log.warn(`could not send ${kind} to ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const after = await this.deps.readState(threadId).catch(() => null);
    if (after !== null) {
      this.deps.store.update(threadId, now, (r) => (r.readBefore !== null ? r : { ...r, readBefore: { read: wasRead, lastReadAt: after.lastReadAt, since: now } }));
    }
    this.deps.publish([threadId]);
    return sendId;
  }

  // ---- what the surfaces ask ----

  /** The view of a thread, read now if the last pass skipped it. */
  async viewOf(threadId: string): Promise<ThreadView | null> {
    this.viewedAt.set(threadId, this.deps.now());
    if (!this.views.has(threadId)) {
      if (!this.threads.has(threadId)) await this.load();
      if (!this.isClaude(threadId)) return null;
      await this.pass();
    }
    return this.views.get(threadId) ?? null;
  }

  /** The views of every thread with compact when idle on, read now where the last pass has none. */
  async switchedOn(): Promise<ThreadView[]> {
    const ids = this.deps.store.compactOnIds();
    const now = this.deps.now();
    for (const id of ids) this.viewedAt.set(id, now);
    if (ids.some((id) => !this.views.has(id))) await this.pass().catch(() => {});
    return ids.map((id) => this.views.get(id)).filter((v): v is ThreadView => v !== undefined);
  }

  /** A thread's title as bb lists it, or its id. */
  titleOf(threadId: string): string {
    const t = this.threads.get(threadId);
    return t?.title ?? t?.titleFallback ?? threadId;
  }

  allViews(): ThreadView[] {
    return [...this.views.values()];
  }

  /** Switches compact-when-idle on or off, optionally at a setting. */
  async setCompact(threadId: string, on: boolean, setting?: number): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    const now = this.deps.now();
    this.deps.store.update(threadId, now, (r) => ({
      ...r,
      compactOn: on,
      setting: setting ?? r.setting ?? this.lastSetting(),
    }));
    if (setting !== undefined) this.deps.store.setMeta(LAST_SETTING_META, setting);
    else if (on && this.deps.store.getMeta(LAST_SETTING_META) === null) this.deps.store.setMeta(LAST_SETTING_META, this.lastSetting());
    return this.refresh(threadId);
  }

  async setSetting(threadId: string, setting: number): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    this.deps.store.update(threadId, this.deps.now(), (r) => ({ ...r, setting }));
    this.deps.store.setMeta(LAST_SETTING_META, setting);
    return this.refresh(threadId);
  }

  /** Skip, or undo a Skip, of the compaction until the thread next runs, or of the keep-warms for this wait, for it and every thread below it. */
  async skip(threadId: string, what: "compaction" | "warm", undo: boolean): Promise<ThreadView | null> {
    const now = this.deps.now();
    this.deps.store.update(threadId, now, (r) => {
      const stretch = r.stretch ?? newIdleStretch(now);
      return { ...r, stretch: what === "compaction" ? { ...stretch, compactSkipped: !undo } : { ...stretch, warmSkipped: !undo } };
    });
    return this.refresh(threadId);
  }

  /** Compacts now, over the line or not, when the thread is idle, has no pending interaction and is not waiting. */
  async compactNow(threadId: string): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    this.viewedAt.set(threadId, this.deps.now());
    await this.pass();
    const thread = this.threads.get(threadId)!;
    const observed = this.observed.get(threadId);
    const record = this.deps.store.get(threadId);
    if (thread.status !== "idle") throw new NotReadyError("the thread is working; it can be compacted once its turn ends");
    if (thread.hasPendingInteraction) throw new NotReadyError("the thread is waiting on your answer");
    if (observed === undefined || observed.waiting) throw new NotReadyError("the thread is waiting on background work, a child thread or a queued message");
    if (record.inFlight !== null) throw new NotReadyError("Cache Keeper already sent this thread a message that has not run yet");
    await this.sendCompact(threadId, observed);
    return this.refresh(threadId);
  }

  private async refresh(threadId: string): Promise<ThreadView | null> {
    this.views.delete(threadId);
    const view = await this.viewOf(threadId);
    this.deps.publish([threadId]);
    return view;
  }

  private async requireClaude(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) await this.load();
    const thread = this.threads.get(threadId);
    if (thread === undefined) throw new NotReadyError(`no thread ${threadId}`);
    if (thread.providerId !== "claude-code") throw new ClaudeOnlyError("Cache Keeper acts on Claude Code threads only");
  }

  /** Totals for the last `days` days; a keep-warm sent to several threads at once is one. */
  totals(days: number) {
    const rows = this.deps.store.history(this.deps.now() - days * DAY_MS, 100_000);
    const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + (r.record.usd ?? 0), 0);
    const count = (kind: string) => rows.filter((r) => r.kind === kind).length;
    return {
      compactions: count("compaction"),
      compactionUsd: sum("compaction"),
      keepWarms: count("keep-warm"),
      checkIns: count("check-in"),
      warmUsd: sum("keep-warm") + sum("check-in"),
      avoidedUsd: rows.filter((r) => r.kind === "return").reduce((s, r) => s + (r.record.avoidedUsd ?? 0), 0),
    };
  }
}

function taskItems(record: ThreadRecord): WaitItem[] {
  return Object.entries(record.tasks).map(([id, task]) => ({ kind: task.kind, id, description: task.description, startedAt: task.clock.startedAt }));
}

/** The transcript's report turns that bb's history says were Cache Keeper's. */
function keeperReports(reports: readonly ReportTurn[], log: TurnLog, lookup: (id: string) => TurnLog | null): ReportTurn[] {
  const keeper = log.turns.filter((t) => t.endedAt !== null && t.inputs.length > 0 && t.inputs.every((i) => i.kind === "report") && isKeeperTurn(t, lookup));
  return reports.filter((r) => keeper.some((t) => r.at >= t.startedAt - TURN_SLACK_MS && r.at <= t.endedAt! + TURN_SLACK_MS));
}

/** bb counts a background task before its events are read; the banner takes whichever count is higher. */
function withBbCounts(counts: WaitCounts, thread: ListedThread): WaitCounts {
  return {
    ...counts,
    commands: Math.max(counts.commands, thread.activity.activeBackgroundCommandCount),
    subagents: Math.max(counts.subagents, thread.activity.activeBackgroundAgentCount),
  };
}

export { CACHE_MARGIN_MS };
