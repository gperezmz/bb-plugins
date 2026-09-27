/**
 * Cache Keeper's engine: watches Claude Code threads through bb, reads their
 * transcripts on the machine that runs them, and sends the compaction,
 * keep-warm or check-in the rules in `src/core` call for.
 *
 * Everything bb, the host entry and the clock provide comes in through
 * `EngineDeps`, so a test drives it with fakes.
 */
import { afterActivity, afterCheckIn, type TaskClock } from "../core/checkins";
import { requestsUsd } from "../core/cost";
import { keepWarmUsd, newIdleStretch, plan, type KeeperAction, type IdleStretch, type WatchedTask } from "../core/keeper";
import {
  compactionUsd,
  DEFAULT_CALLS_PER_MESSAGE,
  DEFAULT_POST_COMPACTION,
  DEFAULT_SETTING,
  linesFor,
  ratesOf,
  type Rates,
} from "../core/line";
import { checkInText, COMPACT_MESSAGE, keepWarmText, type CheckInTask } from "../core/messages";
import type { PriceBook } from "../core/pricing";
import { CACHE_MARGIN_MS, callsPerMessage, deadlineOf, lifetimeMs, type TranscriptFacts, type TranscriptRequest } from "../core/transcript";
import { countItems, type ThreadView } from "../core/view";
import { hasOwnWork, waitingChildren, type TaskKind, type WaitItem, type WaitThread } from "../core/waiting";
import type { KeeperSettings } from "./settings";
import type { Store, TaskRecord, ThreadRecord } from "./store";

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
}

/** A background-task event from bb. */
export interface TaskEvent {
  seq: number;
  type: string;
  createdAt: number;
  item: { type?: string; familyId?: string; taskType?: string; description?: string; taskStatus?: string } | null;
}

export interface TranscriptRead {
  found: boolean;
  cwdSlug: string | null;
  facts: TranscriptFacts;
  requests: TranscriptRequest[];
}

export interface EngineDeps {
  store: Store;
  now(): number;
  settings(): KeeperSettings;
  prices(): PriceBook;
  listThreads(): Promise<ListedThread[]>;
  queuedMessages(threadId: string): Promise<{ sendAt: number | null; createdAt: number; failed: boolean }[]>;
  contextWindow(threadId: string): Promise<number | null>;
  sessionId(threadId: string): Promise<string | null>;
  taskEvents(threadId: string, afterSeq: number): Promise<TaskEvent[]>;
  transcript(hostId: string, sessionId: string, requestsSince: number | null): Promise<TranscriptRead>;
  tasks(
    hostId: string,
    input: { sessionId: string; cwdSlug: string; commands: string[]; subagents: string[] },
  ): Promise<{ commands: { id: string; outputFile: string; changedAt: number | null }[]; subagents: { id: string; lastTool: string | null; changedAt: number | null }[] }>;
  send(threadId: string, text: string): Promise<void>;
  publish(threadIds: string[]): void;
  log: { info(m: string): void; warn(m: string): void };
}

/** Everything read about one thread in one pass. */
interface Observed {
  thread: ListedThread;
  waiting: boolean;
  items: WaitItem[];
  facts: TranscriptFacts | null;
  cwdSlug: string | null;
  sessionId: string | null;
  window: number;
  rates: Rates | null;
  priceOrigin: string | null;
  lines: (number | null)[];
  callsPerMessage: number;
  postCompaction: number;
}

const DEFAULT_WINDOW = 200_000;
/** A send whose turn never ended is given up on after this long. */
const IN_FLIGHT_MS = 10 * 60_000;
/** A send bb has not yet reported active is taken as the cause of the next activation within this long. */
const START_MS = 2 * 60_000;
export const DAY_MS = 86_400_000;
const LAST_SETTING_META = "lastSetting";
/** How long a thread a surface showed keeps being read on every pass. */
const VIEWED_MS = 10 * 60_000;

export class ClaudeOnlyError extends Error {}
export class NotReadyError extends Error {}

export class Engine {
  private threads = new Map<string, ListedThread>();
  private views = new Map<string, ThreadView>();
  private passing: Promise<void> | null = null;
  private windows = new Map<string, number>();
  private pendingQueued = new Map<string, number>();
  /** When a surface last asked for each thread; a thread stays read for a while after. */
  private viewedAt = new Map<string, number>();

  constructor(private readonly deps: EngineDeps) {}

  /** The setting a thread switched on for the first time starts at. */
  lastSetting(): number {
    return this.deps.store.getMeta<number>(LAST_SETTING_META) ?? DEFAULT_SETTING;
  }

  // ---- bb events ----

