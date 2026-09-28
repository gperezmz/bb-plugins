/**
 * Cache Keeper's engine: learns Claude Code threads from bb's events, reads
 * their transcripts on the machine that runs them, and sends the compaction,
 * keep-warm or check-in the rules in `src/core` call for.
 *
 * It runs on bb's events. When a thread's turn ends, the engine reads the
 * events bb added to it since the saved position (whose turns they were, the
 * background tasks, a new session), charges Cache Keeper's turns, and reads
 * the transcript on from its saved cursor if the thread's deadline matters.
 * Then it plans the thread's tree and sets the one timer for whatever falls
 * due first. Nothing walks every thread bb knows but the reconciliation
 * check, every 5 minutes, which corrects what a missed event left wrong.
 *
 * Every automatic send is checked against the thread as bb gives it afresh,
 * claimed for its due time so it never goes twice, and logged with the reason
 * when it is held back. Every write to a thread's record is a synchronous
 * change to the record as it stands, so a switch flipped while the engine
 * awaits bb or a host is never undone.
 *
 * Everything bb, the host entry and the clock provide comes in through
 * `EngineDeps`, so a test drives it with fakes.
 */
import { afterActivity, afterCheckIn, foldDue, stalledDueAt, type TaskClock } from "../core/checkins";
import type { Clock } from "../core/clock";
import { confirmSend, type FreshThread } from "../core/confirm";
import { estimateKeepWarmUsd, requestsIn, requestsUsd } from "../core/cost";
import { costStopUsd, newIdleStretch, pastCostStop, plan, scheduledBeyondStop, type IdleStretch, type KeeperPlan } from "../core/keeper";
import { compactionUsd, DEFAULT_CALLS_PER_MESSAGE, DEFAULT_POST_COMPACTION, DEFAULT_SETTING, linesFor, ratesOf, warmRatesOf, type Rates } from "../core/line";
import { checkInText, COMPACT_MESSAGE, keepWarmText, textHash, type CheckInTask, type SentKind } from "../core/messages";
import type { PriceBook } from "../core/pricing";
import { reasonText, type HoldReason } from "../core/reasons";
import { keptWarm, treeTopOf, treeTopsBelow, type ThreadRef } from "../core/switch";
import { CACHE_MARGIN_MS, callsPerMessage, deadlineOf, lifetimeMs, type TranscriptCursor, type TranscriptFacts, type TranscriptRequest } from "../core/transcript";
import { LEAD_PER_LEVEL_MS, planTree, type TreeNode, type TreePlan } from "../core/tree";
import {
  broughtNothingNew,
  classifyQueued,
  emptyTurnLog,
  foldTurns,
  isKeeperTurn,
  lineHolds,
  originsOf,
  reportLines,
  reportPending,
  REPORT_WAIT_MS,
  TURN_EVENT_TYPES,
  type BbEvent,
  type QueuedReportRow,
  type Turn,
  type TurnLog,
} from "../core/turns";
import { countItems, type ThreadView, type WaitCounts } from "../core/view";
import type { TaskKind, WaitItem } from "../core/waiting";
import { Scheduler, type Timers } from "./scheduler";
import type { KeeperSettings } from "./settings";
import type { Decision, ReadBefore, Store, TaskRecord, ThreadRecord } from "./store";
import { readThread, ThreadIndex, type Known } from "./threads";

/** Every event type the engine reads from a thread's history, in one call per turn end. */
export const EVENT_TYPES = [...TURN_EVENT_TYPES, "item/started", "item/backgroundTask/progress", "thread/identity"] as const;

/** A queued row as `threads.queuedMessages.list` gives it. */
export interface QueuedRow extends QueuedReportRow {
  id: string;
  sendAt: number | null;
}

/** A queued row from bb, as Cache Keeper reads it. */
export function queuedRowOf(raw: unknown): QueuedRow {
  const r = raw as { id: string; sendAt: number | null; createdAt: number; failureReason: string | null; initiator: string; content: unknown };
  return {
    id: r.id,
    sendAt: r.sendAt ?? null,
    createdAt: r.createdAt,
    failed: r.failureReason != null,
    system: r.initiator === "system",
    content: Array.isArray(r.content) ? r.content : [],
  };
}

export interface TranscriptRead {
  found: boolean;
  cwdSlug: string | null;
  cursor: TranscriptCursor | null;
  facts: TranscriptFacts;
  requests: TranscriptRequest[];
  bytesRead: number;
  unreadable: string | null;
}

export interface TaskActivity {
  commands: { id: string; outputFile: string; changedAt: number | null }[];
  subagents: { id: string; lastTool: string | null; changedAt: number | null }[];
}

export interface EngineDeps {
  store: Store;
  clock: Clock;
  timers?: Timers;
  settings(): KeeperSettings;
  prices(): PriceBook;
  /** Every thread bb lists, hidden ones included, as raw rows: one paged listing. */
  listThreads(): Promise<unknown[]>;
  /** The thread as `threads.get` gives it; null when bb has no such thread. */
  getThread(threadId: string): Promise<unknown | null>;
  /** The machine running the thread, from `threads.get` with its environment. */
  hostOf(threadId: string): Promise<string | null>;
  /** The thread's pending interactions as bb lists them. */
  pendingInteractions(threadId: string): Promise<unknown>;
  queuedMessages(threadId: string): Promise<QueuedRow[]>;
  deleteQueued(threadId: string, queuedMessageId: string): Promise<void>;
  /** The context window bb reports for the thread; null until it reports one. */
  contextWindow(threadId: string): Promise<number | null>;
  /** The Claude Code session id from bb's latest `thread/identity` event. */
  sessionId(threadId: string): Promise<string | null>;
  /** A page of the thread's events of `EVENT_TYPES` after `afterSeq`, oldest first; times are bb's. */
  events(threadId: string, afterSeq: number): Promise<BbEvent[]>;
  /** The seq of the thread's newest event, 0 for none. */
  latestEventSeq(threadId: string): Promise<number>;
  transcript(hostId: string, sessionId: string, cursor: TranscriptCursor | null): Promise<TranscriptRead>;
  tasks(hostId: string, input: { sessionId: string; cwdSlug: string; commands: string[]; subagents: string[] }): Promise<TaskActivity>;
  /** Keeps the machine's host worker alive for `ms` more. */
  retain(hostId: string, ms: number): Promise<void>;
  /** Starts a turn with the message; "busy" when bb refuses because the thread is active. */
  send(threadId: string, text: string): Promise<"sent" | "busy">;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
  publish(threadIds: string[]): void;
  log: { info(m: string): void; warn(m: string): void };
}

/** The most events bb 0.44 returns for one `threads.events.list` call. */
export const EVENTS_PAGE = 100;
export const DAY_MS = 86_400_000;
/** How far back a thread's history is read the first time: enough for its recent turns. */
const FIRST_READ_EVENTS = 400;
/** A send whose turn never ended is given up on after this long, and charged at its forecast. */
const IN_FLIGHT_MS = 10 * 60_000;
const LAST_SETTING_META = "lastSetting";
const WATERMARK_META = "watermark";
/** Stored threads bb archived: a restart does not ask bb about them again. */
const ARCHIVED_META = "archivedThreads";
/** How long a thread a surface showed stays watched. */
const VIEWED_MS = 10 * 60_000;
/** Allowance between bb's clock and a transcript's when matching a turn's requests. */
const TURN_SLACK_MS = 5_000;
/** The reconciliation check's interval, and how far either side of it it may fall. */
export const RECONCILE_MS = 5 * 60_000;
const RECONCILE_JITTER_MS = 30_000;
/** A restart catches up threads bb updated since the watermark less this margin. */
const WATERMARK_MARGIN_MS = 60_000;
/** How often the host keep-alive renews its lease while something is pending on a machine, and for how long. */
const KEEPALIVE_MS = 4 * 60_000;
const LEASE_MS = 6 * 60_000;
/** After a failed send, the due time is tried again no sooner than this. */
const RETRY_MS = 60_000;

export class ClaudeOnlyError extends Error {}
export class NotReadyError extends Error {}
/** A thread that is not Claude Code with no Claude Code thread above it, so no switch covers it. */
export class NoTreeTopError extends Error {
  constructor(
    readonly threadId: string,
    /** The tree tops below it. */
    readonly below: ThreadRef[],
  ) {
    super(
      below.length === 0
        ? `${threadId} is not a Claude Code thread and has no Claude Code thread above or below it`
        : `${threadId} is not a Claude Code thread and has no Claude Code thread above it; switch a tree top below it: ${below.map((t) => `${t.title} (${t.threadId})`).join(", ")}`,
    );
  }
}

/** Where a thread's Keep warm while waiting switch stands after it was flipped. */
export interface KeepWarmResult {
  treeTop: ThreadRef;
  /** What the tree gets now: false under Never whatever was recorded. */
  keptWarm: boolean;
  never: boolean;
}

/** Everything the engine works out about one Claude Code thread at a moment, from memory alone. */
interface Observed {
  thread: Known;
  record: ThreadRecord;
  waiting: boolean;
  items: WaitItem[];
  /** Children whose report is on its way. */
  pendingReports: string[];
  facts: TranscriptFacts | null;
  window: number | null;
  /** The rates the compaction line rests on. */
  rates: Rates | null;
  /** The rates a keep-warm is charged at; null holds keep-warms. */
  warmRates: Rates | null;
  priceOrigin: string | null;
  lines: (number | null)[];
  callsPerMessage: number;
  postCompaction: number;
  deadline: number | null;
  lifetimeMs: number | null;
}

/** A tree keep-warm whose shallower leaves have not been sent yet. */
interface Cycle {
  at: number;
  deepest: number;
  pending: { id: string; depth: number; deadline: number | null }[];
  historyId: number | null;
}

/** A send about to go: what, to whom, and the due time it answers. */
interface Planned {
  id: string;
  kind: SentKind;
  dueKey: string;
}

const isRead = (s: { lastReadAt: number | null; latestAttentionAt: number | null }) =>
  s.lastReadAt !== null && (s.latestAttentionAt === null || s.lastReadAt >= s.latestAttentionAt);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const working = (t: Known) => t.status !== "idle" && t.status !== "error";

export class Engine {
  readonly index = new ThreadIndex();
  private readonly records = new Map<string, ThreadRecord>();
  private readonly logs = new Map<string, TurnLog>();
  /** The requests each thread's last transcript reads returned, for charging its Cache Keeper turns. */
  private readonly recent = new Map<string, TranscriptRequest[]>();
  private readonly queued = new Map<string, QueuedRow[]>();
  /** Queued report rows, by thread, that bring nothing new and are not waited on. */
  private readonly nothingNewRows = new Map<string, Set<string>>();
  private readonly views = new Map<string, ThreadView>();
  private readonly viewedAt = new Map<string, number>();
  private readonly cycles = new Map<string, Cycle>();
  /** Threads whose host did not answer, and since when; nothing is sent to them until it does. */
  private readonly hostDown = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  /** Warnings and decisions already logged, so each is logged once. */
  private readonly logged = new Set<string>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly scheduler: Scheduler;
  /** bb calls, host calls and transcript bytes read, for the benchmark. */
  readonly counters = { bbCalls: 0, hostCalls: 0, bytesRead: 0, sends: 0 };
  private started = false;

  constructor(private readonly deps: EngineDeps) {
    this.scheduler = new Scheduler(deps.clock, (keys) => this.fire(keys), deps.timers);
  }

  private now(): number {
    return this.deps.clock.now();
  }

  // ---- records ----

  /** The thread's record, as stored or blank. */
  record(threadId: string): ThreadRecord {
    const cached = this.records.get(threadId);
    if (cached !== undefined) return cached;
    const stored = this.deps.store.has(threadId) ? this.deps.store.get(threadId) : null;
    if (stored !== null) this.records.set(threadId, stored);
    return stored ?? this.deps.store.get(threadId);
  }

  private stored(threadId: string): boolean {
    return this.records.has(threadId) || this.deps.store.has(threadId);
  }

