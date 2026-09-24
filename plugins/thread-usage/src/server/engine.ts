/**
 * The backend's moving parts: ledger catch-up from bb events, the
 * gateway sweep, harness-log reads and the backfill queue, and
 * budget crossings. bb is reached through {@link EngineDeps} so tests
 * can drive it without a server.
 */
import { crossingKey, newCrossings } from "../core/budget";
import type { Harness, LogEntry } from "../host/contract";
import { LOG_PAGE_MAX } from "../host/contract";
import { ancestorIds, indexEdges } from "../core/family";
import { costTotal } from "../core/figure-math";
import {
  EMPTY_CURSOR,
  ingestEvents,
  LEDGER_EVENT_TYPES,
  slimEvent,
  type LedgerEvent,
} from "../core/ledger";
import {
  fetchModelInfo,
  GatewayError,
  sweepSpendLogs,
  SWEEP_OVERLAP_MS,
  type Fetch,
} from "../core/litellm";
import type { ModelPrice } from "../core/pricing";
import type { GatewayBanner } from "../core/report-types";
import type { UsageModel } from "./model";
import type { UsageSettings } from "./settings";
import type { EdgeExtra, Store, ThreadState } from "./store";

/** The subset of a bb thread DTO the plugin reads. */
export interface ThreadDto {
  id: string;
  projectId?: string | null;
  environmentId?: string | null;
  providerId?: string | null;
  title?: string | null;
  titleFallback?: string | null;
  parentThreadId?: string | null;
  sourceThreadId?: string | null;
  visibility?: string | null;
  archivedAt?: number | null;
  deletedAt?: number | null;
  createdAt?: number | null;
  status?: string | null;
}

export interface EngineDeps {
  store: Store;
  model: UsageModel;
  settings: () => UsageSettings;
  now: () => number;
  listEvents(args: {
    threadId: string;
    afterSeq: number;
    types: readonly string[];
    limit: number;
  }): Promise<LedgerEvent[]>;
  getThread(threadId: string): Promise<ThreadDto | null>;
  listThreads(offset: number, limit: number): Promise<ThreadDto[]>;
  hostIdForEnvironment(environmentId: string): Promise<string | null>;
  hostName(hostId: string): Promise<string>;
  readLogs(
    hostId: string,
    input: {
      harness: Harness;
      sessionIds: string[];
      sinceMs: number | null;
      untilMs: number | null;
      includeSubagents: boolean;
      offset: number;
      limit: number;
    },
    timeoutMs: number,
  ): Promise<{ entries: LogEntry[]; nextOffset: number | null; sessionsFound: string[] }>;
  fetch: Fetch;
  publish(channel: string, payload: unknown): void;
  log: { info(m: string): void; warn(m: string): void; error(m: string): void };
}

export const USAGE_CHANGED = "usage-changed";
/** bb refuses event pages above 100 ("Thread event limit cannot exceed 100"). */
export const EVENTS_PAGE = 100;
/**
 * How long a busy thread's event notifications are gathered into one
 * catch-up. Agents notify in bursts with pauses of several seconds between
 * them: on real threads 2.5 s saved 27 % of reads and 10 s saved 71 %.
 * Harnesses report a turn's tokens when it ends, and that catch-up (idle,
 * failed) does not wait; bb keeps a usage snapshot for at least 30 s.
 */
export const CATCH_UP_DELAY_MS = 10_000;
/** Threads a panel refresh catches up or reads logs for at once. */
export const REFRESH_CONCURRENCY = 4;
/** Log reads while the panel is open. */
export const PANEL_LOG_TIMEOUT_MS = 5_000;
/** Log reads from the backfill queue. */
export const BACKFILL_LOG_TIMEOUT_MS = 5 * 60_000;
const INITIAL_SWEEP_LOOKBACK_MS = 30 * 86_400_000;