  /** A thread turned idle: a new idle stretch unless one is running, and the end of a Cache Keeper turn. */
  async onIdle(threadId: string): Promise<void> {
    const now = this.deps.now();
    // A thread with nothing stored starts its stretch in the pass, if it has anything for Cache Keeper to do.
    if (!this.deps.store.has(threadId)) {
      await this.pass([threadId]);
      return;
    }
    const record = this.deps.store.get(threadId);
    let next: ThreadRecord = { ...record, stretch: record.stretch ?? newIdleStretch(now) };
    if (record.inFlight !== null && record.inFlight.kind === "check-in") {
      const cost = await this.checkInCost(threadId, record.inFlight.at).catch(() => null);
      if (cost !== null && next.stretch !== null) {
        next = { ...next, stretch: { ...next.stretch, warmSpentUsd: next.stretch.warmSpentUsd + cost } };
        this.deps.store.setHistoryCost(record.inFlight.historyId, cost);
      }
    }
    next = { ...next, inFlight: null };
    this.deps.store.put(threadId, next, now);
    await this.pass([threadId]);
  }

  /** A thread turned active: its idle stretch ends unless Cache Keeper's own message caused the turn. */
  onActive(threadId: string): void {
    if (!this.deps.store.has(threadId)) return;
    const now = this.deps.now();
    const record = this.deps.store.get(threadId);
    const inFlight = record.inFlight;
    // The first activation after a send is the send's turn; any other ends the stretch.
    if (inFlight !== null && inFlight.started !== true && now - inFlight.at < START_MS) {
      this.deps.store.put(threadId, { ...record, inFlight: { ...inFlight, started: true } }, now);
      return;
    }
    if (record.stretch === null) return;
    this.endStretch(threadId, record, now);
  }

  private endStretch(threadId: string, record: ThreadRecord, now: number): void {
    if (record.stretch?.compactedAt != null) this.recordReturn(threadId, record, now);
    this.deps.store.put(threadId, { ...record, stretch: null, inFlight: null }, now);
    this.views.delete(threadId);
    this.deps.publish([threadId]);
  }

  /** The first message back after a compaction: what the cold rewrite it spared would have cost. */
  private recordReturn(threadId: string, record: ThreadRecord, now: number): void {
    const c = record.compaction;
    if (c === null || c.w === null || c.lifetimeMs === null || c.contextAfter === null) return;
    // Back before the cache would have gone cold, the compaction spared nothing.
    if (now < c.at + c.lifetimeMs) return;
    this.deps.store.addHistory(threadId, now, "return", { usd: null, avoidedUsd: Math.max(0, c.w * (c.contextBefore - c.contextAfter)) });
  }

  // ---- the pass ----

  /** Reads every thread and acts where a rule says so; one pass at a time. */
  async pass(only: string[] | null = null): Promise<void> {
    if (this.passing !== null) {
      await this.passing;
      if (only === null) return;
    }
    this.passing = this.run(only).finally(() => {
      this.passing = null;
    });
    await this.passing;
  }