  /** Changes the record as it stands now and stores it: never await between reading what `change` needs and this call. */
  private patch(threadId: string, change: (record: ThreadRecord) => ThreadRecord): ThreadRecord {
    const next = change(this.record(threadId));
    this.records.set(threadId, next);
    this.deps.store.put(threadId, next, this.now());
    return next;
  }

  private turnLog(threadId: string): TurnLog | null {
    const cached = this.logs.get(threadId);
    if (cached !== undefined) return cached;
    const stored = this.deps.store.turnLog(threadId);
    if (stored !== null) this.logs.set(threadId, stored);
    return stored;
  }

  private putTurnLog(threadId: string, log: TurnLog): void {
    this.logs.set(threadId, log);
    this.deps.store.putTurnLog(threadId, log);
  }

  /** The setting a thread switched on for the first time starts at. */
  lastSetting(): number {
    return this.deps.store.getMeta<number>(LAST_SETTING_META) ?? DEFAULT_SETTING;
  }

  // ---- logging ----

  private warnOnce(key: string, text: string): void {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    this.deps.log.warn(text);
  }

  /**
   * Records a decision on a due send: sent (`reason` null) or held back, and
   * why. Logged once per thread, due time and reason; no message or transcript
   * text is logged.
   */
  private decide(threadId: string, what: SentKind, dueKey: string, reason: HoldReason | null): void {
    const key = `decision\0${threadId}\0${dueKey}\0${reason ?? "sent"}`;
    if (!this.logged.has(key)) {
      this.logged.add(key);
      this.deps.log.info(reason === null ? `${threadId}: sending ${what} (${dueKey})` : `${threadId}: ${what} due (${dueKey}) held back: ${reasonText(reason)}`);
    }
    const last = this.record(threadId).decision;
    if (last?.what === what && last.reason === reason) return;
    if (!this.stored(threadId) && reason !== null) return;
    const decision: Decision = { at: this.now(), what, reason };
    this.patch(threadId, (r) => ({ ...r, decision }));
  }

  // ---- serial work ----

