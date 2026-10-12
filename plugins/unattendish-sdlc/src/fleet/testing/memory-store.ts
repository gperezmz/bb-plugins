// The Fleet store as plain objects, for the use-case tests. It behaves as the
// SQLite store does; `describeStore` runs the same suite over both.
import type { LedgerEntry, LedgerQuery, LedgerRow, PollCommit, PollRecord, Store, StoredFleet, StoredWake } from "../application/ports";
import { byTimeThenKey } from "../domain/changes";
import { repoId } from "../domain/identity";
import type { Change, ChangeKind, Disposition, NotWatched, Registration, SourceCursor, SourceRole } from "../domain/model";

const DEFAULT_LEDGER_LIMIT = 200;
const DONE_DISPOSITION = { woke: "wake", echo: "echo", "out-of-scope": "out-of-scope", held: "held" } as const;

interface FailedRead {
  readonly at: string;
  readonly role: SourceRole;
  readonly ref: string | null;
  readonly reason: string;
}

/** Everything one repository owns. Ledger data may exist before a registration does and outlives it, as in the SQLite store. */
interface RepoData {
  fleet: StoredFleet | null;
  cursors: Map<SourceRole, SourceCursor>;
  /** In insertion order, which is what ties on `seenAt` fall back to. */
  changes: Map<string, LedgerRow>;
  failedReads: FailedRead[];
  polls: PollRecord[];
}

const sameRef = (a: string | null, b: string): boolean => a !== null && a.toLowerCase() === b.toLowerCase();

const toChange = (row: LedgerRow): Change => ({
  key: row.key,
  role: row.role,
  ref: row.ref,
  url: row.url,
  kind: row.kind as ChangeKind,
  label: row.label,
  actor: row.actor,
  at: row.at,
  lastLine: null,
});

const entryTime = (entry: LedgerEntry): string => {
  switch (entry.type) {
    case "change":
      return entry.row.seenAt;
    case "wake":
      return entry.wake.queuedAt;
    case "poll":
      return entry.poll.at;
    case "failed read":
      return entry.at;
  }
};

export class InMemoryStore implements Store {
  private readonly records = new Map<string, RepoData>();
  /** Every repository's wakes, in creation order; the id is the position plus one. */
  private wakes: StoredWake[] = [];
  private lastWakeId = 0;

  private data(repo: string): RepoData {
    let data = this.records.get(repo);
    if (data === undefined) {
      data = { fleet: null, cursors: new Map(), changes: new Map(), failedReads: [], polls: [] };
      this.records.set(repo, data);
    }
    return data;
  }

  getFleet(repo: string): StoredFleet | null {
    const fleet = this.records.get(repo)?.fleet;
    return fleet == null ? null : structuredClone(fleet);
  }