/** True when every field `edge` sets already has that value in `stored`. */
function sameEdge(stored: EdgeExtra, edge: Partial<EdgeExtra>): boolean {
  return (Object.keys(edge) as (keyof EdgeExtra)[]).every((key) => stored[key] === edge[key]);
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

const maxHint = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

function harnessOf(providerId: string | null): Harness | null {
  if (providerId === "claude-code" || providerId === "pi" || providerId === "codex") return providerId;
  return null;
}

export function edgeFromDto(dto: ThreadDto): Partial<EdgeExtra> & { threadId: string } {
  const title = dto.title ?? dto.titleFallback ?? null;
  return {
    threadId: dto.id,
    ...(dto.parentThreadId !== undefined ? { parentThreadId: dto.parentThreadId } : {}),
    ...(dto.sourceThreadId !== undefined ? { sourceThreadId: dto.sourceThreadId } : {}),
    ...(dto.providerId !== undefined ? { providerId: dto.providerId } : {}),
    ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
    ...(dto.environmentId !== undefined ? { environmentId: dto.environmentId } : {}),
    ...(title !== null
      ? { title: title.length > 200 ? `${title.slice(0, 199)}…` : title, titleFromPrompt: dto.title == null }
      : {}),
    ...(dto.visibility !== undefined ? { hidden: dto.visibility === "hidden" } : {}),
    ...(dto.archivedAt !== undefined ? { archivedAt: dto.archivedAt } : {}),
    // A thread bb still serves is not deleted, whatever an earlier discovery assumed.
    ...(dto.deletedAt !== undefined ? { deletedAt: dto.deletedAt } : {}),
    ...(dto.createdAt !== undefined ? { createdAt: dto.createdAt } : {}),
    ...(dto.status !== undefined ? { status: dto.status } : {}),
  };
}

export class Engine {
  private readonly chains = new Map<string, Promise<void>>();
  /** A catch-up waiting in its thread's chain that has not started: later calls join it. */
  private readonly queued = new Map<string, Promise<void>>();
  /** The highest sequence hint for the queued catch-up of each thread. */
  private readonly queuedHints = new Map<string, number>();
  /** Catch-ups gathering a busy thread's notifications (see {@link catchUpSoon}). */
  private readonly soon = new Map<string, { timer: ReturnType<typeof setTimeout>; hint: number | undefined }>();
  /** Per thread, the sequence every ledger event up to which has been read. */
  private readonly readThrough = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping: Promise<void> | null = null;
  private gatewayPrices: Record<string, ModelPrice> | null = null;
  private gatewayPricesAt = 0;
  private disposed = false;

  constructor(private readonly deps: EngineDeps) {}

  dispose(): void {
    this.disposed = true;
    if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    for (const { timer } of this.soon.values()) clearTimeout(timer);
    this.soon.clear();
  }

  /** The gateway's price map, when read (`/model/info`). */
  gatewayPriceMap(): Record<string, ModelPrice> | null {
    return this.gatewayPrices;
  }

  // ---- edges ----

  recordThread(dto: ThreadDto): void {
    const now = this.deps.now();
    const before = this.deps.store.getEdge(dto.id);
    const edge = edgeFromDto(dto);
    // bb detaches a deleted thread's children (parent becomes null). They
    // stay under it here, so the family total above does not change.
    if (
      edge.parentThreadId === null &&
      before?.parentThreadId != null &&
      this.deps.store.getEdge(before.parentThreadId)?.deletedAt != null
    ) {
      delete edge.parentThreadId;
    }
    // Busy threads send their DTO about once a second, mostly unchanged: no write then.
    if (before !== null && sameEdge(before, edge)) {
      if (dto.status === "active" && before.idleSince !== null) {
        this.deps.store.upsertEdge({ threadId: dto.id, idleSince: null }, now);
      }
      return;
    }
    this.deps.store.upsertEdge(edge, now);
    // Title, visibility or archive state may have changed.
    this.deps.model.invalidate([dto.id]);
    const parentChanged =
      before !== null && edge.parentThreadId !== undefined && before.parentThreadId !== edge.parentThreadId;
    if (dto.status === "active") this.deps.store.upsertEdge({ threadId: dto.id, idleSince: null }, now);
    else if (before?.status === "active" && dto.status !== undefined) {
      this.deps.store.upsertEdge({ threadId: dto.id, idleSince: now }, now);
    }
    if (parentChanged) this.changed([dto.id, before.parentThreadId ?? dto.id]);
    // Chips count their hidden descendants and reports list titles: tell them.
    else if (before !== null && (["title", "hidden", "archivedAt", "deletedAt"] as const).some((k) => k in edge && edge[k] !== before[k])) {
      this.changed([dto.id]);
    }
  }

  // ---- ledger ----

  /**
   * Serializes work per thread. The returned promise rejects when `work`
   * fails; the chain itself keeps going.
   */
  private serial(threadId: string, work: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(threadId) ?? Promise.resolve();
    const run = prev.then(work, work);
    const settled = run.catch(() => undefined);
    this.chains.set(threadId, settled);
    void settled.then(() => {
      if (this.chains.get(threadId) === settled) this.chains.delete(threadId);
    });
    return run;
  }

  /** Catch-up that logs instead of rejecting, for event handlers. */
  catchUpQuietly(threadId: string, latestSeq?: number): Promise<void> {
    return this.catchUp(threadId, latestSeq).catch((error: unknown) => {
      this.deps.log.warn(`thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Catch-up for a busy thread's event notification. Notifications for
   * events already read are dropped; the rest are gathered for
   * {@link CATCH_UP_DELAY_MS} into one catch-up, so a working thread costs
   * one events read per interval, not one per event.
   */
  catchUpSoon(threadId: string, latestSeq?: number): void {
    if (this.disposed) return;
    if (latestSeq !== undefined && latestSeq <= (this.readThrough.get(threadId) ?? -1)) return;
    const pending = this.soon.get(threadId);
    if (pending !== undefined) {
      pending.hint = maxHint(pending.hint, latestSeq);
      return;
    }
    const entry = {
      hint: latestSeq,
      timer: setTimeout(() => {
        if (this.soon.get(threadId) === entry) this.soon.delete(threadId);
        void this.catchUpQuietly(threadId, entry.hint);
      }, CATCH_UP_DELAY_MS),
    };
    this.soon.set(threadId, entry);
  }

  /**
   * Reads events after the stored cursor and folds them into the ledger, now:
   * a gathering {@link catchUpSoon} is folded in. A call made while another
   * catch-up of the thread is still waiting its turn joins that one, which
   * reads the cursor when it starts, so it covers this call too.
   */
  catchUp(threadId: string, latestSeq?: number): Promise<void> {
    const pending = this.soon.get(threadId);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      this.soon.delete(threadId);
      latestSeq = maxHint(latestSeq, pending.hint);
    }
    if (latestSeq !== undefined) this.queuedHints.set(threadId, maxHint(this.queuedHints.get(threadId), latestSeq)!);
    const waiting = this.queued.get(threadId);
    if (waiting !== undefined) return waiting;
    const run: Promise<void> = this.serial(threadId, () => {
      if (this.queued.get(threadId) === run) this.queued.delete(threadId);
      const hint = this.queuedHints.get(threadId);
      this.queuedHints.delete(threadId);
      return this.catchUpNow(threadId, hint);
    });
    this.queued.set(threadId, run);
    return run;
  }

  private async catchUpNow(threadId: string, latestSeqHint?: number): Promise<void> {
    const { store } = this.deps;
    const now = this.deps.now();
    const state: ThreadState = store.getThread(threadId) ?? {
      threadId,
      cursor: EMPTY_CURSOR,
      firstSeenAt: null,
      gaps: [],
      historyBackfilled: false,
      logsReadThrough: null,
      logsMissingHost: null,
      logsMissingSince: null,
      lastActivityAt: null,
    };
    const events: LedgerEvent[] = [];
    let after = state.cursor.lastSeq;
    for (;;) {
      const page = await this.deps.listEvents({
        threadId,
        afterSeq: after,
        types: LEDGER_EVENT_TYPES,
        limit: EVENTS_PAGE,
      });
      for (const event of page) events.push(slimEvent(event));
      if (page.length < EVENTS_PAGE) break;
      after = page[page.length - 1]!.seq;
    }
    // bb sends the hint after writing the event, so every ledger event up to
    // it has now been read (the rule the cursor below already follows).
    const latestSeq = events.reduce((m, e) => Math.max(m, e.seq), Math.max(latestSeqHint ?? 0, state.cursor.lastSeq));
    if (events.length === 0 && state.firstSeenAt !== null) {
      this.markReadThrough(threadId, latestSeq);
      return;
    }
    // A fork starts with a copy of its source's events, stamped with their
    // original times. Its own ledger starts at its creation.
    const forkEdge = store.getEdge(threadId);
    const forkCreatedAt =
      forkEdge !== null && forkEdge.sourceThreadId !== null ? forkEdge.createdAt : null;
    const own = forkCreatedAt === null ? events : events.filter((e) => e.createdAt >= forkCreatedAt);
    const touched = new Set<string>();
    for (const e of own) if (e.scope.kind === "turn") touched.add(e.scope.turnId);
    const existing = store.getTurnsById(threadId, [...touched]);
    const result = ingestEvents({
      cursor: state.firstSeenAt === null ? { ...state.cursor, firstSeenAt: null } : { ...state.cursor, firstSeenAt: state.firstSeenAt },
      turns: existing,
      events: own,
      latestSeq,
      now,
    });
    const next: ThreadState = {
      ...state,
      cursor: result.cursor,
      firstSeenAt: state.firstSeenAt ?? result.cursor.firstSeenAt ?? now,
      gaps: [...state.gaps, ...result.gaps.map((g) => ({ fromMs: g.fromMs, toMs: g.toMs, resolution: g.resolution }))],
      lastActivityAt: own.reduce((m, e) => Math.max(m, e.createdAt), state.lastActivityAt ?? 0) || state.lastActivityAt,
    };
    store.putTurns(threadId, result.turns.values());
    store.putThread(next, now);
    this.markReadThrough(threadId, latestSeq);
    const settings = this.deps.settings();
    const edge = store.getEdge(threadId);
    const harness = harnessOf(edge?.providerId ?? null);
    if (settings.readLogs && harness !== null) {
      if (result.opened) {
        store.enqueue(
          { threadId, kind: "logs", fromMs: null, toMs: next.firstSeenAt, priority: edge?.createdAt ?? now },
          now,
        );
      }
      for (const gap of result.gaps.filter((g) => g.resolution === "partial")) {
        store.enqueue({ threadId, kind: "logs", fromMs: gap.fromMs, toMs: gap.toMs, priority: edge?.createdAt ?? now }, now);
      }
    }
    if (events.length > 0) this.changed([threadId]);
  }

  private markReadThrough(threadId: string, seq: number): void {
    this.readThrough.set(threadId, Math.max(this.readThrough.get(threadId) ?? -1, seq));
  }

  /** Publishes a change for these threads and their ancestors, and checks the budget. */
  changed(threadIds: Iterable<string>): void {
    const index = indexEdges(this.deps.store.allEdges());
    const all = new Set<string>();
    for (const id of threadIds) {
      all.add(id);
      for (const a of ancestorIds(index, id)) all.add(a);
    }
    this.deps.model.invalidate(all);
    let crossed = false;
    for (const id of threadIds) crossed = this.checkBudget(id) || crossed;
    // A crossing tints every chip of the crossed family, including threads
    // outside this change's line of ancestors: tell every surface.
    this.deps.publish(USAGE_CHANGED, { threadIds: crossed ? [] : [...all] });
  }

  /** Records new budget crossings; true when there were any. */
  private checkBudget(threadId: string): boolean {
    const settings = this.deps.settings();
    if (settings.warnAbove === null) return false;
    const totals = this.deps.model.ancestorTotals(threadId);
    const crossings = newCrossings(totals, settings.warnAbove, this.deps.store.crossingKeys(), this.deps.now());
    for (const c of crossings) {
      this.deps.store.addCrossing(crossingKey(c.rootThreadId, c.amount), c);
      this.deps.log.info(`family ${c.rootThreadId} crossed ${c.amount}`);
    }
    return crossings.length > 0;
  }

  // ---- gateway ----

  /** Runs a sweep now (coalesced with one already running). */
  sweep(): Promise<void> {
    if (this.sweeping !== null) return this.sweeping;
    this.sweeping = this.sweepNow().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  /** Schedules a sweep after `delayMs`, keeping the earliest pending one. */
  scheduleSweep(delayMs: number): void {
    if (this.disposed) return;
    const at = this.deps.now() + delayMs;
    if (this.sweepTimer !== null && this.nextSweepAt <= at) return;
    if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    this.nextSweepAt = at;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      this.nextSweepAt = Number.POSITIVE_INFINITY;
      void this.sweep();
    }, delayMs);
  }
  private nextSweepAt = Number.POSITIVE_INFINITY;

  private async sweepNow(): Promise<void> {
    const settings = this.deps.settings();
    if (settings.adapter !== "litellm") return;
    const { store } = this.deps;
    const now = this.deps.now();
    if (settings.gatewayUrl === "" || settings.readKey === null) {
      this.setBanner({
        check: settings.gatewayUrl === "" ? "reachable" : "key-valid",
        message: settings.gatewayUrl === "" ? "Gateway URL is not set" : "Gateway read key is not set",
        since: now,
      });
      return;
    }
    const config = { baseUrl: settings.gatewayUrl, key: settings.readKey, fetch: this.deps.fetch };
    const lastSweep = store.getMeta<number>("lastSweepAt");
    const from = lastSweep === null ? now - INITIAL_SWEEP_LOOKBACK_MS : lastSweep - SWEEP_OVERLAP_MS;
    try {
      const result = await sweepSpendLogs(config, from, now + 60_000);
      const known = new Set(store.allEdges().map((e) => e.threadId));
      const rows = result.rows.filter((r) => known.has(r.threadId));
      const touched = store.upsertGatewayRows(rows);
      // A truncated sweep resumes from the newest row it read (the next one
      // starts SWEEP_OVERLAP_MS before lastSweepAt).
      store.setMeta(
        "lastSweepAt",
        result.truncated && result.resumeFrom !== null ? result.resumeFrom + SWEEP_OVERLAP_MS : now,
      );
      this.setBanner(null);
      if (now - this.gatewayPricesAt > 3_600_000) {
        this.gatewayPricesAt = now;
        try {
          this.gatewayPrices = await fetchModelInfo(config);
          store.setMeta("gatewayPrices", this.gatewayPrices);
          this.deps.model.invalidateAll();
        } catch {
          // /model/info is optional: the edge may not expose it.
        }
      }
      if (touched.size > 0) this.changed(touched);
    } catch (error) {
      const banner: GatewayBanner =
        error instanceof GatewayError
          ? { check: error.check, message: error.message, since: now }
          : { check: "reachable", message: error instanceof Error ? error.message : String(error), since: now };
      const previous = store.getMeta<GatewayBanner>("gatewayBanner");
      this.setBanner(previous !== null && previous.check === banner.check ? { ...banner, since: previous.since } : banner);
      this.deps.log.warn(`gateway sweep failed: ${banner.message}`);
    }
  }

  private setBanner(banner: GatewayBanner | null): void {
    const previous = this.deps.store.getMeta<GatewayBanner | null>("gatewayBanner");
    this.deps.store.setMeta("gatewayBanner", banner);
    if ((previous === null) !== (banner === null)) {
      this.deps.model.invalidateAll();
      this.deps.publish(USAGE_CHANGED, { threadIds: [] });
    }
  }

  loadGatewayPrices(): void {
    this.gatewayPrices = this.deps.store.getMeta<Record<string, ModelPrice>>("gatewayPrices");
  }

  // ---- harness logs ----

  /**
   * Reads a thread's harness logs on its machine: subagent entries (Claude
   * Code), the harness's own cost (pi), and a history or gap window when
   * `window` is given. A failure marks the thread `logs-missing`.
   */
  async readThreadLogs(
    threadId: string,
    opts: { timeoutMs: number; window?: { fromMs: number | null; toMs: number | null } },
  ): Promise<"ok" | "skipped" | "missing"> {
    const settings = this.deps.settings();
    const { store } = this.deps;
    if (!settings.readLogs) return "skipped";
    const edge = store.getEdge(threadId);
    const harness = harnessOf(edge?.providerId ?? null);
    const state = store.getThread(threadId);
    if (edge === null || harness === null || state === null || state.cursor.sessionIds.length === 0) {
      return "skipped";
    }
    // Codex logs are read for backfill windows only.
    if (harness === "codex" && opts.window === undefined) return "skipped";
    let hostId = edge.hostId;
    if (hostId === null && edge.environmentId !== null) {
      hostId = await this.deps.hostIdForEnvironment(edge.environmentId).catch(() => null);
      if (hostId !== null) store.upsertEdge({ threadId, hostId }, this.deps.now());
    }
    if (hostId === null) return "skipped";
    const now = this.deps.now();
    const incremental = opts.window === undefined;
    const sinceMs = incremental
      ? state.logsReadThrough === null
        ? state.firstSeenAt === null
          ? null
          : state.firstSeenAt - 60_000
        : state.logsReadThrough - 10 * 60_000
      : opts.window!.fromMs;
    const untilMs = incremental ? null : opts.window!.toMs;
    try {
      let offset: number | null = 0;
      const entries: LogEntry[] = [];
      while (offset !== null) {
        const page = await this.deps.readLogs(
          hostId,
          {
            harness,
            sessionIds: state.cursor.sessionIds.slice(-64),
            sinceMs,
            untilMs,
            includeSubagents: harness === "claude-code",
            offset,
            limit: LOG_PAGE_MAX,
          },
          opts.timeoutMs,
        );
        entries.push(...page.entries);
        offset = page.nextOffset;
      }
      // Incremental reads keep only what the merge rule can use outside windows.
      const kept = incremental
        ? entries.filter((e) => e.agentId !== null || harness === "pi")
        : entries;
      store.upsertLogEntries(threadId, kept);
      // Only the row as it is now is updated. Writing back the one read before
      // the await could restore a cursor a ledger rebuild has just dropped,
      // and the thread would never be re-read (it would stay at 0).
      const fresh = store.getThread(threadId);
      if (fresh === null) return "skipped";
      store.putThread(
        {
          ...fresh,
          logsReadThrough: incremental ? now : fresh.logsReadThrough,
          logsMissingHost: null,
          logsMissingSince: null,
          ...(opts.window !== undefined && opts.window.fromMs === null ? { historyBackfilled: true } : {}),
          gaps:
            opts.window !== undefined && opts.window.fromMs !== null
              ? fresh.gaps.map((g) =>
                  g.fromMs >= (opts.window!.fromMs ?? 0) && g.toMs <= (opts.window!.toMs ?? Infinity)
                    ? { ...g, backfilled: true }
                    : g,
                )
              : fresh.gaps,
        },
        now,
      );
      this.changed([threadId]);
      return "ok";
    } catch (error) {
      const name = await this.deps.hostName(hostId).catch(() => hostId as string);
      const fresh = store.getThread(threadId);
      if (fresh === null) return "skipped";
      store.putThread(
        {
          ...fresh,
          logsMissingHost: name,
          logsMissingSince: fresh.logsMissingSince ?? now,
        },
        now,
      );
      this.deps.log.warn(
        `logs for ${threadId} on ${name} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.changed([threadId]);
      return "missing";
    }
  }

  /**
   * Opening the Usage tab: catches up the family's threads and reads the
   * logs of those whose logs are missing (a machine offline) or older than
   * their last activity; logs read since are not read again. A few threads at
   * a time, so a large family does not flood bb or the machine.
   */
  async refresh(threadIds: readonly string[]): Promise<void> {
    await eachLimit(threadIds, REFRESH_CONCURRENCY, (id) => this.catchUpQuietly(id));
    if (this.deps.settings().adapter === "litellm") await this.sweep();
    const stale = threadIds.filter((id) => {
      const state = this.deps.store.getThread(id);
      if (state === null) return false;
      return (
        state.logsMissingSince !== null ||
        state.logsReadThrough === null ||
        (state.lastActivityAt ?? 0) >= state.logsReadThrough
      );
    });
    await eachLimit(stale, REFRESH_CONCURRENCY, (id) =>
      this.readThreadLogs(id, { timeoutMs: PANEL_LOG_TIMEOUT_MS }).catch(() => "missing"),
    );
  }

  /**
   * After a load: threads stored as running when the plugin stopped may have
   * had a gathered catch-up dropped, or gone idle unseen. Catches them up, and
   * reads the logs of those no longer running, as their idle would have.
   */
  async resumeInterrupted(threadIds: readonly string[]): Promise<void> {
    await eachLimit(threadIds, REFRESH_CONCURRENCY, async (id) => {
      await this.catchUpQuietly(id);
      if (this.deps.store.getEdge(id)?.status !== "active") {
        await this.readThreadLogs(id, { timeoutMs: PANEL_LOG_TIMEOUT_MS * 6 }).catch(() => "missing");
      }
    });
  }

  /** Retries every thread marked logs-missing (every 15 minutes, and on tab open). */
  async retryMissingLogs(): Promise<void> {
    for (const state of this.deps.store.threadsWithMissingLogs()) {
      await this.readThreadLogs(state.threadId, { timeoutMs: PANEL_LOG_TIMEOUT_MS });
    }
  }

  // ---- backfill ----

  paused(): boolean {
    return this.deps.store.getMeta<boolean>("backfillPaused") === true;
  }

  setPaused(paused: boolean): void {
    this.deps.store.setMeta("backfillPaused", paused);
  }

  /**
   * Records every thread bb lists and queues catch-up for those never read.
   * Returns the ids bb listed: the threads that still exist.
   */
  async discover(): Promise<Set<string>> {
    const { store } = this.deps;
    const now = this.deps.now();
    let offset = 0;
    const dtos: ThreadDto[] = [];
    for (;;) {
      const page = await this.deps.listThreads(offset, 200);
      dtos.push(...page);
      if (page.length < 200) break;
      offset += page.length;
    }
    const listed = new Set(dtos.map((d) => d.id));
    // A known thread bb no longer lists was deleted while the plugin was
    // stopped. Stamp it first, so its children, which bb detached, are kept
    // under it when they are recorded below.
    const known = store.allEdges().filter((e) => e.deletedAt === null);
    const missing = known.filter((e) => !listed.has(e.threadId));
    // An empty or cut-short listing must not mark live threads deleted.
    if (missing.length > 0 && dtos.length > 0 && missing.length <= Math.max(20, known.length / 4)) {
      for (const edge of missing) store.upsertEdge({ threadId: edge.threadId, deletedAt: now }, now);
    } else if (missing.length > 0) {
      this.deps.log.warn(`discovery listed ${dtos.length} threads but ${missing.length} known ones are missing; not marking them deleted`);
    }
    for (const dto of dtos) {
      this.recordThread(dto);
      if (store.getThread(dto.id) === null) {
        store.enqueue(
          { threadId: dto.id, kind: "events", fromMs: null, toMs: null, priority: dto.createdAt ?? 0 },
          now,
        );
      }
    }
    return listed;
  }

  /**
   * Drops the ledgers of these threads so they are re-read under changed
   * rules. Each drop waits in the thread's queue, so it never interleaves
   * with a catch-up that read the old cursor and would write it back.
   */
  async rebuildLedgers(listed: ReadonlySet<string>): Promise<void> {
    const { store } = this.deps;
    const now = this.deps.now();
    await Promise.all(
      [...listed].map((id) => {
        // A catch-up called after this point must run after the drop, not join one queued before it.
        this.queued.delete(id);
        return this.serial(id, async () => {
          this.readThrough.delete(id);
          if (!store.resetThreadLedger(id)) return;
          const edge = store.getEdge(id);
          store.enqueue({ threadId: id, kind: "events", fromMs: null, toMs: null, priority: edge?.createdAt ?? 0 }, now);
        });
      }),
    );
    this.deps.model.invalidateAll();
  }

  /**
   * Checks every family against Warn above, so a family already over the
   * amount when it is set counts as crossed.
   */
  checkAllBudgets(): void {
    const settings = this.deps.settings();
    if (settings.warnAbove === null) return;
    const index = indexEdges(this.deps.store.allEdges());
    const totals = new Map<string, number>();
    for (const id of index.byId.keys()) {
      const { figure } = this.deps.model.familyFigure(id, index);
      totals.set(id, costTotal(figure.cost) - figure.byBilling.subscription.usd);
    }
    const crossings = newCrossings(totals, settings.warnAbove, this.deps.store.crossingKeys(), this.deps.now());
    for (const c of crossings) {
      // Found by a sweep over history, not by new spend: tint only, no toast.
      this.deps.store.addCrossing(crossingKey(c.rootThreadId, c.amount), c, { silent: true });
      this.deps.log.info(`family ${c.rootThreadId} is over ${c.amount}`);
    }
    if (crossings.length > 0) this.deps.publish(USAGE_CHANGED, { threadIds: [] });
  }

  /** Runs up to `limit` queued jobs, at most one per host at a time. */
  async runBackfill(limit = 2): Promise<number> {
    if (this.paused()) return 0;
    const { store } = this.deps;
    const jobs = store.nextJobs(limit * 4);
    const hostsBusy = new Set<string>();
    const picked = [];
    for (const job of jobs) {
      if (picked.length >= limit) break;
      const host = store.getEdge(job.threadId)?.hostId ?? "unknown";
      if (job.kind === "logs") {
        if (hostsBusy.has(host)) continue;
        hostsBusy.add(host);
      }
      picked.push(job);
    }
    await Promise.all(
      picked.map(async (job) => {
        store.setJobState(job.threadId, job.kind, "running", null, this.deps.now());
        try {
          if (job.kind === "events") {
            await this.catchUp(job.threadId);
            store.setJobState(job.threadId, job.kind, "done", null, this.deps.now());
          } else {
            const result = await this.readThreadLogs(job.threadId, {
              timeoutMs: BACKFILL_LOG_TIMEOUT_MS,
              window: { fromMs: job.fromMs, toMs: job.toMs },
            });
            store.setJobState(
              job.threadId,
              job.kind,
              result === "missing" ? "failed" : "done",
              result === "missing" ? "logs unavailable" : null,
              this.deps.now(),
            );
          }
        } catch (error) {
          store.setJobState(
            job.threadId,
            job.kind,
            "failed",
            error instanceof Error ? error.message : String(error),
            this.deps.now(),
          );
        }
      }),
    );
    return picked.length;
  }

  /** Called on thread deletion: stamp, try one last read, sweep. */
  async onDeleted(dto: ThreadDto): Promise<void> {
    const now = this.deps.now();
    this.deps.store.upsertEdge({ ...edgeFromDto(dto), deletedAt: dto.deletedAt ?? now }, now);
    try {
      await this.catchUp(dto.id);
    } catch {
      // Deleted threads' events may be unreadable; the idle catch-up already ran.
    }
    this.changed([dto.id]);
    if (this.deps.settings().adapter === "litellm") void this.sweep();
  }

  /** Any thread running? Drives the 60 s sweep cadence. */
  anyActive(): boolean {
    return this.deps.store.allEdges().some((e) => e.status === "active" && e.deletedAt === null);
  }
}