  /** Runs `work` after every earlier piece of work under `key`. */
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.chains.get(key) ?? Promise.resolve();
    const run = before.then(work, work);
    const settled = run.catch(() => {});
    this.chains.set(key, settled);
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return run;
  }

  /** Resolves once every piece of work queued so far has finished; for tests and the benchmark. */
  async idle(): Promise<void> {
    for (let i = 0; i < 20 && this.chains.size > 0; i++) await Promise.all([...this.chains.values()]);
  }

  // ---- startup ----

  /**
   * Loads what was stored, lists bb's threads once, catches up the threads bb
   * updated since the watermark from their saved positions, and sets the
   * timer from the stored facts. Deadlines more than a minute past are not
   * acted on.
   */
  async start(): Promise<void> {
    for (const { threadId, record } of this.deps.store.all()) this.records.set(threadId, record);
    const watermark = this.deps.store.getMeta<number>(WATERMARK_META);
    const listed = await this.list();
    const since = watermark === null ? null : watermark - WATERMARK_MARGIN_MS;
    const touched = new Set<string>();
    for (const t of listed) {
      if (!this.index.isClaude(t.id) || !this.index.isLive(t.id)) continue;
      const changed = since !== null && t.updatedAt > since;
      if (changed && (this.stored(t.id) || t.status === "idle")) touched.add(t.id);
    }
    // Stored threads bb no longer lists were archived or deleted while the plugin was down.
    const archived = new Set(this.deps.store.getMeta<string[]>(ARCHIVED_META) ?? []);
    const unlisted = [...this.records.keys()].filter((id) => this.index.get(id) === undefined && !archived.has(id));
    await Promise.all(
      unlisted.map(async (id) => {
        const fresh = await this.fresh(id).catch(() => undefined);
        if (fresh === undefined) return;
        if (fresh === null || fresh.deleted) this.onDeleted(id);
        else this.onArchived(id);
      }),
    );
    await Promise.all([...this.queuedThreads()].map((id) => this.refreshQueue(id)));
    this.started = true;
    for (const id of touched) void this.learn(id, "restart");
    const tops = this.watchedTops();
    // A tree with a thread working or with work of its own may have a Claude Code thread waiting in it.
    for (const t of listed) if (this.index.isLive(t.id) && (working(t) || this.ownWork(t))) tops.add(this.index.topOf(t.id));
    for (const top of tops) this.replan(top);
    this.scheduleReconcile();
    this.saveWatermark(listed);
  }

  stop(): void {
    this.scheduler.stop();
  }

  /** When the timer is next due for `key` (`tree:<top>`, `reconcile` or `keepalive`), or null. */
  dueAt(key: string): number | null {
    return this.scheduler.get(key);
  }

  /** Lists bb's threads into the index; returns the threads listed. */
  private async list(): Promise<Known[]> {
    this.counters.bbCalls++;
    const rows = await this.deps.listThreads();
    const listed: Known[] = [];
    for (const raw of rows) {
      const read = readThread(raw, true);
      if (read === null) continue;
      if (read.missing.length > 0) this.warnOnce(`missing\0${read.patch.id}\0${read.missing.join(",")}`, `${read.patch.id}: bb's thread list lacks ${read.missing.join(", ")}; nothing is sent to it until a reply carries them`);
      listed.push(this.index.apply(read.patch, read.missing));
    }
    return listed;
  }

  private saveWatermark(listed: Known[]): void {
    let max = this.deps.store.getMeta<number>(WATERMARK_META) ?? 0;
    for (const t of listed) if (t.updatedAt > max) max = t.updatedAt;
    this.deps.store.setMeta(WATERMARK_META, max);
  }

  private queuedThreads(): Set<string> {
    const out = new Set<string>();
    for (const id of this.index.ids()) if (this.index.get(id)!.queuedWork !== "none" && this.index.isLive(id)) out.add(id);
    return out;
  }

  /** The tops of every tree holding a thread with something stored or watched. */
  private watchedTops(): Set<string> {
    const tops = new Set<string>();
    for (const id of this.records.keys()) if (this.index.isLive(id)) tops.add(this.index.topOf(id));
    for (const id of this.viewedAt.keys()) if (this.index.isLive(id)) tops.add(this.index.topOf(id));
    return tops;
  }

  // ---- reconciliation ----

  private scheduleReconcile(): void {
    const jitter = (Math.random() * 2 - 1) * RECONCILE_JITTER_MS;
    this.scheduler.set("reconcile", this.now() + RECONCILE_MS + jitter);
  }

  /**
   * Lists every thread once and corrects what a missed event left wrong: a
   * thread that went idle, was archived, deleted or unarchived, got or lost a
   * pending interaction or a queued row, without an event saying so.
   */
  async reconcile(): Promise<void> {
    const before = new Map<string, Known>();
    for (const id of this.index.ids()) before.set(id, { ...this.index.get(id)! });
    const listed = await this.list();
    const seen = new Set(listed.map((t) => t.id));
    const tops = new Set<string>();
    for (const t of listed) {
      const was = before.get(t.id);
      const moved =
        was === undefined ||
        was.status !== t.status ||
        was.archived !== t.archived ||
        was.pending !== t.pending ||
        was.parentId !== t.parentId ||
        was.queuedWork !== t.queuedWork ||
        was.commands !== t.commands ||
        was.agents !== t.agents;
      if (!moved) continue;
      if (t.archived && was?.archived !== true) this.onArchived(t.id);
      if (was !== undefined && working(was) && !working(t)) this.turnEnd(t.id);
      tops.add(this.index.topOf(t.id));
      if (was?.parentId != null) tops.add(this.index.topOf(was.parentId));
    }
    // A thread bb no longer lists was archived or deleted.
    for (const [id, was] of before) {
      if (seen.has(id) || was.archived || was.deleted) continue;
      const fresh = this.stored(id) ? await this.fresh(id) : null;
      if (fresh === null || fresh.deleted) this.onDeleted(id);
      else this.onArchived(id);
      if (was.parentId !== null) tops.add(this.index.topOf(was.parentId));
    }
    await Promise.all([...this.queuedThreads()].map((id) => this.refreshQueue(id)));
    for (const id of this.queued.keys()) if (this.index.get(id)?.queuedWork === "none") this.queued.delete(id);
    for (const id of this.queuedThreads()) tops.add(this.index.topOf(id));
    for (const top of tops) this.replan(top);
    this.saveWatermark(listed);
  }

  private async refreshQueue(threadId: string): Promise<void> {
    this.counters.bbCalls++;
    const rows = await this.deps.queuedMessages(threadId).catch(() => null);
    if (rows !== null) this.queued.set(threadId, rows);
  }

  // ---- bb's events ----

  /** A thread event of bb's: its thread as bb gives it now. */
  onThread(event: "created" | "active" | "idle" | "failed" | "archived" | "unarchived" | "deleted" | "pending", raw: unknown): void {
    const read = readThread(raw, false);
    if (read === null) return;
    const id = read.patch.id;
    const before = this.index.get(id);
    if (event === "deleted") {
      this.onDeleted(id);
      if (before?.parentId != null) this.replan(this.index.topOf(before.parentId));
      return;
    }
    if (read.missing.length > 0) this.warnOnce(`missing\0${id}\0${read.missing.join(",")}`, `${id}: bb's ${event} event lacks ${read.missing.join(", ")}; nothing is sent to it until a reply carries them`);
    const patch: Partial<Known> & { id: string } = { ...read.patch };
    if (event === "pending") patch.pending = true;
    // A turn that starts is past any question: bb announces a new one with interaction.pending.
    if (event === "active") patch.pending = false;
    const t = this.index.apply(patch, read.missing);
    if (!this.started) return;
    switch (event) {
      case "active":
        this.onActive(t);
        // A report reaching a level of a tree keep-warm under way is the moment its leaves at that level go.
        if (this.cycles.has(this.index.topOf(id))) {
          void this.serial(`learn:${id}`, () => this.readEvents(id))
            .catch(() => {})
            .then(() => this.replan(this.index.topOf(id)));
        }
        break;
      case "idle":
      case "failed":
        this.turnEnd(id);
        break;
      case "archived":
        this.onArchived(id);
        break;
      case "unarchived":
        this.markArchived(id, false);
        break;
      default:
        break;
    }
    const top = this.index.topOf(id);
    this.replan(top);
    if (before?.parentId != null && before.parentId !== t.parentId) this.replan(this.index.topOf(before.parentId));
    if (event === "archived" || event === "unarchived") for (const c of this.index.childrenOf(id)) this.replan(this.index.topOf(c));
  }

  /** A queued row was queued, dispatched or cancelled. */
  onQueued(event: "queued" | "dispatched" | "cancelled", raw: unknown): void {
    const entry = raw as { id?: unknown; threadId?: unknown };
    if (typeof entry?.id !== "string" || typeof entry.threadId !== "string") return;
    const threadId = entry.threadId;
    const rows = (this.queued.get(threadId) ?? []).filter((r) => r.id !== entry.id);
    if (event === "queued") rows.push(queuedRowOf(raw));
    this.queued.set(threadId, rows);
    const t = this.index.get(threadId);
    if (t !== undefined) this.index.apply({ id: threadId, queuedWork: rows.some((r) => !r.failed) ? "waiting" : rows.length > 0 ? "failed" : "none" }, t.missing);
    if (!this.started) return;
    // A report bb queued behind a question may bring nothing new.
    if (event === "queued" && t?.pending === true && this.index.isClaude(threadId)) {
      void this.serial(`learn:${threadId}`, () => this.deleteNothingNewReports(threadId))
        .catch((error) => this.deps.log.warn(`${threadId}: ${message(error)}`))
        .then(() => this.replan(this.index.topOf(threadId)));
    }
    this.replan(this.index.topOf(threadId));
  }

  /**
   * A thread turned active. If Cache Keeper sent nothing, a report or a message
   * started the turn: its read state now is the one to put back if the turn
   * brings nothing new.
   */
  private onActive(t: Known): void {
    if (!this.stored(t.id) || t.providerId !== "claude-code") return;
    const record = this.record(t.id);
    if (record.readBefore !== null || record.inFlight !== null) return;
    const readBefore: ReadBefore = { read: isRead(t), lastReadAt: t.lastReadAt, since: this.now() };
    this.patch(t.id, (r) => (r.readBefore !== null ? r : { ...r, readBefore }));
  }

  /** An archived thread keeps its switches; its idle stretch and its turn log go. */
  private onArchived(threadId: string): void {
    this.forgetStretch(threadId);
    this.logs.delete(threadId);
    this.deps.store.deleteTurnLog(threadId);
    if (this.stored(threadId)) this.markArchived(threadId, true);
  }

  private markArchived(threadId: string, archived: boolean): void {
    const ids = new Set(this.deps.store.getMeta<string[]>(ARCHIVED_META) ?? []);
    if (ids.has(threadId) === archived) return;
    if (archived) ids.add(threadId);
    else ids.delete(threadId);
    this.deps.store.setMeta(ARCHIVED_META, [...ids]);
  }

  private forgetStretch(threadId: string): void {
    this.views.delete(threadId);
    this.scheduler.set(`tree:${threadId}`, null);
    if (!this.stored(threadId)) return;
    const r = this.record(threadId);
    if (r.stretch === null && r.inFlight === null && r.readBefore === null && Object.keys(r.tasks).length === 0) return;
    this.patch(threadId, (rec) => ({ ...rec, stretch: null, inFlight: null, readBefore: null, tasks: {} }));
  }

  /** A deleted thread is forgotten, rows and all. */
  private onDeleted(threadId: string): void {
    this.index.remove(threadId);
    this.records.delete(threadId);
    this.logs.delete(threadId);
    this.recent.delete(threadId);
    this.queued.delete(threadId);
    this.views.delete(threadId);
    this.viewedAt.delete(threadId);
    this.hostDown.delete(threadId);
    this.scheduler.set(`tree:${threadId}`, null);
    this.deps.store.delete(threadId);
    this.markArchived(threadId, false);
  }

  /** The drive harness moved the clock: the timer is set again from the new time. */
  clockMoved(): void {
    this.scheduler.reset();
    for (const top of this.watchedTops()) this.replan(top);
  }

  // ---- learning a thread ----

  /**
   * A thread's turn ended: nothing is sent to it until the turn is read, since
   * what the engine knew of it is from before the turn.
   */
  private turnEnd(threadId: string): void {
    this.turnEnding.add(threadId);
    void this.learn(threadId, "turn end").finally(() => {
      this.turnEnding.delete(threadId);
      if (this.index.isLive(threadId)) this.replan(this.index.topOf(threadId));
    });
  }

  /** Whether the thread's deadline matters now, so its transcript is worth reading. */
  private watched(threadId: string): boolean {
    const t = this.index.get(threadId);
    if (t === undefined || t.providerId !== "claude-code" || !this.index.isLive(threadId)) return false;
    const r = this.record(threadId);
    if (r.compactOn || r.inFlight !== null || r.readBefore !== null || Object.keys(r.tasks).length > 0 || r.stretch?.compactedAt != null) return true;
    if (this.now() - (this.viewedAt.get(threadId) ?? -Infinity) < VIEWED_MS) return true;
    return t.status === "idle" && this.waiting(threadId, new Map());
  }

  /**
   * Brings one thread up to date: its events since the saved position, its
   * transcript from the saved cursor where its deadline matters, its window,
   * then charges and read state. Serial per thread.
   */
  learn(threadId: string, why: "turn end" | "restart" | "watched" | "view"): Promise<void> {
    return this.serial(`learn:${threadId}`, async () => {
      const t = this.index.get(threadId);
      if (t === undefined || !this.index.isLive(threadId)) return;
      const claude = t.providerId === "claude-code";
      // A report climbs through every thread under a Claude Code one, whatever its harness.
      if (!claude && this.claudeAbove(threadId) === null) return;
      await this.readEvents(threadId);
      if (claude) {
        // bb's events do not say whether a thread waits on your answer; a thread first seen through them is asked once.
        if (this.index.get(threadId)?.pending === null) await this.readPending(threadId);
        const watched = this.watched(threadId);
        if (watched) await this.readTranscript(threadId);
        this.account(threadId);
        await this.deleteNothingNewReports(threadId);
        await this.restoreRead(threadId);
        if (watched) {
          this.syncStretch(threadId);
          await this.readWindow(threadId);
        }
      }
      if (why !== "view") this.replan(this.index.topOf(threadId));
    }).catch((error) => this.deps.log.warn(`${threadId}: could not read its ${why === "turn end" ? "turn" : "state"}: ${message(error)}`));
  }

  private async readPending(threadId: string): Promise<void> {
    this.counters.bbCalls++;
    const raw = await this.deps.pendingInteractions(threadId).catch(() => undefined);
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { interactions?: unknown })?.interactions) ? (raw as { interactions: unknown[] }).interactions : null;
    const t = this.index.get(threadId);
    if (list === null || t === undefined) {
      this.warnOnce(`missing\0${threadId}\0pendingInteractions`, `${threadId}: bb's pending interactions reply lacks the list; nothing is sent to it until a reply carries it`);
      return;
    }
    this.index.apply({ id: threadId, pending: list.length > 0 }, t.missing);
  }

  private claudeAbove(threadId: string): string | null {
    const seen = new Set<string>();
    for (let p = this.index.get(threadId)?.parentId ?? null; p !== null && !seen.has(p); p = this.index.get(p)?.parentId ?? null) {
      seen.add(p);
      if (this.index.isClaude(p)) return p;
    }
    return null;
  }

  /** Reads the thread's new events: its turns, its background tasks, and a new Claude Code session. */
  private async readEvents(threadId: string): Promise<void> {
    let log = this.turnLog(threadId);
    if (log === null) {
      this.counters.bbCalls++;
      log = emptyTurnLog(Math.max(0, (await this.deps.latestEventSeq(threadId)) - FIRST_READ_EVENTS));
    }
    const before = log.afterSeq;
    const claude = this.index.isClaude(threadId);
    const record = claude ? this.record(threadId) : null;
    const tasks: Record<string, TaskRecord> = { ...(record?.tasks ?? {}) };
    let session: string | null = null;
    const finished = { command: 0, subagent: 0 };
    for (let page = 0; page < 100; page++) {
      this.counters.bbCalls++;
      const raw = await this.deps.events(threadId, log.afterSeq);
      const events = raw.map((e) => ({ ...e, seq: Number(e.seq), createdAt: this.deps.clock.fromWall(e.createdAt) }));
      log = foldTurns(log, events, {
        threadId,
        isChild: (id) => this.index.get(id)?.parentId === threadId,
        warn: (m) => this.warnOnce(m, m),
      });
      for (const e of events) {
        const data = (e.data ?? {}) as { item?: TaskItem; providerThreadId?: unknown };
        if (e.type === "thread/identity" && typeof data.providerThreadId === "string") session = data.providerThreadId;
        else if (claude) {
          const done = foldTask(tasks, e.type, e.createdAt, data.item ?? null);
          if (done !== null) finished[done]++;
        }
      }
      if (raw.length < EVENTS_PAGE) break;
    }
    if (log.afterSeq !== before || this.deps.store.turnLog(threadId) === null) this.putTurnLog(threadId, log);
    if (!claude) return;
    const known = this.index.get(threadId)!;
    // bb's counts come from its last list; a task seen finishing since takes one off, until the next list says.
    const commands = Math.max(Object.values(tasks).filter((t) => t.kind === "command").length, known.commands - finished.command);
    const agents = Math.max(Object.values(tasks).filter((t) => t.kind === "subagent").length, known.agents - finished.subagent);
    this.index.apply({ id: threadId, commands, agents }, known.missing);
    const changedTasks = JSON.stringify(tasks) !== JSON.stringify(record!.tasks);
    const current = this.record(threadId).transcript;
    const newSession = session !== null && current !== null && current.sessionId !== session;
    if (!changedTasks && !newSession && !(session !== null && current === null && this.watched(threadId))) return;
    if (!this.stored(threadId) && !changedTasks && !this.watched(threadId)) return;
    this.patch(threadId, (r) => ({
      ...r,
      tasks: changedTasks ? mergeTasks(r.tasks, tasks) : r.tasks,
      // A new session (bb emits one on /clear) starts from its own transcript: the old one's facts no longer count.
      transcript: session !== null && (r.transcript === null || r.transcript.sessionId !== session) ? { sessionId: session, cursor: null, unreadable: null } : r.transcript,
    }));
    if (newSession) this.recent.delete(threadId);
  }

  /** Reads the thread's transcript on from its cursor. A host that does not answer holds the thread's sends. */
  private async readTranscript(threadId: string): Promise<void> {
    let session = this.record(threadId).transcript?.sessionId ?? null;
    if (session === null) {
      this.counters.bbCalls++;
      session = await this.deps.sessionId(threadId);
      if (session === null) return;
      const sessionId = session;
      this.patch(threadId, (r) => (r.transcript?.sessionId === sessionId ? r : { ...r, transcript: { sessionId, cursor: null, unreadable: null } }));
    }
    const hostId = await this.hostOf(threadId);
    if (hostId === null) return;
    const cursor = this.record(threadId).transcript?.cursor ?? null;
    let read: TranscriptRead;
    try {
      this.counters.hostCalls++;
      read = await this.deps.transcript(hostId, session, cursor);
    } catch (error) {
      if (!this.hostDown.has(threadId)) this.hostDown.set(threadId, this.now());
      this.warnOnce(`host\0${threadId}\0${hostId}`, `${threadId}: its machine ${hostId} did not answer; nothing is sent to it until it does: ${message(error)}`);
      return;
    }
    this.hostDown.delete(threadId);
    this.logged.delete(`host\0${threadId}\0${hostId}`);
    this.counters.bytesRead += read.bytesRead;
    if (!read.found) return;
    if (read.unreadable !== null) this.warnOnce(`unreadable\0${threadId}\0${read.unreadable}`, `${threadId}: its transcript is unreadable: ${read.unreadable}`);
    const sessionId = session;
    this.patch(threadId, (r) => {
      if (r.transcript?.sessionId !== sessionId) return r;
      return { ...r, transcript: { sessionId, cursor: read.cursor ?? r.transcript.cursor, unreadable: read.unreadable } };
    });
    if (read.requests.length > 0) this.recent.set(threadId, [...(this.recent.get(threadId) ?? []), ...read.requests].slice(-200));
    const c = this.record(threadId).compaction;
    const done = read.facts.lastCompaction;
    if (c !== null && c.contextAfter === null && done !== null && done.at >= c.at - CACHE_MARGIN_MS) {
      this.deps.store.setContextAfter(c.historyId, done.postTokens);
      this.patch(threadId, (r) => (r.compaction === null ? r : { ...r, compaction: { ...r.compaction, contextAfter: done.postTokens } }));
    }
  }

  private async hostOf(threadId: string): Promise<string | null> {
    const t = this.index.get(threadId);
    if (t === undefined) return null;
    if (t.hostId !== undefined) return t.hostId;
    this.counters.bbCalls++;
    const hostId = await this.deps.hostOf(threadId).catch(() => null);
    this.index.apply({ id: threadId, hostId }, this.index.get(threadId)?.missing ?? []);
    return hostId;
  }

  /** Asks bb for the thread's window when none is stored for its model. There is no default: until bb reports one, the thread has no lines. */
  private async readWindow(threadId: string): Promise<void> {
    const r = this.record(threadId);
    const model = r.transcript?.cursor?.fold.facts.model ?? null;
    if (r.window !== null && r.window.model === model) return;
    this.counters.bbCalls++;
    const tokens = await this.deps.contextWindow(threadId).catch(() => null);
    if (tokens === null || !(tokens > 0)) return;
    this.patch(threadId, (rec) => ({ ...rec, window: { model, tokens } }));
  }

  /**
   * Takes each turn that ended since the last one accounted: a real one ends
   * the idle stretch; a Cache Keeper one is charged at its real cost, split
   * equally between the messages that caused it, or, where its own cost
   * cannot be measured, at each message's forecast.
   */
  private account(threadId: string): void {
    const log = this.turnLog(threadId);
    if (log === null) return;
    const lookup = (id: string) => this.turnLog(id);
    const record = this.record(threadId);
    const ended = log.turns.filter((t) => t.startSeq > record.accountedSeq && t.endedAt !== null);
    if (!this.stored(threadId)) {
      // A thread seen for the first time starts from now: its past turns are nobody's to charge.
      const first = ended.at(-1)?.startSeq;
      if (first != null && this.watched(threadId)) this.patch(threadId, (r) => ({ ...r, accountedSeq: first }));
      return;
    }
    const upTo = log.turns.find((t) => t.startSeq > record.accountedSeq && t.endedAt === null)?.startSeq ?? Infinity;
    const due = ended.filter((t) => t.startSeq < upTo);
    if (due.length === 0) return;
    const facts = record.transcript?.cursor?.fold.facts ?? null;
    const price = this.deps.prices().lookup(facts?.model ?? null);
    const requests = this.recent.get(threadId) ?? [];
    for (const turn of due) {
      const keeper = isKeeperTurn(threadId, turn, lookup);
      const current = this.record(threadId);
      if (current.inFlight !== null && turn.startedAt >= current.inFlight.at - TURN_SLACK_MS && turn.inputs.some((i) => i.kind === "sent")) {
        this.patch(threadId, (r) => ({ ...r, inFlight: null }));
      }
      if (!keeper) {
        // A stretch begun after this turn started (a Skip pressed since it ended) is the next one, and stays.
        if (current.stretch !== null && current.stretch.startedAt <= turn.startedAt) {
          if (current.stretch.compactedAt != null) this.recordReturn(threadId, current, turn.startedAt);
          this.patch(threadId, (r) => {
            // A Skip pressed after the turn ended was pressed on the stretch that follows it.
            const s = r.stretch;
            if (s === null || s.skippedAt === undefined || s.skippedAt < turn.endedAt!) return { ...r, stretch: null };
            return { ...r, stretch: { ...newIdleStretch(turn.endedAt!), compactSkipped: s.compactSkipped, warmSkipped: s.warmSkipped, skippedAt: s.skippedAt } };
          });
        }
      } else {
        const index = log.turns.indexOf(turn);
        const from = Math.max(turn.startedAt - TURN_SLACK_MS, log.turns[index - 1]?.endedAt ?? -Infinity);
        const to = Math.min(turn.endedAt! + TURN_SLACK_MS, log.turns[index + 1]?.startedAt ?? Infinity);
        const own = requestsIn(requests, from, to, 0);
        const usd = price === null || own.length === 0 ? null : requestsUsd(own, price.price);
        if (turn.inputs.every((i) => i.kind === "report")) {
          this.patch(threadId, (r) => ({ ...r, keeperReports: { turns: r.keeperReports.turns + 1, requests: r.keeperReports.requests + own.length } }));
        }
        this.charge(threadId, turn, usd, lookup);
      }
      this.patch(threadId, (r) => ({ ...r, accountedSeq: turn.startSeq }));
    }
  }

  /**
   * Charges a Cache Keeper turn in `threadId` to the messages behind it, and to
   * the stretches they were sent in. A turn whose cost is unknown charges each
   * message sent to this thread its forecast, which already holds its share of
   * the turns it forces above; it never counts as nothing.
   */
  private charge(threadId: string, turn: Turn, usd: number | null, lookup: (id: string) => TurnLog | null): void {
    const sends = originsOf(threadId, turn, lookup)
      .map((ref) => this.deps.store.findSend(ref.threadId, ref.hash, ref.at))
      .filter((s) => s !== null);
    if (sends.length === 0) return;
    for (const send of sends) {
      const own = send.threadId === threadId;
      let share: number;
      if (usd !== null) share = usd / sends.length;
      else if (own && !send.measured) share = send.forecastUsd;
      else continue;
      this.deps.store.chargeSend(send.id, threadId, share, own, usd === null);
      this.chargeStretch(send.threadId, send.stretchStartedAt, share);
    }
  }

  private chargeStretch(threadId: string, stretchStartedAt: number, usd: number): void {
    if (!this.stored(threadId)) return;
    this.patch(threadId, (r) =>
      r.stretch !== null && r.stretch.startedAt === stretchStartedAt ? { ...r, stretch: { ...r.stretch, chargedUsd: r.stretch.chargedUsd + usd } } : r,
    );
  }

  /** The first message back after a compaction: what the cold rewrite it spared would have cost. */
  private recordReturn(threadId: string, record: ThreadRecord, at: number): void {
    const c = record.compaction;
    if (c === null || c.w === null || c.lifetimeMs === null || c.contextAfter === null) return;
    // Back before the cache would have gone cold, the compaction spared nothing.
    if (at < c.at + c.lifetimeMs) return;
    this.deps.store.addHistory(threadId, at, "return", { usd: null, avoidedUsd: Math.max(0, c.w * (c.contextBefore - c.contextAfter)) });
  }

  /**
   * Deletes, from a thread waiting on your answer, bb's queued report rows
   * whose every line reports a Cache Keeper turn that brought nothing new.
   * Such rows are not waited on even when the delete fails.
   */
  private async deleteNothingNewReports(threadId: string): Promise<void> {
    const t = this.index.get(threadId);
    const log = this.turnLog(threadId);
    if (t === undefined || t.pending !== true || log === null) return;
    const isChild = (id: string) => this.index.get(id)?.parentId === threadId;
    const rows = (this.queued.get(threadId) ?? []).map((row) => ({ row, lines: reportLines(classifyQueued(row, isChild)) }));
    // Each queued row reports the child turns since the row before it, so the rows count as delivered here.
    const queuedLines = rows.flatMap(({ row, lines }) => lines.map((l) => ({ childId: l.childId, at: row.createdAt })));
    const withQueue = { ...log, delivered: [...log.delivered, ...queuedLines] };
    const lookup = (id: string) => (id === threadId ? withQueue : this.turnLog(id));
    const nothingNew = rows.filter(
      ({ row, lines }) => lines.length > 0 && lines.every((line) => lineHolds(lookup(threadId), lookup(line.childId), line, row.createdAt, (turn) => broughtNothingNew(line.childId, turn, lookup))),
    );
    if (nothingNew.length === 0) return;
    this.nothingNewRows.set(threadId, new Set(nothingNew.map(({ row }) => row.id)));
    const delivered = [...log.delivered];
    for (const { row, lines } of nothingNew) {
      try {
        this.counters.bbCalls++;
        await this.deps.deleteQueued(threadId, row.id);
        this.deps.store.addHistory(threadId, this.now(), "held", { usd: null, what: "report-row-deleted" });
        this.deps.log.info(`${threadId}: deleted a queued report row that brought nothing new`);
      } catch (error) {
        this.deps.log.warn(`could not delete a report row that brought nothing new from ${threadId}: ${message(error)}`);
      }
      for (const line of lines) delivered.push({ childId: line.childId, at: row.createdAt });
    }
    this.queued.set(threadId, (this.queued.get(threadId) ?? []).filter((r) => !nothingNew.some((n) => n.row.id === r.id)));
    this.putTurnLog(threadId, { ...log, delivered });
  }

  /**
   * Once every turn since a Cache Keeper message or a report arrived has
   * ended, and each brought nothing new, puts the thread's read state back to
   * what it was before, unless you changed it since.
   */
  private async restoreRead(threadId: string): Promise<void> {
    if (!this.stored(threadId)) return;
    const before = this.record(threadId).readBefore;
    const log = this.turnLog(threadId);
    if (before === null || log === null) return;
    const now = this.now();
    const turns = log.turns.filter((t) => t.startedAt >= before.since - TURN_SLACK_MS);
    const clear = () => this.patch(threadId, (r) => ({ ...r, readBefore: null }));
    if (turns.length === 0) {
      if (now - before.since >= IN_FLIGHT_MS) clear();
      return;
    }
    const t = this.index.get(threadId);
    if (t === undefined || t.status !== "idle" || turns.some((turn) => turn.endedAt === null)) return;
    clear();
    const lookup = (id: string) => this.turnLog(id);
    if (!turns.every((turn) => broughtNothingNew(threadId, turn, lookup))) return;
    await this.putBack(threadId, before);
  }

  /**
   * Puts the read state back as it was before the turn, or, if you changed it
   * meanwhile, as you set it: bb draws attention to a top-level thread whose
   * turn ends, which would otherwise undo your marking it read.
   */
  private async putBack(threadId: string, before: ReadBefore): Promise<void> {
    this.counters.bbCalls++;
    const raw = await this.deps.getThread(threadId).catch(() => null);
    const read = raw === null ? null : readThread(raw, false);
    if (read === null) return;
    const state = { lastReadAt: read.patch.lastReadAt ?? null, latestAttentionAt: read.patch.latestAttentionAt ?? null };
    let action: "read" | "unread" | null = null;
    if (state.lastReadAt !== before.lastReadAt) {
      if (state.lastReadAt !== null && !isRead(state)) action = "read";
    } else if (before.read && !isRead(state)) action = "read";
    else if (!before.read && isRead(state)) action = "unread";
    if (action === null) return;
    this.counters.bbCalls++;
    if (action === "read") await this.deps.markRead(threadId);
    else await this.deps.markUnread(threadId);
    this.deps.store.addHistory(threadId, this.now(), "held", { usd: null, what: "read-state-restored" });
    this.deps.log.info(`${threadId}: put its read state back to ${action}`);
  }

  /** A thread bb lists as idle, with something for Cache Keeper, is in an idle stretch. */
  private syncStretch(threadId: string): void {
    const t = this.index.get(threadId);
    const now = this.now();
    const r = this.record(threadId);
    const startStretch = t?.status === "idle" && r.stretch === null;
    const giveUp = r.inFlight !== null && now - r.inFlight.at >= IN_FLIGHT_MS;
    if (giveUp) this.giveUp(threadId);
    if (startStretch || !this.stored(threadId)) this.patch(threadId, (rec) => (rec.stretch !== null || t?.status !== "idle" ? rec : { ...rec, stretch: newIdleStretch(now) }));
  }

  /** A send whose turn never came: charged at its forecast, so it still counts towards the cost stop. */
  private giveUp(threadId: string): void {
    const inFlight = this.record(threadId).inFlight;
    if (inFlight === null) return;
    const send = this.deps.store.getSend(inFlight.sendId);
    this.patch(threadId, (r) => ({ ...r, inFlight: null }));
    if (send === null || send.measured || send.kind === "compact") return;
    this.deps.store.chargeSend(send.id, threadId, send.forecastUsd, true, true);
    this.chargeStretch(threadId, send.stretchStartedAt, send.forecastUsd);
  }

  // ---- what the engine works out from memory ----

  /** Whether a thread waits: its own background work or queue, or a direct child working or itself waiting. */
  private waiting(threadId: string, memo: Map<string, boolean>): boolean {
    const cached = memo.get(threadId);
    if (cached !== undefined) return cached;
    memo.set(threadId, false);
    const t = this.index.get(threadId);
    let result = false;
    if (t !== undefined) {
      result = this.ownWork(t) || this.index.childrenOf(threadId).some((c) => {
        const child = this.index.get(c)!;
        return working(child) || this.waiting(c, memo);
      });
    }
    memo.set(threadId, result);
    return result;
  }

  private ownWork(t: Known): boolean {
    if (t.commands > 0 || t.agents > 0) return true;
    if (this.stored(t.id) && Object.keys(this.record(t.id).tasks).length > 0) return true;
    const rows = this.queued.get(t.id);
    if (rows === undefined) return t.queuedWork === "waiting";
    const nothingNew = this.nothingNewRows.get(t.id);
    return rows.some((r) => !r.failed && !(nothingNew?.has(r.id) ?? false));
  }

  private observe(threadId: string, memo: Map<string, boolean>): Observed {
    const thread = this.index.get(threadId)!;
    const record = this.record(threadId);
    const now = this.now();
    const items: WaitItem[] = taskItems(record);
    const children = this.index.childrenOf(threadId);
    for (const c of children) {
      const child = this.index.get(c)!;
      if (working(child) || this.waiting(c, memo)) items.push({ kind: "child", id: c, title: child.title, startedAt: child.createdAt });
    }
    // A report bb queued behind a question has arrived; it waits in the queue, not on the way.
    const isChild = (id: string) => this.index.get(id)?.parentId === threadId;
    const rows = this.queued.get(threadId) ?? [];
    const queuedReports = new Set(rows.flatMap((r) => reportLines(classifyQueued(r, isChild)).map((l) => l.childId)));
    const log = this.turnLog(threadId);
    const pendingReports = children.filter((c) => !queuedReports.has(c) && reportPending(log, c, this.turnLog(c), now));
    for (const id of pendingReports) {
      if (items.some((i) => i.kind === "child" && i.id === id)) continue;
      const c = this.index.get(id)!;
      items.push({ kind: "child", id, title: c.title, startedAt: c.createdAt });
    }
    const nothingNew = this.nothingNewRows.get(threadId);
    for (const q of rows) {
      if (q.failed || nothingNew?.has(q.id)) continue;
      items.push(q.sendAt !== null ? { kind: "scheduled", dueAt: this.deps.clock.fromWall(q.sendAt), createdAt: q.createdAt } : { kind: "queued", createdAt: q.createdAt });
    }
    const waiting = this.waiting(threadId, memo) || items.length > 0;
    const facts = record.transcript?.cursor?.fold.facts ?? null;
    const window = record.window !== null && record.window.model === (facts?.model ?? null) ? record.window.tokens : (record.window?.tokens ?? null);
    const price = this.deps.prices().lookup(facts?.model ?? null);
    const rates = price !== null && facts?.lifetime != null ? ratesOf(price.price, facts.lifetime) : null;
    const warmRates = price !== null && facts?.lifetime != null ? warmRatesOf(price.price, facts.lifetime) : null;
    const k = facts === null ? DEFAULT_CALLS_PER_MESSAGE : callsPerMessage(facts, DEFAULT_CALLS_PER_MESSAGE, record.keeperReports);
    const p = facts?.lastCompaction?.postTokens ?? DEFAULT_POST_COMPACTION;
    const lines = rates === null || window === null ? Array.from({ length: 10 }, () => null) : linesFor({ rates, k, p, window });
    return {
      thread,
      record,
      waiting,
      items,
      pendingReports,
      facts,
      window,
      rates,
      warmRates,
      priceOrigin: price?.origin ?? null,
      lines,
      callsPerMessage: k,
      postCompaction: p,
      deadline: facts === null ? null : deadlineOf(facts),
      lifetimeMs: facts?.lifetime == null ? null : lifetimeMs(facts.lifetime),
    };
  }

  private keeperInput(o: Observed, now: number, settings: KeeperSettings) {
    const setting = o.record.setting ?? this.lastSetting();
    return {
      now,
      claudeCode: o.thread.providerId === "claude-code",
      status: o.thread.status,
      hasPendingInteraction: o.thread.pending !== false,
      waiting: o.waiting,
      tasks: Object.entries(o.record.tasks).map(([id, t]) => ({ kind: t.kind, id, clock: t.clock })),
      deadline: o.deadline,
      context: o.facts?.context ?? null,
      compactOn: o.record.compactOn,
      line: o.lines[setting - 1] ?? null,
      stretch: o.record.stretch,
      checkIns: settings.checkIns,
      waitMs: settings.waitMs,
    };
  }

  /** The tree top whose switch covers `threadId`, or null for a thread that is not Claude Code with none above it. */
  private treeTopIdOf(threadId: string): string | null {
    return treeTopOf(threadId, (id) => this.index.liveParentOf(id), (id) => this.index.isClaude(id));
  }

  /** Whether `threadId`'s tree is kept warm: its tree top's switch and the setting. */
  private isKeptWarm(threadId: string, settings: KeeperSettings): boolean {
    const top = this.treeTopIdOf(threadId);
    return keptWarm(settings.keepWarm, top === null ? null : this.record(top).keepWarm);
  }

  /** What the next keep-warm to a thread is expected to cost, with the turns it forces above. */
  private forecast(threadId: string, observed: Map<string, Observed>): number {
    const record = this.record(threadId);
    const last = record.lastSendId === null ? null : this.deps.store.getSend(record.lastSendId);
    const chain: Observed[] = [];
    for (let id: string | null = threadId, d = 0; id !== null && d < 64; id = this.index.liveParentOf(id), d++) {
      const o = observed.get(id);
      if (o !== undefined) chain.push(o);
    }
    const estimate = estimateKeepWarmUsd(chain.map((o) => ({ rates: o.warmRates, context: o.facts?.context ?? null })));
    // The report turns a keep-warm forced above are charged after its own turn, so a measured cost may not hold them yet.
    return last !== null && last.measured ? Math.max(last.usd, estimate) : estimate;
  }

  /** Why keep-warms are held for a waiting thread in a tree kept warm, or null. */
  private warmHold(o: Observed, forecast: number): HoldReason | null {
    const stretch = o.record.stretch;
    if (o.thread.missing.length > 0) return "missing-field";
    if (o.thread.pending !== false) return o.thread.pending === null ? "missing-field" : "pending-interaction";
    if (this.hostDown.has(o.thread.id)) return "host-offline";
    if (o.record.transcript?.unreadable != null) return "transcript-unreadable";
    if (stretch?.warmSkipped) return "skipped";
    if (o.warmRates === null) return "no-price";
    if (pastCostStop(stretch?.chargedUsd ?? 0, forecast, o.warmRates, o.facts?.context ?? null)) return "cost-stop";
    return null;
  }

  private treeNode(id: string, observed: Map<string, Observed>, settings: KeeperSettings): TreeNode {
    const o = observed.get(id);
    const parentId = this.index.liveParentOf(id);
    const log = this.turnLog(id);
    const running = log?.turns.at(-1);
    const now = this.now();
    // bb records a report's request before the turn that takes it starts: from then on it is part of the cycle too.
    const cycleTurn =
      (running !== undefined && running.endedAt === null && running.inputs.some((i) => i.kind !== "other")) ||
      Object.values(log?.requests ?? {}).some((r) => now - r.at < REPORT_WAIT_MS && r.inputs.some((i) => i.kind !== "other"));
    const inFlight = cycleTurn || (this.stored(id) && this.record(id).inFlight !== null);
    if (o === undefined) {
      return { id, parentId, keepable: false, deadline: null, lifetimeMs: null, blocks: false, selfOff: false, inFlight, reportPending: false };
    }
    const stretch = o.record.stretch;
    const context = o.facts?.context ?? null;
    const forecast = this.forecast(id, observed);
    const charged = stretch?.chargedUsd ?? 0;
    const hold = this.warmHold(o, forecast);
    return {
      id,
      parentId,
      keepable: this.isKeptWarm(id, settings) && o.thread.status === "idle" && o.thread.pending === false && o.waiting && stretch !== null && o.thread.missing.length === 0,
      deadline: o.deadline,
      lifetimeMs: o.lifetimeMs,
      blocks: stretch !== null && hold !== null && hold !== "pending-interaction" && hold !== "host-offline" && hold !== "missing-field",
      selfOff:
        hold === "host-offline" ||
        scheduledBeyondStop({ items: o.items, chargedUsd: charged, forecastUsd: forecast, rates: o.warmRates, context, deadline: o.deadline, lifetimeMs: o.lifetimeMs }),
      inFlight,
      reportPending: o.pendingReports.length > 0,
    };
  }

  private view(o: Observed, decided: KeeperPlan, tree: TreePlan, settings: KeeperSettings): ThreadView {
    const { thread, facts, record } = o;
    const setting = record.setting ?? this.lastSetting();
    const decision = record.decision === null ? null : { at: record.decision.at, what: record.decision.what, reason: record.decision.reason === null ? null : reasonText(record.decision.reason) };
    return {
      threadId: thread.id,
      title: thread.title,
      eligible: thread.providerId === "claude-code",
      status: thread.status,
      hasPendingInteraction: thread.pending !== false,
      compactOn: record.compactOn,
      setting,
      lines: o.lines,
      line: o.lines[setting - 1] ?? null,
      context: facts?.context ?? null,
      window: o.window ?? 0,
      windowKnown: o.window !== null,
      model: facts?.model ?? null,
      lifetime: facts?.lifetime ?? null,
      callsPerMessage: o.callsPerMessage,
      callsMeasured: (facts?.userMessages ?? 0) > 0,
      postCompaction: o.postCompaction,
      postMeasured: facts?.lastCompaction != null,
      priceOrigin: o.priceOrigin,
      rates: o.rates,
      deadline: o.deadline,
      compactionDue: decided.compactionDue,
      compactSkipped: record.stretch?.compactSkipped ?? false,
      compactedAt: record.stretch?.compactedAt ?? null,
      canCompactNow: thread.status === "idle" && thread.pending === false && !o.waiting && facts !== null,
      waiting: o.waiting,
      keptWarm: this.isKeptWarm(thread.id, settings),
      warmSetting: settings.keepWarm,
      treeTop: this.treeTopRef(thread.id),
      warmPlanned: tree.planned.has(thread.id),
      warmSkipped: record.stretch?.warmSkipped ?? false,
      nextWarmAt: tree.nextAt.get(thread.id) ?? null,
      warmNoPrice: o.waiting && o.warmRates === null && facts?.lifetime != null,
      counts: withBbCounts(countItems(o.items), thread),
      decision,
      transcriptUnreadable: record.transcript?.unreadable ?? null,
    };
  }

  /** The tree top covering `threadId`, with its title; the thread itself where none covers it. */
  private treeTopRef(threadId: string): ThreadRef {
    const top = this.treeTopIdOf(threadId) ?? threadId;
    return { threadId: top, title: this.titleOf(top) };
  }

  // ---- planning a tree ----

  /**
   * Works out a tree from memory: each Claude Code thread's view, what is due
   * now, and when the tree is next due. No bb or host call is made here.
   */
  private planOf(top: string): { observed: Map<string, Observed>; plans: Map<string, KeeperPlan>; tree: TreePlan; members: string[]; wake: number | null } {
    const settings = this.deps.settings();
    const now = this.now();
    const members = this.index.treeOf(top);
    const memo = new Map<string, boolean>();
    const observed = new Map<string, Observed>();
    const plans = new Map<string, KeeperPlan>();
    const wakes: number[] = [];
    for (const id of members) {
      if (!this.watched(id)) {
        this.views.delete(id);
        continue;
      }
      if (this.record(id).inFlight !== null && now - this.record(id).inFlight!.at >= IN_FLIGHT_MS) this.giveUp(id);
      // A thread bb lists as idle, with something for Cache Keeper, is in an idle stretch.
      if (this.index.get(id)!.status === "idle" && this.record(id).stretch === null) this.patch(id, (r) => (r.stretch !== null ? r : { ...r, stretch: newIdleStretch(now) }));
      const o = this.observe(id, memo);
      observed.set(id, o);
      const p = plan(this.keeperInput(o, now, settings));
      plans.set(id, p);
      if (p.wakeAt !== null) wakes.push(p.wakeAt);
      // A compaction held back is still logged at its deadline.
      if (o.record.compactOn && !o.waiting && o.deadline !== null && o.deadline > now && o.thread.status === "idle") wakes.push(o.deadline);
      if (this.hostDown.has(id) || o.record.transcript?.unreadable != null) {
        if (o.deadline !== null && o.deadline > now) wakes.push(o.deadline);
      }
    }
    const nodes = members.map((id) => this.treeNode(id, observed, settings));
    const tree = planTree(nodes, now);
    for (const [id, o] of observed) this.views.set(id, this.view(o, plans.get(id)!, tree, settings));
    if (tree.wakeAt !== null) wakes.push(tree.wakeAt);
    // Keep-warms held in a tree kept warm are logged at their deadline.
    for (const n of nodes) {
      const o = observed.get(n.id);
      if (o !== undefined && o.waiting && o.deadline !== null && o.deadline > now && this.isKeptWarm(n.id, settings)) wakes.push(o.deadline);
    }
    const staged = this.cycles.get(top);
    if (staged !== undefined) for (const p of staged.pending) wakes.push(stagedFallback(staged, p));
    // A report still on its way stops holding things once it is given up on.
    for (const o of observed.values()) {
      for (const c of o.pendingReports) {
        const ended = this.turnLog(c)?.turns.at(-1)?.endedAt;
        if (ended != null) wakes.push(ended + REPORT_WAIT_MS);
      }
    }
    const future = wakes.filter((w) => w > now);
    return { observed, plans, tree, members, wake: future.length === 0 ? null : Math.min(...future) };
  }

  /**
   * Plans a tree and sets its timer; anything due now is acted on. Views
   * that changed are published. Threads whose deadline came to matter
   * without their transcript read are learnt.
   */
  replan(top: string): void {
    if (!this.started || !this.index.isLive(top)) {
      this.scheduler.set(`tree:${top}`, null);
      return;
    }
    const before = new Map<string, string>();
    for (const id of this.index.treeOf(top)) before.set(id, JSON.stringify(this.views.get(id) ?? null));
    const { observed, plans, tree, wake } = this.planOf(top);
    const now = this.now();
    this.scheduler.set(`tree:${top}`, wake);
    const changed = [...before].filter(([id, was]) => JSON.stringify(this.views.get(id) ?? null) !== was).map(([id]) => id);
    if (changed.length > 0) this.deps.publish(changed);
    for (const [id, o] of observed) {
      if (o.record.transcript?.cursor != null || o.thread.status !== "idle" || this.learning.has(id)) continue;
      if (now - (this.unlearnt.get(id) ?? -Infinity) < RECONCILE_MS) continue;
      this.learning.add(id);
      void this.learn(id, "watched").finally(() => {
        this.learning.delete(id);
        if (this.record(id).transcript?.cursor == null) this.unlearnt.set(id, this.now());
      });
    }
    const due = [...plans.values()].some((p) => p.action !== null) || tree.due.length > 0 || this.cycles.has(top) || this.heldDue(observed, now);
    if (due && !this.actQueued.has(top)) {
      this.actQueued.add(top);
      void this.act(top);
    }
    this.scheduleKeepAlive();
  }

  /** Threads whose ended turn is being read. */
  private readonly turnEnding = new Set<string>();

  /** Trees with an act queued that has not started: a second is not queued behind it. */
  private readonly actQueued = new Set<string>();

  /** Threads being read for having come to matter. */
  private readonly learning = new Set<string>();
  /** When a thread that came to matter could not be read, so it is not tried again on every plan. */
  private readonly unlearnt = new Map<string, number>();

  /** Whether a send held back falls due now, to be logged. */
  private heldDue(observed: Map<string, Observed>, now: number): boolean {
    for (const o of observed.values()) {
      if (o.deadline !== null && now >= o.deadline && now < o.deadline + CACHE_MARGIN_MS && o.thread.status === "idle") return true;
    }
    return false;
  }

  private fire(keys: string[]): void {
    for (const key of keys) {
      if (key === "reconcile") {
        void this.serial("reconcile", () => this.reconcile())
          .catch((error) => this.deps.log.warn(`reconciliation check failed: ${message(error)}`))
          .finally(() => this.scheduleReconcile());
      } else if (key === "keepalive") {
        void this.keepAlive();
      } else if (key.startsWith("tree:")) {
        this.replan(key.slice(5));
      }
    }
  }

  /** Reads a thread's task events, and its commands' output times on its machine. */
  private async refreshTasks(threadId: string): Promise<void> {
    await this.readEvents(threadId).catch(() => {});
    const record = this.record(threadId);
    const commands = Object.entries(record.tasks).filter(([, t]) => t.kind === "command").map(([id]) => id);
    const session = record.transcript?.sessionId ?? null;
    const slug = record.transcript?.cursor?.cwdSlug ?? null;
    if (commands.length === 0 || session === null || slug === null) return;
    const hostId = await this.hostOf(threadId);
    if (hostId === null) return;
    let read: TaskActivity;
    try {
      this.counters.hostCalls++;
      read = await this.deps.tasks(hostId, { sessionId: session, cwdSlug: slug, commands, subagents: [] });
    } catch (error) {
      if (!this.hostDown.has(threadId)) this.hostDown.set(threadId, this.now());
      this.warnOnce(`host\0${threadId}\0${hostId}`, `${threadId}: its machine ${hostId} did not answer; nothing is sent to it until it does: ${message(error)}`);
      return;
    }
    this.hostDown.delete(threadId);
    this.patch(threadId, (r) => {
      const tasks = { ...r.tasks };
      for (const c of read.commands) {
        const task = tasks[c.id];
        if (task !== undefined && c.changedAt !== null) tasks[c.id] = { ...task, clock: afterActivity(task.clock, c.changedAt) };
      }
      return { ...r, tasks };
    });
  }

  // ---- acting ----

  /** Plans the tree again and sends whatever is due now, one tree at a time. */
  private act(top: string): Promise<void> {
    return this.serial(`act:${top}`, async () => {
      this.actQueued.delete(top);
      const { observed, plans, tree, members } = this.planOf(top);
      const settings = this.deps.settings();
      const now = this.now();
      this.logHeld(observed, plans, now, settings);
      const acted = new Set<string>();
      const own: Promise<void>[] = [];
      // Own rules first: a check-in or compaction refreshes the cache a keep-warm would.
      for (const [id, p] of plans) {
        const o = observed.get(id)!;
        if (p.action === null || o.record.inFlight !== null || (this.retryAt.get(id) ?? 0) > now || this.turnEnding.has(id)) continue;
        acted.add(id);
        if (p.action.kind === "compact") own.push(this.sendCompact(o, false).then(() => {}));
        else {
          const pastStop = this.treeNode(id, observed, settings).blocks && !(o.record.stretch?.warmSkipped ?? false);
          own.push(this.checkInIfStalled(id, pastStop));
        }
      }
      const sendable = (id: string) => !acted.has(id) && observed.has(id) && this.record(id).inFlight === null && (this.retryAt.get(id) ?? 0) <= now && !this.turnEnding.has(id);

      // A tree keep-warm goes to its deepest leaves first. A shallower leaf goes when the report from below reaches
      // its level, so that its turn and the report's run side by side and bb batches both reports into the parent.
      const cycle = this.cycles.get(top);
      if (cycle !== undefined) {
        const reached = (depth: number) => members.some((m) => this.index.depthOf(m) === depth && (this.turnLog(m)?.delivered.some((d) => d.at >= cycle.at) ?? false));
        const ready = cycle.pending.filter((p) => reached(p.depth) || now >= stagedFallback(cycle, p));
        const nodes = new Map(members.map((m) => [m, this.treeNode(m, observed, settings)]));
        const go = ready.filter((p) => sendable(p.id) && nodes.get(p.id)?.keepable === true).map((p) => p.id);
        if (go.length > 0) cycle.historyId = await this.sendKeepWarms(go, observed, top, cycle.historyId);
        cycle.pending = cycle.pending.filter((p) => !ready.includes(p));
        if (cycle.pending.length === 0) this.cycles.delete(top);
      }
      // No new tree keep-warm starts while the last one still has leaves to send.
      const staging = this.cycles.has(top);
      const due = tree.due.filter((d) => sendable(d.id) && !(staging && d.tree) && !(this.cycles.get(top)?.pending.some((p) => p.id === d.id) ?? false));
      const together = due.filter((d) => d.tree).map((d) => ({ id: d.id, depth: this.index.depthOf(d.id), deadline: observed.get(d.id)?.deadline ?? null }));
      if (together.length > 0) {
        const deepest = Math.max(...together.map((t) => t.depth));
        const first = together.filter((t) => t.depth === deepest).map((t) => t.id);
        const historyId = await this.sendKeepWarms(first, observed, top, null);
        const pending = together.filter((t) => t.depth < deepest);
        if (pending.length > 0) this.cycles.set(top, { at: now, deepest, pending, historyId });
      }
      await Promise.all(due.filter((d) => !d.tree).map((d) => this.sendKeepWarms([d.id], observed, d.id, null)));
      // Check-ins wait on their machine; the keep-warms above did not wait for them.
      await Promise.all(own);
      const after = this.planOf(top);
      this.scheduler.set(`tree:${top}`, after.wake);
    }).catch((error) => this.deps.log.warn(`tree of ${top}: ${message(error)}`));
  }

  /**
   * Reads the thread's task progress and output first: a task that printed
   * since its last check is not stalled. Then checks in on those still due.
   */
  private async checkInIfStalled(threadId: string, pastStop: boolean): Promise<void> {
    await this.serial(`learn:${threadId}`, () => this.refreshTasks(threadId));
    const o = this.observe(threadId, new Map());
    const p = plan(this.keeperInput(o, this.now(), this.deps.settings()));
    if (p.action?.kind === "check-in") await this.sendCheckIn(o, p.action.tasks, pastStop);
  }

  /** Logs each send due now that a rule holds back, once per due time. */
  private logHeld(observed: Map<string, Observed>, plans: Map<string, KeeperPlan>, now: number, settings: KeeperSettings): void {
    for (const [id, o] of observed) {
      if (o.deadline === null || now < o.deadline || now >= o.deadline + CACHE_MARGIN_MS || o.thread.status !== "idle") continue;
      const dueKey = `${o.deadline}`;
      if (o.waiting) {
        if (!this.isKeptWarm(id, settings)) continue;
        const hold = this.warmHold(o, this.forecast(id, observed));
        if (hold !== null) this.decide(id, "keep-warm", `keep-warm:${dueKey}`, hold);
        continue;
      }
      const r = o.record;
      if (!r.compactOn || r.stretch === null || r.stretch.compactedAt !== null || plans.get(id)?.action !== null) continue;
      const setting = r.setting ?? this.lastSetting();
      const line = o.lines[setting - 1] ?? null;
      let hold: HoldReason | null = null;
      if (o.thread.missing.length > 0 || o.thread.pending === null) hold = "missing-field";
      else if (o.thread.pending) hold = "pending-interaction";
      else if (this.hostDown.has(id)) hold = "host-offline";
      else if (r.transcript?.unreadable != null) hold = "transcript-unreadable";
      else if (r.stretch.compactSkipped) hold = "skipped";
      else if (o.window === null) hold = "window-unknown";
      else if (o.rates === null) hold = "no-price";
      else if (line === null) hold = "never";
      if (hold !== null) this.decide(id, "compact", `compact:${dueKey}`, hold);
    }
  }

  /** Reads the thread afresh from bb: its state and whether it waits on your answer. */
  private async fresh(threadId: string): Promise<FreshThread | null> {
    this.counters.bbCalls += 2;
    const [raw, pending] = await Promise.all([this.deps.getThread(threadId), this.deps.pendingInteractions(threadId).catch(() => undefined)]);
    if (raw === null) return null;
    const read = readThread(raw, false);
    if (read === null) return { status: "", archived: false, deleted: false, providerId: "", pending: null, missing: ["id"] };
    const missing = [...read.missing];
    const list = Array.isArray(pending) ? pending : Array.isArray((pending as { interactions?: unknown })?.interactions) ? (pending as { interactions: unknown[] }).interactions : null;
    if (list === null) missing.push("pendingInteractions");
    const t = this.index.get(threadId);
    if (t !== undefined) this.index.apply({ ...read.patch, pending: list === null ? t.pending : list.length > 0 }, t.missing);
    return {
      status: read.patch.status ?? "",
      archived: read.patch.archived ?? false,
      deleted: read.patch.deleted ?? false,
      providerId: read.patch.providerId ?? "",
      pending: list === null ? null : list.length > 0,
      missing: missing.filter((m) => m !== "pendingInteractions" || list === null),
    };
  }

  /** Whether what is being sent is still switched on, read from the records after bb's reply. */
  private stillOn(threadId: string, kind: SentKind, manual: boolean): HoldReason | null {
    const settings = this.deps.settings();
    const r = this.record(threadId);
    if (kind === "compact") return manual || r.compactOn ? null : "switched-off";
    if (kind === "check-in") return settings.checkIns ? null : "switched-off";
    if (settings.keepWarm === "never") return "never";
    if (!this.isKeptWarm(threadId, settings)) return "switched-off";
    for (let id: string | null = threadId; id !== null; id = this.index.liveParentOf(id)) {
      if (this.stored(id) && this.record(id).stretch?.warmSkipped) return "skipped";
    }
    return null;
  }

  /**
   * The last steps before a send: reads the thread afresh, confirms it is
   * still idle, not archived or deleted, a Claude Code thread with no pending
   * interaction, and still switched on for what is sent; then claims the due
   * time. Returns false with the reason logged and written to history.
   */
  private async prepare(planned: Planned, manual = false): Promise<boolean> {
    const { id, kind, dueKey } = planned;
    let fresh: FreshThread | null;
    try {
      fresh = await this.fresh(id);
    } catch (error) {
      this.deps.log.warn(`${id}: could not read it before sending ${kind}: ${message(error)}`);
      if (manual) throw new NotReadyError(`could not read the thread from bb: ${message(error)}`);
      return false;
    }
    const reason = confirmSend(fresh, this.stillOn(id, kind, manual));
    if (reason !== null) {
      this.deps.store.addHistory(id, this.now(), "held", { usd: null, what: kind, reason });
      this.decide(id, kind, dueKey, reason);
      if (reason === "deleted") this.onDeleted(id);
      if (manual) throw new NotReadyError(`nothing sent: ${reasonText(reason)}`);
      return false;
    }
    return true;
  }

  /**
   * Claims, records and sends one message. Returns the send's id once bb took
   * it; null when the due time was already claimed, bb refused it because the
   * thread became busy (not retried for that due time), or it failed.
   */
  private async deliver(planned: Planned, text: string, historyOf: () => number, forecastUsd: number, manual = false): Promise<number | null> {
    const { id, kind, dueKey } = planned;
    const now = this.now();
    const stretch: IdleStretch = this.record(id).stretch ?? newIdleStretch(now);
    const claim = this.deps.store.claimSend({ threadId: id, at: now, dueKey, kind, hash: textHash(text.trim()), stretchStartedAt: stretch.startedAt, forecastUsd });
    if (claim === null) {
      this.decide(id, kind, dueKey, "already-sent");
      if (manual) throw new NotReadyError("Cache Keeper already sent this thread a message for this moment");
      return null;
    }
    const wasRead = (() => {
      const t = this.index.get(id);
      return t === undefined ? null : isRead(t);
    })();
    this.patch(id, (r) => ({ ...r, stretch: r.stretch ?? stretch, inFlight: { kind, at: now, sendId: claim } }));
    let result: "sent" | "busy";
    try {
      this.counters.bbCalls++;
      result = await this.deps.send(id, text);
    } catch (error) {
      this.deps.store.dropSend(claim);
      this.patch(id, (r) => ({ ...r, inFlight: null }));
      this.retryAt.set(id, this.now() + RETRY_MS);
      this.deps.log.warn(`could not send ${kind} to ${id}: ${message(error)}`);
      if (manual) throw new NotReadyError(`bb did not take the message: ${message(error)}`);
      return null;
    }
    if (result === "busy") {
      // bb refused: the thread became busy. The claim stays, so this due time is not tried again, and nothing claims a send.
      this.patch(id, (r) => ({ ...r, inFlight: null }));
      this.decide(id, kind, dueKey, "busy");
      if (manual) throw new NotReadyError("the thread is working; it can be compacted once its turn ends");
      return null;
    }
    this.counters.sends++;
    this.deps.store.confirmSend(claim, historyOf());
    this.decide(id, kind, dueKey, null);
    // bb marks a thread read when a message is sent to it; the read state from before is put back after the turn.
    this.counters.bbCalls++;
    const after = await this.deps.getThread(id).catch(() => null);
    const read = after === null ? null : readThread(after, false);
    if (read !== null) this.index.apply(read.patch, this.index.get(id)?.missing ?? []);
    if (read !== null && wasRead !== null) {
      const readBefore: ReadBefore = { read: wasRead, lastReadAt: read.patch.lastReadAt ?? null, since: now };
      this.patch(id, (r) => (r.readBefore !== null ? r : { ...r, readBefore }));
    }
    this.deps.publish([id]);
    return claim;
  }

  /**
   * Sends keep-warms to `ids` at the same moment, as one page entry. Each asks
   * the agent to look at any task of its own that has run 30 minutes; a task
   * whose files cannot be read is asked about next time instead. Returns the
   * entry, or null when none went.
   */
  private async sendKeepWarms(ids: string[], observed: Map<string, Observed>, entryThreadId: string, historyId: number | null): Promise<number | null> {
    let entry = historyId;
    const now = this.now();
    await Promise.all(
      ids.map(async (id) => {
        const o = observed.get(id)!;
        const planned: Planned = { id, kind: "keep-warm", dueKey: `keep-warm:${o.facts?.lastRequestAt ?? now}` };
        if (!(await this.prepare(planned))) return;
        const { checkIns, waitMs } = this.deps.settings();
        const record = this.record(id);
        const routine = Object.entries(record.tasks)
          .filter(([, t]) => checkIns && foldDue(t.clock, now, waitMs))
          .map(([taskId]) => ({ id: taskId, reason: "routine" as const }));
        const folded = routine.length === 0 ? [] : await this.checkInTasks(o, routine, now);
        const forecastUsd = this.forecast(id, observed);
        const text = keepWarmText(o.items, folded);
        const historyFor = () => {
          if (entry === null) {
            entry = this.deps.store.addHistory(ids.length === 1 ? id : entryThreadId, now, "keep-warm", { usd: null, threads: [], folded: [] });
          }
          const row = this.deps.store.historyRow(entry)!;
          const threads = [...(row.record.threads ?? []), id];
          const usd = (row.record.split === undefined ? (row.record.usd ?? 0) : (row.record.usd ?? 0)) + forecastUsd;
          this.deps.store.patchHistoryRecord(entry, {
            threads,
            folded: [...(row.record.folded ?? []), ...folded.map((f) => f.id)],
            ...(row.record.split === undefined ? { usd, estimated: true } : {}),
          });
          if (threads.length > 1) this.deps.store.retitleHistory(entry, entryThreadId);
          return entry;
        };
        const sendId = await this.deliver(planned, text, historyFor, forecastUsd);
        if (sendId === null) return;
        this.patch(id, (r) => {
          const tasks = { ...r.tasks };
          for (const t of folded) if (tasks[t.id] !== undefined) tasks[t.id] = { ...tasks[t.id]!, clock: afterCheckIn(tasks[t.id]!.clock, "routine", now) };
          return { ...r, tasks, lastSendId: sendId };
        });
      }),
    );
    return entry;
  }

  /** A check-in; past the cost stop the cache is cold, so its entry shows a cold write until its turn is charged. */
  private async sendCheckIn(o: Observed, taskIds: string[], pastStop: boolean): Promise<void> {
    const now = this.now();
    const id = o.thread.id;
    const clocks = taskIds.map((t) => `${t}@${stalledDueAt(this.record(id).tasks[t]?.clock ?? { startedAt: 0, lastActivityAt: 0, lastCheckInAt: null, stalledStreak: 0 }, this.deps.settings().waitMs)}`);
    const planned: Planned = { id, kind: "check-in", dueKey: `check-in:${clocks.join(",")}` };
    if (!(await this.prepare(planned))) return;
    const tasks = await this.checkInTasks(o, taskIds.map((t) => ({ id: t, reason: "stalled" as const })), now);
    if (tasks.length === 0) return;
    const context = o.facts?.context ?? null;
    const rates = o.warmRates ?? o.rates;
    const cold = pastStop && rates !== null && context !== null;
    const sendId = await this.deliver(
      planned,
      checkInText(tasks),
      () =>
        this.deps.store.addHistory(id, now, "check-in", {
          usd: cold ? costStopUsd(rates!, context!) : null,
          coldWrite: cold,
          tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, reason: t.reason })),
        }),
      rates !== null && context !== null ? rates.r * context : 0,
    );
    if (sendId === null) return;
    this.patch(id, (r) => {
      const next = { ...r.tasks };
      for (const t of tasks) if (next[t.id] !== undefined) next[t.id] = { ...next[t.id]!, clock: afterCheckIn(next[t.id]!.clock, "stalled", now) };
      return { ...r, tasks: next };
    });
  }

  /**
   * The paragraphs for the tasks asked about. A task whose output file or
   * transcript could not be read on its machine is left for a later check
   * rather than asked about without them.
   */
  private async checkInTasks(o: Observed, asked: { id: string; reason: "stalled" | "routine" }[], now: number): Promise<CheckInTask[]> {
    const record = this.record(o.thread.id);
    const ids = (kind: TaskKind) => asked.filter((t) => record.tasks[t.id]?.kind === kind).map((t) => t.id);
    const hostId = await this.hostOf(o.thread.id);
    const session = record.transcript?.sessionId ?? null;
    const slug = record.transcript?.cursor?.cwdSlug ?? null;
    if (hostId === null || session === null || slug === null) return [];
    let read: TaskActivity;
    try {
      this.counters.hostCalls++;
      read = await this.deps.tasks(hostId, { sessionId: session, cwdSlug: slug, commands: ids("command"), subagents: ids("subagent") });
    } catch (error) {
      this.warnOnce(`tasks\0${o.thread.id}`, `could not read ${o.thread.id}'s background tasks; asking about them waits: ${message(error)}`);
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

  /** `/compact` at the deadline, or at once for Compact now; both claim the same due time, so only one goes. */
  private async sendCompact(o: Observed, manual: boolean): Promise<boolean> {
    const id = o.thread.id;
    const now = this.now();
    const planned: Planned = { id, kind: "compact", dueKey: `compact:${o.deadline ?? o.facts?.lastRequestAt ?? now}` };
    if (!(await this.prepare(planned, manual))) return false;
    const context = o.facts?.context ?? 0;
    const rates = o.rates;
    const lifetime = o.facts?.lifetime ?? null;
    let historyId = 0;
    const sendId = await this.deliver(
      planned,
      COMPACT_MESSAGE,
      () => {
        historyId = this.deps.store.addHistory(id, now, "compaction", {
          usd: rates === null ? null : compactionUsd(rates, context),
          estimated: true,
          contextBefore: context,
          contextAfter: null,
        });
        return historyId;
      },
      rates === null ? 0 : compactionUsd(rates, context),
      manual,
    );
    if (sendId === null) return false;
    const compaction = { historyId, at: now, contextBefore: context, contextAfter: null, w: rates?.w ?? null, lifetimeMs: lifetime === null ? null : lifetimeMs(lifetime) };
    this.patch(id, (r) => ({ ...r, compaction, stretch: { ...(r.stretch ?? newIdleStretch(now)), compactedAt: now } }));
    return true;
  }

  // ---- the host keep-alive ----

  /** Renews the lease on every machine with a deadline or stall check pending, every 4 minutes while any is. */
  private scheduleKeepAlive(): void {
    if (this.scheduler.get("keepalive") !== null) return;
    if (this.pendingHosts().size === 0) return;
    this.scheduler.set("keepalive", this.now());
  }

  private pendingHosts(): Set<string> {
    const hosts = new Set<string>();
    const now = this.now();
    for (const [id, view] of this.views) {
      const t = this.index.get(id);
      if (t?.hostId == null) continue;
      const tasks = this.stored(id) && Object.keys(this.record(id).tasks).length > 0;
      if (tasks || (view.deadline !== null && view.deadline + CACHE_MARGIN_MS > now && (view.compactionDue || view.warmPlanned))) hosts.add(t.hostId);
    }
    return hosts;
  }

  private async keepAlive(): Promise<void> {
    const hosts = this.pendingHosts();
    if (hosts.size === 0) return;
    this.scheduler.set("keepalive", this.now() + KEEPALIVE_MS);
    await Promise.all(
      [...hosts].map(async (hostId) => {
        this.counters.hostCalls++;
        await this.deps.retain(hostId, LEASE_MS).catch(() => {});
      }),
    );
  }

  // ---- what the surfaces ask ----

  /** The view of a thread from memory; a thread with none is read alone. */
  async viewOf(threadId: string): Promise<ThreadView | null> {
    this.viewedAt.set(threadId, this.now());
    let t = this.index.get(threadId);
    if (t === undefined) {
      this.counters.bbCalls++;
      const raw = await this.deps.getThread(threadId).catch(() => null);
      const read = raw === null ? null : readThread(raw, false);
      if (read === null) return null;
      t = this.index.apply(read.patch, read.missing);
    }
    if (t.providerId !== "claude-code") return null;
    const cached = this.views.get(threadId);
    if (cached !== undefined) return cached;
    if (this.record(threadId).transcript?.cursor == null) await this.learn(threadId, "view");
    return this.buildView(threadId);
  }

  /** Plans the thread's tree for its view, without acting. */
  private buildView(threadId: string): ThreadView | null {
    if (!this.index.isLive(threadId)) return null;
    const top = this.index.topOf(threadId);
    this.replan(top);
    return this.views.get(threadId) ?? null;
  }

  /** The views of every thread with compact when idle on, from memory. */
  switchedOn(): ThreadView[] {
    const out: ThreadView[] = [];
    for (const id of this.deps.store.compactOnIds()) {
      if (!this.index.isLive(id)) continue;
      const view = this.views.get(id) ?? this.buildView(id);
      if (view !== null) out.push(view);
    }
    return out;
  }

  /** Every view in memory. */
  allViews(): ThreadView[] {
    return [...this.views.values()];
  }

  /**
   * Whether two threads are in the same thread tree: the same top-level thread
   * by bb's parent links, archived ancestors included. Ancestors the plugin has
   * not seen are read from bb.
   */
  async sameTree(a: string, b: string): Promise<boolean> {
    const load = async (id: string) => {
      for (let at: string | null = id, depth = 0; at !== null && depth < 64; depth++) {
        let t = this.index.get(at);
        if (t === undefined) {
          this.counters.bbCalls++;
          const raw = await this.deps.getThread(at).catch(() => null);
          const read = raw === null ? null : readThread(raw, false);
          if (read === null) return;
          t = this.index.apply(read.patch, read.missing);
        }
        at = t.parentId;
      }
    };
    await Promise.all([load(a), load(b)]);
    if (this.index.get(a) === undefined || this.index.get(b) === undefined) return false;
    return this.index.rootOf(a) === this.index.rootOf(b);
  }

  /** A thread's title as bb lists it, or its id. */
  titleOf(threadId: string): string {
    return this.index.get(threadId)?.title ?? threadId;
  }

  private async requireClaude(threadId: string): Promise<Known> {
    let t = this.index.get(threadId);
    if (t === undefined) {
      this.counters.bbCalls++;
      const raw = await this.deps.getThread(threadId).catch(() => null);
      const read = raw === null ? null : readThread(raw, false);
      if (read === null || read.patch.deleted === true) throw new NotReadyError(`no thread ${threadId}`);
      t = this.index.apply(read.patch, read.missing);
    }
    if (t.providerId !== "claude-code") throw new ClaudeOnlyError("Cache Keeper acts on Claude Code threads only");
    return t;
  }

  /** Switches compact-when-idle on or off, optionally at a setting. */
  async setCompact(threadId: string, on: boolean, setting?: number): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    const last = this.lastSetting();
    this.patch(threadId, (r) => ({ ...r, compactOn: on, setting: setting ?? r.setting ?? last }));
    if (setting !== undefined) this.deps.store.setMeta(LAST_SETTING_META, setting);
    else if (on && this.deps.store.getMeta(LAST_SETTING_META) === null) this.deps.store.setMeta(LAST_SETTING_META, last);
    return this.refresh(threadId);
  }

  async setSetting(threadId: string, setting: number): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    this.patch(threadId, (r) => ({ ...r, setting }));
    this.deps.store.setMeta(LAST_SETTING_META, setting);
    return this.refresh(threadId);
  }

  /**
   * Flips Keep warm while waiting for the tree of `threadId`, recording `on`
   * on its tree top, whatever the setting says: under Never it is kept for
   * when the setting changes.
   */
  async setKeepWarm(threadId: string, on: boolean): Promise<KeepWarmResult> {
    if (this.index.get(threadId) === undefined) await this.requireClaude(threadId).catch((error) => {
      if (error instanceof ClaudeOnlyError) return;
      throw error;
    });
    if (this.index.get(threadId) === undefined) throw new NotReadyError(`no thread ${threadId}`);
    const top = this.treeTopIdOf(threadId);
    if (top === null) {
      const below = treeTopsBelow(threadId, (id) => this.index.childrenOf(id), (id) => this.index.isClaude(id));
      throw new NoTreeTopError(threadId, below.map((id) => ({ threadId: id, title: this.titleOf(id) })));
    }
    this.patch(top, (r) => ({ ...r, keepWarm: on }));
    await this.refresh(threadId);
    const settings = this.deps.settings();
    return { treeTop: this.treeTopRef(threadId), keptWarm: keptWarm(settings.keepWarm, on), never: settings.keepWarm === "never" };
  }

  /** Skip, or undo a Skip, of the compaction until the thread next runs, or of the keep-warms for this wait, for it and every thread below it. */
  async skip(threadId: string, what: "compaction" | "warm", undo: boolean): Promise<ThreadView | null> {
    const now = this.now();
    this.patch(threadId, (r) => {
      const stretch = r.stretch ?? newIdleStretch(now);
      const next = what === "compaction" ? { ...stretch, compactSkipped: !undo } : { ...stretch, warmSkipped: !undo };
      return { ...r, stretch: { ...next, skippedAt: now } };
    });
    return this.refresh(threadId);
  }

  /**
   * Compacts now, over the line or not, whatever Compact when idle says, when
   * the thread is idle, not archived or deleted, a Claude Code thread, has no
   * pending interaction and is not waiting.
   */
  async compactNow(threadId: string): Promise<ThreadView | null> {
    await this.requireClaude(threadId);
    this.viewedAt.set(threadId, this.now());
    await this.learn(threadId, "view");
    return this.serial(`act:${this.index.topOf(threadId)}`, async () => {
      const fresh = await this.fresh(threadId);
      const reason = confirmSend(fresh, null);
      if (reason === "busy") throw new NotReadyError("the thread is working; it can be compacted once its turn ends");
      if (reason === "pending-interaction") throw new NotReadyError("the thread is waiting on your answer");
      if (reason !== null) throw new NotReadyError(`the thread cannot be compacted: ${reasonText(reason)}`);
      const o = this.observe(threadId, new Map());
      if (o.waiting) throw new NotReadyError("the thread is waiting on background work, a child thread or a queued message");
      if (o.record.inFlight !== null) throw new NotReadyError("Cache Keeper already sent this thread a message that has not run yet");
      await this.sendCompact(o, true);
      return null;
    }).then(() => this.refresh(threadId));
  }

  private async refresh(threadId: string): Promise<ThreadView | null> {
    this.views.delete(threadId);
    // A thread switched on for the first time is read before its view is given.
    if (this.index.isClaude(threadId) && this.record(threadId).transcript?.cursor == null) await this.learn(threadId, "view");
    const view = this.index.isLive(threadId) ? this.buildView(threadId) : null;
    this.deps.publish([threadId]);
    return view;
  }

  /** Totals for the last `days` days; a keep-warm sent to several threads at once is one. */
  totals(days: number) {
    const sums = this.deps.store.sums(this.now() - days * DAY_MS);
    const of = (kind: string) => sums[kind] ?? { count: 0, usd: 0, avoidedUsd: 0 };
    return {
      compactions: of("compaction").count,
      compactionUsd: of("compaction").usd,
      keepWarms: of("keep-warm").count,
      checkIns: of("check-in").count,
      warmUsd: of("keep-warm").usd + of("check-in").usd,
      avoidedUsd: of("return").avoidedUsd,
    };
  }

  /**
   * After a reinstall: every thread's Compact when idle off, every tree
   * top's recorded Keep warm while waiting off, every Skip cleared.
   */
  resetSwitches(): number {
    let changed = 0;
    this.deps.store.transaction(() => {
      for (const { threadId } of this.deps.store.all()) {
        this.records.delete(threadId);
        const r = this.record(threadId);
        const stretch = r.stretch === null ? null : { ...r.stretch, compactSkipped: false, warmSkipped: false };
        if (!r.compactOn && r.keepWarm !== true && JSON.stringify(stretch) === JSON.stringify(r.stretch)) continue;
        changed++;
        this.patch(threadId, (rec) => ({ ...rec, compactOn: false, keepWarm: rec.keepWarm === null ? null : false, stretch }));
      }
    });
    for (const top of this.watchedTops()) this.replan(top);
    return changed;
  }
}

