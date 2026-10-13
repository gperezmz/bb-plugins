// The Fleet store as plain objects, for the use-case tests. It behaves as the
// SQLite store does; `describeStore` runs the same suite over both.
import type { ActionRecord } from "../domain/actions";
import { keptAnnounced, type LedgerEntry, type LedgerQuery, type LedgerRow, type PollCommit, type PollRecord, type Store, type StoredFleet, type StoredWake } from "../application/ports";
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
  actions: ActionRecord[];
  /** Inbox row id to the time it was last seen. */
  inboxSeen: Map<string, string>;
  inboxBaselined: boolean;
}

const sameRef = (a: string | null, b: string): boolean => a !== null && a.toLowerCase() === b.toLowerCase();

const toChange = (row: LedgerRow): Change => ({
  key: row.key,
  role: row.role,
  ref: row.ref ?? "",
  url: row.url ?? "",
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
      data = { fleet: null, cursors: new Map(), changes: new Map(), failedReads: [], polls: [], actions: [], inboxSeen: new Map(), inboxBaselined: false };
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
      outages: {},
      pendingCatchUpMs: null,
      unreadableRows: [],
      outsideLinks: [],
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
      data.actions = [];
      data.inboxBaselined = false;
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
    data.fleet = {
      ...data.fleet,
      lastPolledAt: state.lastPolledAt,
      notWatched: structuredClone([...state.notWatched]),
      unreadableRows: structuredClone([...state.unreadableRows]),
      outsideLinks: structuredClone([...state.outsideLinks]),
      heldSince: state.heldSince,
      outages: keptAnnounced(data.fleet.outages, state.outages),
      pendingCatchUpMs: state.pendingCatchUpMs,
    };
  }

  markRefusedAnnounced(repo: string, role: SourceRole): void {
    const fleet = this.records.get(repo)?.fleet;
    const outage = fleet?.outages[role];
    if (fleet != null && outage?.refused != null) {
      this.records.get(repo)!.fleet = { ...fleet, outages: { ...fleet.outages, [role]: { ...outage, refused: { ...outage.refused, announced: true } } } };
    }
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
    const { item, done, skippedListing } = query;
    const entries: LedgerEntry[] = [];

    const newestFirst = <T>(items: T[]): T[] => [...items].reverse();
    const byTimeDesc = <T>(items: T[], time: (item: T) => string): T[] => newestFirst(items).sort((a, b) => (time(a) < time(b) ? 1 : time(a) > time(b) ? -1 : 0));

    if (done !== "failed read") {
      const rows = [...record.changes.values()].filter(
        (row) => (item === undefined || sameRef(row.ref, item) || row.url === item) && (done === undefined || row.disposition === DONE_DISPOSITION[done]) && (skippedListing === undefined || (row.kind === "skipped listing") === skippedListing),
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

  recentWakes(repo: string, limit: number): StoredWake[] {
    return this.wakes
      .filter((wake) => wake.repo === repo)
      .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : a.queuedAt > b.queuedAt ? -1 : b.id - a.id))
      .slice(0, Math.max(0, limit))
      .map((wake) => ({ ...wake }));
  }

  saveAction(action: ActionRecord): void {
    const actions = this.data(action.repo).actions;
    const at = actions.findIndex((known) => known.id === action.id);
    if (at === -1) actions.push({ ...action });
    else actions[at] = { ...action };
  }

  actions(repo: string): ActionRecord[] {
    return [...(this.records.get(repo)?.actions ?? [])].sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((action) => ({ ...action }));
  }

  markActionsDone(repo: string, ids: readonly string[], at: string): void {
    const data = this.records.get(repo);
    if (data === undefined) return;
    data.actions = data.actions.map((action) => (ids.includes(action.id) && action.state === "sent" ? { ...action, state: "done", doneAt: at } : action));
  }

  dropSentActions(repo: string): void {
    const data = this.records.get(repo);
    if (data !== undefined) data.actions = data.actions.filter((action) => action.state !== "sent");
  }

  pruneActions(doneBefore: string): void {
    for (const data of this.records.values()) {
      data.actions = data.fleet === null ? [] : data.actions.filter((action) => action.state === "sent" || (action.doneAt ?? "") >= doneBefore);
    }
  }

  inboxSeen(repo: string): Set<string> {
    return new Set(this.records.get(repo)?.inboxSeen.keys() ?? []);
  }

  touchInboxSeen(repo: string, ids: readonly string[], at: string): void {
    const seen = this.data(repo).inboxSeen;
    for (const id of ids) seen.set(id, at);
  }

  inboxBaselined(repo: string): boolean {
    return this.records.get(repo)?.inboxBaselined === true;
  }

  setInboxBaselined(repo: string): void {
    const data = this.records.get(repo);
    if (data?.fleet != null) data.inboxBaselined = true;
  }

  prune(before: string): void {
    for (const record of this.records.values()) for (const [id, at] of record.inboxSeen) if (at < before) record.inboxSeen.delete(id);
    this.wakes = this.wakes.filter((wake) => wake.queuedAt >= before);
    for (const record of this.records.values()) {
      for (const [key, row] of record.changes) if (row.seenAt < before) record.changes.delete(key);
      record.failedReads = record.failedReads.filter((read) => read.at >= before);
      record.polls = record.polls.filter((poll) => poll.at >= before);
    }
  }
}