  listFleets(): StoredFleet[] {
    return [...this.records.entries()]
      .filter(([, data]) => data.fleet !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, data]) => structuredClone(data.fleet!));
  }

  saveRegistration(registration: Registration, notWatched: readonly NotWatched[]): void {
    const data = this.data(repoId(registration.repo));
    data.fleet = {
      lastPolledAt: null,
      refused: null,
      unreadablePolls: 0,
      pendingCatchUpMs: null,
      unreadableRows: [],
      outsideLinks: [],
      expiries: {},
      heldSince: null,
      ...data.fleet,
      registration: structuredClone(registration),
      notWatched: structuredClone([...notWatched]),
    };
  }

  removeFleet(repo: string): boolean {
    const data = this.records.get(repo);
    const existed = data?.fleet != null;
    if (data !== undefined) {
      data.fleet = null;
      data.cursors.clear();
    }
    return existed;
  }

  setIntervalMs(repo: string, intervalMs: number | null): void {
    const data = this.records.get(repo);
    if (data?.fleet != null) data.fleet = { ...data.fleet, registration: { ...data.fleet.registration, intervalMs } };
  }

  savePollState(repo: string, state: Parameters<Store["savePollState"]>[1]): void {
    const data = this.records.get(repo);
    if (data?.fleet == null) return;
    const current = data.fleet.refused;
    const refused = state.refused ?? null;
    const announced = refused === null ? false : current !== null && current.since === refused.since && current.prefix === refused.prefix ? current.announced : refused.announced;
    data.fleet = {
      ...data.fleet,
      lastPolledAt: state.lastPolledAt,
      notWatched: structuredClone([...state.notWatched]),
      unreadableRows: structuredClone([...state.unreadableRows]),
      outsideLinks: structuredClone([...state.outsideLinks]),
      expiries: structuredClone(state.expiries),
      heldSince: state.heldSince,
      unreadablePolls: state.unreadablePolls,
      pendingCatchUpMs: state.pendingCatchUpMs,
      refused: refused === null ? null : { since: refused.since, prefix: refused.prefix, announced, why: refused.why },
    };
  }

  markRefusedAnnounced(repo: string): void {
    const fleet = this.records.get(repo)?.fleet;
    if (fleet?.refused != null) this.records.get(repo)!.fleet = { ...fleet, refused: { ...fleet.refused, announced: true } };
  }

  getCursor(repo: string, role: SourceRole): SourceCursor | null {
    const cursor = this.records.get(repo)?.cursors.get(role);
    return cursor === undefined ? null : structuredClone(cursor);
  }

  commit(commit: PollCommit): void {
    // Copying first means a cursor that cannot be copied leaves the others unwritten, as one transaction would.
    const copies = commit.cursors.map(({ role, cursor }) => [role, structuredClone(cursor)] as const);
    const data = this.data(commit.repo);
    for (const [role, cursor] of copies) data.cursors.set(role, cursor);
    if (data.fleet !== null) data.fleet = { ...data.fleet, lastPolledAt: commit.at };
  }

  dispositions(repo: string, keys: readonly string[]): Map<string, Disposition["kind"]> {
    const found = new Map<string, Disposition["kind"]>();
    const changes = this.records.get(repo)?.changes;
    for (const key of keys) {
      const row = changes?.get(key);
      if (row !== undefined) found.set(key, row.disposition);
    }
    return found;
  }

  recordChange(repo: string, row: Omit<LedgerRow, "wakeId">): void {
    const changes = this.data(repo).changes;
    const existing = changes.get(row.key);
    if (existing === undefined) changes.set(row.key, { ...structuredClone(row), wakeId: null });
    else if (existing.disposition === "held" && row.disposition !== "held") changes.set(row.key, { ...existing, disposition: row.disposition, rule: row.rule });
  }

  heldChanges(repo: string): Change[] {
    return [...(this.records.get(repo)?.changes.values() ?? [])].filter((row) => row.disposition === "held").sort(byTimeThenKey).map(toChange);
  }

  recordFailedRead(repo: string, entry: FailedRead): void {
    this.data(repo).failedReads.push({ at: entry.at, role: entry.role, ref: entry.ref, reason: entry.reason });
  }

  recordPoll(repo: string, poll: PollRecord): void {
    this.data(repo).polls.push(structuredClone(poll));
  }

  requestsSince(repo: string, since: string): number {
    return (this.records.get(repo)?.polls ?? []).filter((poll) => poll.at >= since).reduce((total, poll) => total + poll.counted, 0);
  }

  createWake(repo: string, wake: Parameters<Store["createWake"]>[1]): StoredWake {
    const stored: StoredWake = {
      id: ++this.lastWakeId,
      repo,
      kind: wake.kind,
      threadId: wake.threadId,
      queuedMessageId: wake.queuedMessageId,
      queuedAt: wake.queuedAt,
      dispatchedAt: wake.dispatchedAt ?? null,
      since: wake.since,
      catchUpMs: wake.catchUpMs,
      heldSince: wake.heldSince,
      notWatched: wake.notWatched === null ? null : { ...wake.notWatched },
    };
    this.wakes.push(stored);
    return { ...stored };
  }

  openWake(repo: string): StoredWake | null {
    const open = this.wakes.filter((wake) => wake.repo === repo && wake.queuedMessageId !== null && wake.dispatchedAt === null);
    const latest = open[open.length - 1];
    return latest === undefined ? null : { ...latest };
  }

  markWoke(repo: string, wakeId: number, keys: readonly string[]): void {
    const changes = this.records.get(repo)?.changes;
    for (const key of keys) {
      const row = changes?.get(key);
      if (row !== undefined) changes!.set(key, { ...row, disposition: "wake", rule: null, wakeId });
    }
  }

  wakeChanges(repo: string, wakeId: number): Change[] {
    return [...(this.records.get(repo)?.changes.values() ?? [])].filter((row) => row.wakeId === wakeId).sort(byTimeThenKey).map(toChange);
  }

  setWakeQueuedMessage(repo: string, wakeId: number, queuedMessageId: string | null): void {
    this.wakes = this.wakes.map((wake) => (wake.repo === repo && wake.id === wakeId ? { ...wake, queuedMessageId } : wake));
  }

  updateWake(repo: string, wakeId: number, update: Pick<StoredWake, "kind" | "catchUpMs" | "heldSince" | "notWatched">): void {
    const notWatched = update.notWatched === null ? null : { ...update.notWatched };
    this.wakes = this.wakes.map((wake) =>
      wake.repo === repo && wake.id === wakeId ? { ...wake, kind: update.kind, catchUpMs: update.catchUpMs, heldSince: update.heldSince, notWatched } : wake,
    );
  }

  markDispatched(queuedMessageId: string, at: string): void {
    this.wakes = this.wakes.map((wake) => (wake.queuedMessageId === queuedMessageId ? { ...wake, dispatchedAt: at } : wake));
  }

  ledger(repo: string, query: LedgerQuery): LedgerEntry[] {
    const record = this.data(repo);
    const limit = Math.max(0, query.limit ?? DEFAULT_LEDGER_LIMIT);
    const { item, done } = query;
    const entries: LedgerEntry[] = [];

    const newestFirst = <T>(items: T[]): T[] => [...items].reverse();
    const byTimeDesc = <T>(items: T[], time: (item: T) => string): T[] => newestFirst(items).sort((a, b) => (time(a) < time(b) ? 1 : time(a) > time(b) ? -1 : 0));

    if (done !== "failed read") {
      const rows = [...record.changes.values()].filter(
        (row) => (item === undefined || sameRef(row.ref, item) || row.url === item) && (done === undefined || row.disposition === DONE_DISPOSITION[done]),
      );
      for (const row of byTimeDesc(rows, (r) => r.seenAt).slice(0, limit)) entries.push({ type: "change", row: structuredClone(row) });
    }
    if (done === undefined || done === "failed read") {
      const reads = record.failedReads.filter((read) => item === undefined || sameRef(read.ref, item));
      for (const read of byTimeDesc(reads, (r) => r.at).slice(0, limit)) entries.push({ type: "failed read", ...structuredClone(read) });
    }
    if (item === undefined && done === undefined) {
      const wakes = this.wakes.filter((wake) => wake.repo === repo);
      for (const wake of byTimeDesc(wakes, (w) => w.queuedAt).slice(0, limit)) entries.push({ type: "wake", wake: { ...wake } });
      for (const poll of byTimeDesc(record.polls, (p) => p.at).slice(0, limit)) entries.push({ type: "poll", poll: structuredClone(poll) });
    }

    return entries.sort((a, b) => (entryTime(a) < entryTime(b) ? 1 : entryTime(a) > entryTime(b) ? -1 : 0)).slice(0, limit);
  }

  prune(before: string): void {
    this.wakes = this.wakes.filter((wake) => wake.queuedAt >= before);
    for (const record of this.records.values()) {
      for (const [key, row] of record.changes) if (row.seenAt < before) record.changes.delete(key);
      record.failedReads = record.failedReads.filter((read) => read.at >= before);
      record.polls = record.polls.filter((poll) => poll.at >= before);
    }
  }
}