/** A background task as bb's events carry it. */
interface TaskItem {
  type?: string;
  familyId?: string;
  taskType?: string;
  description?: string;
  taskStatus?: string;
}

/** Folds one event into the thread's tasks: started, progressed (a subagent) or finished. Returns the kind of a task that finished. */
function foldTask(tasks: Record<string, TaskRecord>, type: string, at: number, item: TaskItem | null): TaskKind | null {
  // bb calls a task's id its `familyId`.
  if (item?.type !== "backgroundTask" || item.familyId === undefined) return null;
  if (type !== "item/started" && type !== "item/backgroundTask/progress" && type !== "item/backgroundTask/completed") return null;
  const kind = item.taskType === "local_bash" ? "command" : item.taskType === "local_agent" ? "subagent" : null;
  if (kind === null) return null;
  const running = item.taskStatus === "running" || item.taskStatus === "pending";
  if (type === "item/backgroundTask/completed" || !running) {
    delete tasks[item.familyId];
    return kind;
  } else if (tasks[item.familyId] === undefined) {
    const clock: TaskClock = { startedAt: at, lastActivityAt: at, lastCheckInAt: null, stalledStreak: 0 };
    tasks[item.familyId] = { kind, description: item.description ?? "", clock };
  } else if (type === "item/backgroundTask/progress" && kind === "subagent") {
    // A command's progress is its output file, read at its stall check; bb's events for it say nothing of its output.
    const task = tasks[item.familyId]!;
    tasks[item.familyId] = { ...task, clock: afterActivity(task.clock, at) };
  }
  return null;
}