  /** bb's threads, with the queued messages of any whose queue holds a failed one counted, since a failed message hides pending ones. */
  private async load(): Promise<ListedThread[]> {
    const listed = await this.deps.listThreads();
    this.threads = new Map(listed.map((t) => [t.id, t]));
    this.pendingQueued = new Map();
    for (const t of listed) {
      if (t.queuedWork !== "failed") continue;
      const queued = await this.deps.queuedMessages(t.id).catch(() => []);
      this.pendingQueued.set(t.id, queued.filter((q) => !q.failed).length);
    }
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
    queuedMessageCount: this.pendingQueued.get(t.id) ?? (t.queuedWork === "waiting" ? 1 : 0),
  });

  private async run(only: string[] | null): Promise<void> {
    const listed = await this.load();
    const changed: string[] = [];
    for (const thread of listed) {
      if (only !== null && !only.includes(thread.id)) continue;
      if (thread.providerId !== "claude-code") continue;
      try {
        const before = JSON.stringify(this.views.get(thread.id) ?? null);
        await this.step(thread, listed);
        if (JSON.stringify(this.views.get(thread.id) ?? null) !== before) changed.push(thread.id);
      } catch (error) {
        this.deps.log.warn(`thread ${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Threads no longer listed are archived or deleted: forget their stretch.
    for (const { threadId, record } of this.deps.store.all()) {
      if (!this.threads.has(threadId) && (record.stretch !== null || record.inFlight !== null)) {
        this.deps.store.put(threadId, { ...record, stretch: null, inFlight: null }, this.deps.now());
        this.views.delete(threadId);
      }
    }
    if (changed.length > 0) this.deps.publish(changed);
  }

  private isClaude(threadId: string): boolean {
    return this.threads.get(threadId)?.providerId === "claude-code";
  }

  /** One thread: bring its stretch in line with bb, read what it needs, act. */
  private async step(thread: ListedThread, listed: ListedThread[]): Promise<void> {
    const now = this.deps.now();
    const settings = this.deps.settings();
    let record = this.deps.store.get(thread.id);
    const stored = this.deps.store.has(thread.id);

    // After a restart, bb's status is the truth: an idle thread is in a stretch, a working one is not.
    if (thread.status === "idle" && record.stretch === null && (stored || this.mayAct(thread, listed, settings))) {
      record = { ...record, stretch: newIdleStretch(now) };
      this.deps.store.put(thread.id, record, now);
    } else if (thread.status !== "idle" && record.stretch !== null && (record.inFlight === null || now - record.inFlight.at >= IN_FLIGHT_MS)) {
      this.endStretch(thread.id, record, now);
      record = this.deps.store.get(thread.id);
    }
    if (record.inFlight !== null && now - record.inFlight.at >= IN_FLIGHT_MS) {
      record = { ...record, inFlight: null };
      this.deps.store.put(thread.id, record, now);
    }

    const viewed = now - (this.viewedAt.get(thread.id) ?? -Infinity) < VIEWED_MS;
    const interesting = record.compactOn || record.stretch?.compactedAt != null || viewed || this.mayAct(thread, listed, settings);
    if (!interesting) {
      this.views.delete(thread.id);
      return;
    }
    let observed = await this.observe(thread, listed, record);
    const done = observed.facts?.lastCompaction;
    if (record.compaction !== null && record.compaction.contextAfter === null && done != null && done.at >= record.compaction.at - CACHE_MARGIN_MS) {
      this.deps.store.setContextAfter(record.compaction.historyId, done.postTokens);
      record = { ...record, compaction: { ...record.compaction, contextAfter: done.postTokens } };
    }
    if (observed.waiting) {
      record = await this.watchTasks(thread, observed, record);
      observed = { ...observed, items: [...observed.items.filter((i) => i.kind !== "command" && i.kind !== "subagent"), ...taskItems(record)] };
    } else if (Object.keys(record.tasks).length > 0) record = { ...record, tasks: {} };
    this.deps.store.put(thread.id, record, now);

    const input = this.keeperInput(observed, record, now, settings);
    const decided = plan(input);
    this.views.set(thread.id, this.view(observed, record, decided));
    if (decided.action !== null && record.inFlight === null) await this.act(thread.id, decided.action, observed, record, now);
  }

  /** Whether keep-warms or check-ins could apply: idle, waiting, and the setting on. */
  private mayAct(thread: ListedThread, listed: ListedThread[], settings: KeeperSettings): boolean {
    return settings.checkIns && thread.status === "idle" && this.waitsByCounts(thread, listed);
  }

  private waitsByCounts(thread: ListedThread, listed: ListedThread[]): boolean {
    return hasOwnWork(this.toWait(thread)) || waitingChildren(thread.id, listed.map(this.toWait)).length > 0;
  }

  private async observe(thread: ListedThread, listed: ListedThread[], record: ThreadRecord): Promise<Observed> {
    const waitThreads = listed.map(this.toWait);
    const items: WaitItem[] = [];
    items.push(...taskItems(record));
    for (const child of waitingChildren(thread.id, waitThreads)) {
      items.push({ kind: "child", id: child.id, title: child.title, startedAt: child.createdAt });
    }
    if (thread.queuedWork !== "none" || thread.status === "idle") {
      const queued = thread.queuedWork === "none" ? [] : await this.deps.queuedMessages(thread.id).catch(() => []);
      for (const q of queued) {
        if (q.failed) continue;
        items.push(q.sendAt !== null ? { kind: "scheduled", dueAt: q.sendAt, createdAt: q.createdAt } : { kind: "queued", createdAt: q.createdAt });
      }
    }
    const waiting = this.waitsByCounts(thread, listed) || items.length > 0;

    const sessionId = await this.deps.sessionId(thread.id);
    let facts: TranscriptFacts | null = null;
    let cwdSlug: string | null = null;
    if (sessionId !== null && thread.environmentHostId !== null) {
      const read = await this.deps.transcript(thread.environmentHostId, sessionId, null);
      if (read.found) {
        facts = read.facts;
        cwdSlug = read.cwdSlug;
      }
    }
    let window = this.windows.get(thread.id);
    if (window === undefined) {
      window = (await this.deps.contextWindow(thread.id).catch(() => null)) ?? DEFAULT_WINDOW;
      this.windows.set(thread.id, window);
    }
    const price = this.deps.prices().lookup(facts?.model ?? null);
    const rates = price !== null && facts?.lifetime != null ? ratesOf(price.price, facts.lifetime) : null;
    const k = facts === null ? DEFAULT_CALLS_PER_MESSAGE : callsPerMessage(facts, DEFAULT_CALLS_PER_MESSAGE);
    const p = facts?.lastCompaction?.postTokens ?? DEFAULT_POST_COMPACTION;
    const lines = rates === null ? Array.from({ length: 10 }, () => null) : linesFor({ rates, k, p, window });
    return { thread, waiting, items, facts, cwdSlug, sessionId, window, rates, priceOrigin: price?.origin ?? null, lines, callsPerMessage: k, postCompaction: p };
  }

  /** Brings the thread's background tasks and their clocks up to date from bb's events and the host. */
  private async watchTasks(thread: ListedThread, observed: Observed, record: ThreadRecord): Promise<ThreadRecord> {
    const tasks: Record<string, TaskRecord> = { ...record.tasks };
    let afterSeq = record.eventsAfterSeq;
    for (let page = 0; page < 20; page++) {
      const events = await this.deps.taskEvents(thread.id, afterSeq);
      for (const e of events) {
        afterSeq = Math.max(afterSeq, e.seq);
        const item = e.item;
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
      if (events.length < 500) break;
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
    const { facts } = observed;
    const setting = record.setting ?? this.lastSetting();
    const watched: WatchedTask[] = Object.entries(record.tasks).map(([id, t]) => ({ kind: t.kind, id, clock: t.clock }));
    return {
      now,
      claudeCode: observed.thread.providerId === "claude-code",
      status: observed.thread.status,
      hasPendingInteraction: observed.thread.hasPendingInteraction,
      waiting: observed.waiting,
      items: observed.items,
      tasks: watched,
      deadline: facts === null ? null : deadlineOf(facts),
      lifetimeMs: facts?.lifetime == null ? null : lifetimeMs(facts.lifetime),
      context: facts?.context ?? null,
      rates: observed.rates,
      compactOn: record.compactOn,
      line: observed.lines[setting - 1] ?? null,
      stretch: record.stretch,
      checkIns: settings.checkIns,
      waitMs: settings.waitMs,
    };
  }

  private view(observed: Observed, record: ThreadRecord, decided: ReturnType<typeof plan>): ThreadView {
    const { thread, facts } = observed;
    const setting = record.setting ?? this.lastSetting();
    const deadline = facts === null ? null : deadlineOf(facts);
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
      deadline,
      compactionDue: decided.compactionDue,
      compactSkipped: record.stretch?.compactSkipped ?? false,
      compactedAt: record.stretch?.compactedAt ?? null,
      canCompactNow: thread.status === "idle" && !thread.hasPendingInteraction && !observed.waiting && facts !== null,
      waiting: observed.waiting,
      warmDue: decided.warmDue,
      warmSkipped: record.stretch?.warmSkipped ?? false,
      nextWarmAt: decided.nextWarmAt,
      counts: countItems(observed.items),
    };
  }

  // ---- sending ----

  private async act(threadId: string, action: KeeperAction, observed: Observed, record: ThreadRecord, now: number): Promise<void> {
    const context = observed.facts?.context ?? 0;
    const rates = observed.rates;
    if (action.kind === "compact") {
      await this.sendCompact(threadId, observed, now);
      return;
    }
    if (action.kind === "keep-warm") {
      const usd = rates === null ? 0 : keepWarmUsd(rates, context);
      const historyId = this.deps.store.addHistory(threadId, now, "keep-warm", { usd, contextBefore: context });
      await this.sendTracked(threadId, keepWarmText(observed.items), { kind: "keep-warm", at: now, historyId }, (stretch) => ({
        ...stretch,
        warmSpentUsd: stretch.warmSpentUsd + usd,
      }));
      return;
    }
    const tasks = await this.checkInTasks(observed, record, action, now);
    if (tasks.length === 0) return;
    const historyId = this.deps.store.addHistory(threadId, now, "check-in", {
      usd: null,
      tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, reason: t.reason })),
    });
    const sent = await this.sendTracked(threadId, checkInText(tasks), { kind: "check-in", at: now, historyId }, (s) => s);
    if (sent) {
      this.deps.store.update(threadId, now, (r) => {
        const next = { ...r.tasks };
        for (const t of tasks) {
          const task = next[t.id];
          if (task !== undefined) next[t.id] = { ...task, clock: afterCheckIn(task.clock, t.reason, now) };
        }
        return { ...r, tasks: next };
      });
    }
  }

  /**
   * The check-in paragraphs for the tasks due. A task whose output file or
   * transcript could not be read on its machine is left for a later pass
   * rather than sent without them.
   */
  private async checkInTasks(observed: Observed, record: ThreadRecord, action: Extract<KeeperAction, { kind: "check-in" }>, now: number): Promise<CheckInTask[]> {
    const ids = (kind: TaskKind) => action.tasks.filter((t) => record.tasks[t.id]?.kind === kind).map((t) => t.id);
    const hostId = observed.thread.environmentHostId;
    if (hostId === null || observed.sessionId === null || observed.cwdSlug === null) return [];
    let read: Awaited<ReturnType<EngineDeps["tasks"]>>;
    try {
      read = await this.deps.tasks(hostId, { sessionId: observed.sessionId, cwdSlug: observed.cwdSlug, commands: ids("command"), subagents: ids("subagent") });
    } catch (error) {
      this.deps.log.warn(`could not read ${observed.thread.id}'s background tasks; its check-in waits: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    const out: CheckInTask[] = [];
    for (const { id, reason } of action.tasks) {
      const task = record.tasks[id];
      if (task === undefined) continue;
      const common = {
        id,
        reason,
        description: task.description,
        startedAt: task.clock.startedAt,
        silentMs: now - task.clock.lastActivityAt,
        runningMs: now - task.clock.startedAt,
      };
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

  private async sendCompact(threadId: string, observed: Observed, now: number): Promise<void> {
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
    await this.sendTracked(threadId, COMPACT_MESSAGE, { kind: "compact", at: now, historyId }, (stretch) => ({ ...stretch, compactedAt: now }));
  }

  /** Marks the send in flight, sends, and applies `change` to the stretch once bb took it. */
  private async sendTracked(
    threadId: string,
    text: string,
    inFlight: NonNullable<ThreadRecord["inFlight"]>,
    change: (stretch: IdleStretch) => IdleStretch,
  ): Promise<boolean> {
    const now = this.deps.now();
    const before = this.deps.store.update(threadId, now, (r) => ({ ...r, inFlight, stretch: r.stretch ?? newIdleStretch(now) }));
    try {
      await this.deps.send(threadId, text);
    } catch (error) {
      this.deps.store.put(threadId, { ...before, inFlight: null }, now);
      this.deps.log.warn(`could not send ${inFlight.kind} to ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    this.deps.store.update(threadId, now, (r) => ({ ...r, stretch: change(r.stretch ?? newIdleStretch(now)) }));
    this.deps.publish([threadId]);
    return true;
  }

  private async checkInCost(threadId: string, since: number): Promise<number | null> {
    const thread = this.threads.get(threadId);
    const sessionId = await this.deps.sessionId(threadId);
    if (thread?.environmentHostId == null || sessionId === null) return null;
    const read = await this.deps.transcript(thread.environmentHostId, sessionId, since);
    const price = this.deps.prices().lookup(read.facts.model);
    return price === null ? null : requestsUsd(read.requests, price.price);
  }

  // ---- what the surfaces ask ----

  /** The view of a thread, read now if the last pass skipped it. */
  async viewOf(threadId: string): Promise<ThreadView | null> {
    this.viewedAt.set(threadId, this.deps.now());
    if (!this.views.has(threadId)) {
      const listed = await this.load();
      const thread = this.threads.get(threadId);
      if (thread === undefined || thread.providerId !== "claude-code") return null;
      const record = this.deps.store.get(threadId);
      const observed = await this.observe(thread, listed, record);
      const now = this.deps.now();
      this.views.set(threadId, this.view(observed, record, plan(this.keeperInput(observed, record, now, this.deps.settings()))));
    }
    return this.views.get(threadId) ?? null;
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

  /** Skip, or undo a Skip, of the compaction or the keep-warms and check-ins, for this idle stretch. */
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
    const listed = await this.load();
    const thread = this.threads.get(threadId)!;
    const record = this.deps.store.get(threadId);
    const observed = await this.observe(thread, listed, record);
    if (thread.status !== "idle") throw new NotReadyError("the thread is working; it can be compacted once its turn ends");
    if (thread.hasPendingInteraction) throw new NotReadyError("the thread is waiting on your answer");
    if (observed.waiting) throw new NotReadyError("the thread is waiting on background work, a child thread or a queued message");
    if (record.inFlight !== null) throw new NotReadyError("Cache Keeper already sent this thread a message that has not run yet");
    await this.sendCompact(threadId, observed, this.deps.now());
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

  /** Totals for the last `days` days. */
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