/** The tasks read from events over the ones stored, keeping each stored task's check-in clock. */
function mergeTasks(stored: Record<string, TaskRecord>, read: Record<string, TaskRecord>): Record<string, TaskRecord> {
  const out: Record<string, TaskRecord> = {};
  for (const [id, task] of Object.entries(read)) {
    const was = stored[id];
    out[id] = was === undefined ? task : { ...task, clock: { ...task.clock, lastCheckInAt: was.clock.lastCheckInAt, stalledStreak: was.clock.lastActivityAt === task.clock.lastActivityAt ? was.clock.stalledStreak : task.clock.stalledStreak, lastActivityAt: Math.max(was.clock.lastActivityAt, task.clock.lastActivityAt) } };
  }
  return out;
}

function taskItems(record: ThreadRecord): WaitItem[] {
  return Object.entries(record.tasks).map(([id, task]) => ({ kind: task.kind, id, description: task.description, startedAt: task.clock.startedAt }));
}

/**
 * A shallower leaf no report reached goes 30 s a level after the deepest, and
 * never more than 30 s past its own deadline: the cache is warm for 60.
 */
const stagedFallback = (cycle: Cycle, p: Cycle["pending"][number]) =>
  Math.min(cycle.at + (cycle.deepest - p.depth) * LEAD_PER_LEVEL_MS, (p.deadline ?? Infinity) + STAGED_GRACE_MS);

/** How far past its own deadline a staged leaf may wait for the report from below; the deadline leaves a minute. */
const STAGED_GRACE_MS = 30_000;

/** bb counts a background task before its events are read; the banner takes whichever count is higher. */
function withBbCounts(counts: WaitCounts, thread: Known): WaitCounts {
  return { ...counts, commands: Math.max(counts.commands, thread.commands), subagents: Math.max(counts.subagents, thread.agents) };
}

export { CACHE_MARGIN_MS };
