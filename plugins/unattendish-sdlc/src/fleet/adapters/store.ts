// The Fleet context's store on the plugin's SQLite database: registrations,
// cursors and the ledger. Rows hold what the types in the model hold and
// nothing the services wrote beyond them; no column of theirs can carry a token.
// The migrations also make the tables of `SqliteAccounts`, whose
// `account_credentials.token` is the one column that holds a token.
import type Database from "better-sqlite3";
import {
  keptAnnounced,
  type LedgerEntry,
  type LedgerQuery,
  type LedgerRow,
  type PollCommit,
  type PollRecord,
  type SourceOutage,
  type Store,
  type StoredFleet,
  type StoredWake,
  type WakeKind,
} from "../application/ports";
import type { ActionRecord } from "../domain/actions";
import type { Change, ChangeKind, Disposition, NotWatched, RefusedWhy, Registration, SourceCursor, SourceRole } from "../domain/model";
import { repoId, trackerSource } from "../domain/identity";

/** Entries a ledger query returns when it names no limit. */
const DEFAULT_LEDGER_LIMIT = 200;

/** Keys per `IN (...)` list, well under SQLite's bound-variable limit. */
const CHUNK = 500;

/**
 * One statement per element, for `bb.storage.migrate`, which runs each
 * statement once, by its index. Append-only: a shipped statement is never
 * edited or reordered.
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS fleets (
     repo_id TEXT PRIMARY KEY,
     registration TEXT NOT NULL,
     interval_ms INTEGER,
     last_polled_at TEXT,
     not_watched TEXT NOT NULL DEFAULT '[]',
     refused_since TEXT,
     refused_prefix TEXT,
     refused_announced INTEGER NOT NULL DEFAULT 0,
     unreadable_rows TEXT NOT NULL DEFAULT '[]',
     outside_links TEXT NOT NULL DEFAULT '[]',
     expiries TEXT NOT NULL DEFAULT '{}',
     held_since TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS cursors (
     repo_id TEXT NOT NULL,
     role TEXT NOT NULL,
     cursor TEXT NOT NULL,
     PRIMARY KEY (repo_id, role)
   )`,
  `CREATE TABLE IF NOT EXISTS changes (
     repo_id TEXT NOT NULL,
     change_key TEXT NOT NULL,
     role TEXT NOT NULL,
     ref TEXT NOT NULL COLLATE NOCASE,
     url TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT,
     actor TEXT,
     at TEXT NOT NULL,
     seen_at TEXT NOT NULL,
     disposition TEXT NOT NULL,
     rule TEXT,
     wake_id INTEGER,
     PRIMARY KEY (repo_id, change_key)
   )`,
  `CREATE INDEX IF NOT EXISTS changes_seen ON changes (repo_id, seen_at)`,
  `CREATE INDEX IF NOT EXISTS changes_disposition ON changes (repo_id, disposition, at)`,
  `CREATE INDEX IF NOT EXISTS changes_wake ON changes (repo_id, wake_id)`,
  `CREATE INDEX IF NOT EXISTS changes_ref ON changes (repo_id, ref)`,
  `CREATE INDEX IF NOT EXISTS changes_url ON changes (repo_id, url)`,
  `CREATE INDEX IF NOT EXISTS changes_pruning ON changes (seen_at)`,
  `CREATE TABLE IF NOT EXISTS failed_reads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     repo_id TEXT NOT NULL,
     at TEXT NOT NULL,
     role TEXT NOT NULL,
     ref TEXT COLLATE NOCASE,
     reason TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS failed_reads_repo ON failed_reads (repo_id, at)`,
  `CREATE INDEX IF NOT EXISTS failed_reads_ref ON failed_reads (repo_id, ref)`,
  `CREATE INDEX IF NOT EXISTS failed_reads_pruning ON failed_reads (at)`,
  `CREATE TABLE IF NOT EXISTS polls (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     repo_id TEXT NOT NULL,
     at TEXT NOT NULL,
     role TEXT NOT NULL,
     requests TEXT NOT NULL,
     counted INTEGER NOT NULL,
     ok INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS polls_repo ON polls (repo_id, at)`,
  `CREATE INDEX IF NOT EXISTS polls_pruning ON polls (at)`,
  `CREATE TABLE IF NOT EXISTS wakes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     repo_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     thread_id TEXT NOT NULL,
     queued_message_id TEXT,
     queued_at TEXT NOT NULL,
     dispatched_at TEXT,
     since TEXT NOT NULL,
     catch_up_ms INTEGER,
     held_since TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS wakes_repo ON wakes (repo_id, kind, id)`,
  `CREATE INDEX IF NOT EXISTS wakes_queued_message ON wakes (queued_message_id)`,
  `CREATE INDEX IF NOT EXISTS wakes_pruning ON wakes (queued_at)`,
  `ALTER TABLE wakes ADD COLUMN not_watched_since TEXT`,
  `ALTER TABLE wakes ADD COLUMN not_watched_prefix TEXT`,
  `ALTER TABLE fleets ADD COLUMN refused_why TEXT`,
  `ALTER TABLE fleets ADD COLUMN unreadable_polls INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE wakes ADD COLUMN not_watched_why TEXT`,
  `ALTER TABLE fleets ADD COLUMN pending_catch_up_ms INTEGER`,
  `ALTER TABLE fleets ADD COLUMN unreadable_since TEXT`,
  `ALTER TABLE fleets ADD COLUMN outages TEXT`,
  `CREATE TABLE IF NOT EXISTS actions (
     repo_id TEXT NOT NULL,
     id TEXT NOT NULL,
     row_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     ref TEXT NOT NULL,
     what TEXT NOT NULL,
     manager_thread_id TEXT NOT NULL,
     state TEXT NOT NULL,
     sent_at TEXT NOT NULL,
     done_at TEXT,
     PRIMARY KEY (repo_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS inbox_seen (
     repo_id TEXT NOT NULL,
     row_id TEXT NOT NULL,
     seen_at TEXT NOT NULL,
     PRIMARY KEY (repo_id, row_id)
   )`,
  `CREATE INDEX IF NOT EXISTS inbox_seen_pruning ON inbox_seen (seen_at)`,
  `ALTER TABLE fleets ADD COLUMN inbox_baselined INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY,
     service TEXT NOT NULL,
     place TEXT NOT NULL,
     login TEXT NOT NULL,
     name TEXT NOT NULL,
     via TEXT NOT NULL,
     api_url TEXT,
     added_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS account_credentials (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     owner TEXT,
     token TEXT,
     expires_at TEXT,
     added_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS assignments (
     scope_key TEXT PRIMARY KEY,
     scope TEXT NOT NULL,
     account_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS access_problems (
     repo_id TEXT NOT NULL,
     role TEXT NOT NULL,
     credential_id TEXT NOT NULL,
     why TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (repo_id, role)
   )`,
  `ALTER TABLE changes ADD COLUMN window_from TEXT`,
  `ALTER TABLE changes ADD COLUMN window_to TEXT`,
];

interface FleetRow {
  registration: string;
  interval_ms: number | null;
  last_polled_at: string | null;
  not_watched: string;
  /** The `refused_*` and `unreadable_*` columns are read only where `outages` is null; nothing writes them. */
  refused_since: string | null;
  refused_prefix: string | null;
  refused_announced: number;
  /** Null on a row written before the column existed, when only a 401 counted as refused. */
  refused_why: RefusedWhy | null;
  unreadable_polls: number;
  /** Null on a row written before the column existed, though `unreadable_polls` counts polls. */
  unreadable_since: string | null;
  /**
   * Each source's outage as JSON, by role. Null on a row written before the column existed, whose outage the
   * `refused_*` and `unreadable_*` columns hold for the fleet as a whole.
   */
  outages: string | null;
  pending_catch_up_ms: number | null;
  unreadable_rows: string;
  outside_links: string;
  expiries: string;
  held_since: string | null;
}

interface ChangeRow {
  change_key: string;
  role: SourceRole;
  /** Empty on the entry a skipped listing writes: the column is NOT NULL and a table cannot lose that. */
  ref: string;
  url: string;
  kind: ChangeKind | "updated" | "skipped listing";
  label: string | null;
  actor: string | null;
  at: string;
  seen_at: string;
  disposition: Disposition["kind"];
  rule: string | null;
  window_from: string | null;
  window_to: string | null;
  wake_id: number | null;
}

interface FailedReadRow {
  at: string;
  role: SourceRole;
  ref: string | null;
  reason: string;
}

interface PollRow {
  at: string;
  role: SourceRole;
  requests: string;
  counted: number;
  ok: number;
}

interface ActionRow {
  id: string;
  repo_id: string;
  row_id: string;
  kind: ActionRecord["kind"];
  ref: string;
  what: string;
  manager_thread_id: string;
  state: ActionRecord["state"];
  sent_at: string;
  done_at: string | null;
}

interface WakeRow {
  id: number;
  repo_id: string;
  kind: WakeKind;
  thread_id: string;
  queued_message_id: string | null;
  queued_at: string;
  dispatched_at: string | null;
  since: string;
  catch_up_ms: number | null;
  held_since: string | null;
  not_watched_since: string | null;
  not_watched_prefix: string | null;
  /** Null on a row written before the column existed, when only a 401 counted as refused. */
  not_watched_why: RefusedWhy | null;
}

const DONE_DISPOSITION = { woke: "wake", echo: "echo", "out-of-scope": "out-of-scope", held: "held" } as const;

const toFleet = (row: FleetRow): StoredFleet => ({
  registration: { ...(JSON.parse(row.registration) as Registration), intervalMs: row.interval_ms },
  lastPolledAt: row.last_polled_at,
  notWatched: JSON.parse(row.not_watched) as NotWatched[],
  outages: row.outages === null ? legacyOutages(row) : outagesOf(row.outages),
  pendingCatchUpMs: row.pending_catch_up_ms,
  unreadableRows: JSON.parse(row.unreadable_rows) as StoredFleet["unreadableRows"],
  outsideLinks: JSON.parse(row.outside_links) as StoredFleet["outsideLinks"],
  heldSince: row.held_since,
});

/** The `outages` column, where a refusal written before it named its credential's label under `prefix` reads as `credential`. */
const outagesOf = (text: string): StoredFleet["outages"] => {
  const stored = JSON.parse(text) as Record<string, (SourceOutage & { readonly refused: { readonly prefix?: string } | null }) | undefined>;
  const outages: Partial<Record<"forge" | "tracker", SourceOutage>> = {};
  for (const role of ["forge", "tracker"] as const) {
    const outage = stored[role];
    if (outage === undefined) continue;
    const refused = outage.refused === null ? null : { ...outage.refused, credential: outage.refused.credential ?? outage.refused.prefix ?? "" };
    if (refused !== null) delete (refused as { prefix?: string }).prefix;
    outages[role] = { ...outage, refused };
  }
  return outages;
};

/**
 * The outage of a row written while it was kept for the fleet as a whole, which does not say which source it was of:
 * it is taken as every source's, so the source that reads next ends its own copy and the one still down keeps its
 * streak, its time and whether a wake said so.
 */
const legacyOutages = (row: FleetRow): StoredFleet["outages"] => {
  const refused =
    row.refused_since === null || row.refused_prefix === null
      ? null
      : { since: row.refused_since, credential: row.refused_prefix, announced: row.refused_announced === 1, why: row.refused_why ?? "refused" };
  if (refused === null && row.unreadable_polls === 0) return {};
  const outage: SourceOutage = { unreadablePolls: row.unreadable_polls, unreadableSince: row.unreadable_since, refused };
  const registration = JSON.parse(row.registration) as Registration;
  return trackerSource(registration.tracker) === null ? { forge: outage } : { forge: outage, tracker: { ...outage } };
};

const toLedgerRow = (row: ChangeRow): LedgerRow => ({
  key: row.change_key,
  role: row.role,
  ref: row.ref === "" ? null : row.ref,
  url: row.url === "" ? null : row.url,
  kind: row.kind,
  label: row.label,
  actor: row.actor,
  at: row.at,
  seenAt: row.seen_at,
  disposition: row.disposition,
  rule: row.rule,
  ...(row.window_from === null || row.window_to === null ? {} : { window: { from: row.window_from, to: row.window_to } }),
  wakeId: row.wake_id,
});

/** A stored row as a `Change`. A row's kind is a `ChangeKind` for every disposition that can be held or woken; `lastLine` is never stored. */
const toChange = (row: ChangeRow): Change => ({
  key: row.change_key,
  role: row.role,
  ref: row.ref,
  url: row.url,
  kind: row.kind as ChangeKind,
  label: row.label,
  actor: row.actor,
  at: row.at,
  lastLine: null,
});

const toWake = (row: WakeRow): StoredWake => ({
  id: row.id,
  repo: row.repo_id,
  kind: row.kind,
  threadId: row.thread_id,
  queuedMessageId: row.queued_message_id,
  queuedAt: row.queued_at,
  dispatchedAt: row.dispatched_at,
  since: row.since,
  catchUpMs: row.catch_up_ms,
  heldSince: row.held_since,
  notWatched:
    row.not_watched_since === null || row.not_watched_prefix === null
      ? null
      : { since: row.not_watched_since, credential: row.not_watched_prefix, why: row.not_watched_why ?? "refused" },
});

const toAction = (row: ActionRow): ActionRecord => ({
  id: row.id,
  repo: row.repo_id,
  rowId: row.row_id,
  kind: row.kind,
  ref: row.ref,
  what: row.what,
  managerThreadId: row.manager_thread_id,
  state: row.state,
  sentAt: row.sent_at,
  doneAt: row.done_at,
});

const toPoll = (row: PollRow): PollRecord => ({
  at: row.at,
  role: row.role,
  requests: JSON.parse(row.requests) as PollRecord["requests"],
  counted: row.counted,
  ok: row.ok === 1,
});

/** The ledger's entries sort by the time each one happened or was seen, newest first. */
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

/** The Fleet store on the plugin's SQLite database, which the host has already migrated with `MIGRATIONS`. */
export class SqliteStore implements Store {
  constructor(private readonly db: Database.Database) {}

  getFleet(repo: string): StoredFleet | null {
    const row = this.db.prepare("SELECT * FROM fleets WHERE repo_id = ?").get(repo) as FleetRow | undefined;
    return row === undefined ? null : toFleet(row);
  }

  listFleets(): StoredFleet[] {
    return (this.db.prepare("SELECT * FROM fleets ORDER BY repo_id").all() as FleetRow[]).map(toFleet);
  }

  saveRegistration(registration: Registration, notWatched: readonly NotWatched[]): void {
    this.db
      .prepare(
        `INSERT INTO fleets (repo_id, registration, interval_ms, not_watched) VALUES (?, ?, ?, ?)
         ON CONFLICT (repo_id) DO UPDATE SET registration = excluded.registration, interval_ms = excluded.interval_ms, not_watched = excluded.not_watched`,
      )
      .run(repoId(registration.repo), JSON.stringify(registration), registration.intervalMs, JSON.stringify(notWatched));
  }

  removeFleet(repo: string): boolean {
    return this.db.transaction(() => {
      // The ledger stays: retention ages it out, and a registration that follows still sees what it holds.
      this.db.prepare("DELETE FROM cursors WHERE repo_id = ?").run(repo);
      this.db.prepare("DELETE FROM actions WHERE repo_id = ?").run(repo);
      // What a credential was found unable to read belongs to the registration: one made again reads afresh.
      this.db.prepare("DELETE FROM access_problems WHERE repo_id = ?").run(repo);
      return this.db.prepare("DELETE FROM fleets WHERE repo_id = ?").run(repo).changes > 0;
    })();
  }

  setIntervalMs(repo: string, intervalMs: number | null): void {
    this.db.prepare("UPDATE fleets SET interval_ms = ? WHERE repo_id = ?").run(intervalMs, repo);
  }

  savePollState(repo: string, state: Parameters<Store["savePollState"]>[1]): void {
    this.db.transaction(() => {
      const outages = keptAnnounced(this.getFleet(repo)?.outages ?? {}, state.outages);
      this.db
        .prepare(
          `UPDATE fleets SET last_polled_at = ?, not_watched = ?, unreadable_rows = ?, outside_links = ?, held_since = ?, outages = ?, pending_catch_up_ms = ?
           WHERE repo_id = ?`,
        )
        .run(
          state.lastPolledAt,
          JSON.stringify(state.notWatched),
          JSON.stringify(state.unreadableRows),
          JSON.stringify(state.outsideLinks),
          state.heldSince,
          JSON.stringify(outages),
          state.pendingCatchUpMs,
          repo,
        );
    })();
  }

  markRefusedAnnounced(repo: string, role: SourceRole): void {
    this.db.transaction(() => {
      const fleet = this.getFleet(repo);
      const outage = fleet?.outages[role];
      if (fleet === null || outage?.refused == null) return;
      const outages = { ...fleet.outages, [role]: { ...outage, refused: { ...outage.refused, announced: true } } };
      this.db.prepare("UPDATE fleets SET outages = ? WHERE repo_id = ?").run(JSON.stringify(outages), repo);
    })();
  }

  getCursor(repo: string, role: SourceRole): SourceCursor | null {
    const row = this.db.prepare("SELECT cursor FROM cursors WHERE repo_id = ? AND role = ?").get(repo, role) as { cursor: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.cursor) as SourceCursor);
  }

  commit(commit: PollCommit): void {
    this.db.transaction(() => {
      const write = this.db.prepare(
        "INSERT INTO cursors (repo_id, role, cursor) VALUES (?, ?, ?) ON CONFLICT (repo_id, role) DO UPDATE SET cursor = excluded.cursor",
      );
      for (const { role, cursor } of commit.cursors) write.run(commit.repo, role, JSON.stringify(cursor));
      this.db.prepare("UPDATE fleets SET last_polled_at = ? WHERE repo_id = ?").run(commit.at, commit.repo);
    })();
  }

  dispositions(repo: string, keys: readonly string[]): Map<string, Disposition["kind"]> {
    const found = new Map<string, Disposition["kind"]>();
    for (let from = 0; from < keys.length; from += CHUNK) {
      const chunk = keys.slice(from, from + CHUNK);
      const rows = this.db
        .prepare(`SELECT change_key, disposition FROM changes WHERE repo_id = ? AND change_key IN (${chunk.map(() => "?").join(", ")})`)
        .all(repo, ...chunk) as { change_key: string; disposition: Disposition["kind"] }[];
      for (const row of rows) found.set(row.change_key, row.disposition);
    }
    return found;
  }

  recordChange(repo: string, row: Omit<LedgerRow, "wakeId">): void {
    // A row stays as first recorded, except that a held one takes the disposition it is recorded with next.
    this.db
      .prepare(
        `INSERT INTO changes (repo_id, change_key, role, ref, url, kind, label, actor, at, seen_at, disposition, rule, window_from, window_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repo_id, change_key) DO UPDATE SET disposition = excluded.disposition, rule = excluded.rule
         WHERE changes.disposition = 'held' AND excluded.disposition <> 'held'`,
      )
      .run(repo, row.key, row.role, row.ref ?? "", row.url ?? "", row.kind, row.label, row.actor, row.at, row.seenAt, row.disposition, row.rule, row.window?.from ?? null, row.window?.to ?? null);
  }

  heldChanges(repo: string): Change[] {
    const rows = this.db.prepare("SELECT * FROM changes WHERE repo_id = ? AND disposition = 'held' ORDER BY at, change_key").all(repo) as ChangeRow[];
    return rows.map(toChange);
  }

  recordFailedRead(repo: string, entry: { readonly at: string; readonly role: SourceRole; readonly ref: string | null; readonly reason: string }): void {
    this.db.prepare("INSERT INTO failed_reads (repo_id, at, role, ref, reason) VALUES (?, ?, ?, ?, ?)").run(repo, entry.at, entry.role, entry.ref, entry.reason);
  }

  recordPoll(repo: string, poll: PollRecord): void {
    this.db
      .prepare("INSERT INTO polls (repo_id, at, role, requests, counted, ok) VALUES (?, ?, ?, ?, ?, ?)")
      .run(repo, poll.at, poll.role, JSON.stringify(poll.requests), poll.counted, poll.ok ? 1 : 0);
  }

  requestsSince(repo: string, since: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(counted), 0) AS total FROM polls WHERE repo_id = ? AND at >= ?").get(repo, since) as { total: number };
    return row.total;
  }

  failedReadsSince(repo: string, since: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM failed_reads WHERE repo_id = ? AND at >= ?").get(repo, since) as { total: number };
    return row.total;
  }

  createWake(repo: string, wake: Parameters<Store["createWake"]>[1]): StoredWake {
    const dispatchedAt = wake.dispatchedAt ?? null;
    const result = this.db
      .prepare(
        `INSERT INTO wakes (repo_id, kind, thread_id, queued_message_id, queued_at, dispatched_at, since, catch_up_ms, held_since, not_watched_since, not_watched_prefix, not_watched_why)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        repo,
        wake.kind,
        wake.threadId,
        wake.queuedMessageId,
        wake.queuedAt,
        dispatchedAt,
        wake.since,
        wake.catchUpMs,
        wake.heldSince,
        wake.notWatched?.since ?? null,
        wake.notWatched?.credential ?? null,
        wake.notWatched?.why ?? null,
      );
    return {
      id: Number(result.lastInsertRowid),
      repo,
      kind: wake.kind,
      threadId: wake.threadId,
      queuedMessageId: wake.queuedMessageId,
      queuedAt: wake.queuedAt,
      dispatchedAt,
      since: wake.since,
      catchUpMs: wake.catchUpMs,
      heldSince: wake.heldSince,
      notWatched: wake.notWatched === null ? null : { ...wake.notWatched },
    };
  }

  openWake(repo: string): StoredWake | null {
    const row = this.db
      .prepare("SELECT * FROM wakes WHERE repo_id = ? AND queued_message_id IS NOT NULL AND dispatched_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(repo) as WakeRow | undefined;
    return row === undefined ? null : toWake(row);
  }

  markWoke(repo: string, wakeId: number, keys: readonly string[]): void {
    this.db.transaction(() => {
      for (let from = 0; from < keys.length; from += CHUNK) {
        const chunk = keys.slice(from, from + CHUNK);
        this.db
          .prepare(`UPDATE changes SET disposition = 'wake', rule = NULL, wake_id = ? WHERE repo_id = ? AND change_key IN (${chunk.map(() => "?").join(", ")})`)
          .run(wakeId, repo, ...chunk);
      }
    })();
  }

  wakeChanges(repo: string, wakeId: number): Change[] {
    const rows = this.db.prepare("SELECT * FROM changes WHERE repo_id = ? AND wake_id = ? ORDER BY at, change_key").all(repo, wakeId) as ChangeRow[];
    return rows.map(toChange);
  }

  setWakeQueuedMessage(repo: string, wakeId: number, queuedMessageId: string | null): void {
    this.db.prepare("UPDATE wakes SET queued_message_id = ? WHERE repo_id = ? AND id = ?").run(queuedMessageId, repo, wakeId);
  }

  updateWake(repo: string, wakeId: number, update: Pick<StoredWake, "kind" | "catchUpMs" | "heldSince" | "notWatched">): void {
    this.db
      .prepare("UPDATE wakes SET kind = ?, catch_up_ms = ?, held_since = ?, not_watched_since = ?, not_watched_prefix = ?, not_watched_why = ? WHERE repo_id = ? AND id = ?")
      .run(update.kind, update.catchUpMs, update.heldSince, update.notWatched?.since ?? null, update.notWatched?.credential ?? null, update.notWatched?.why ?? null, repo, wakeId);
  }

  markDispatched(queuedMessageId: string, at: string): void {
    this.db.prepare("UPDATE wakes SET dispatched_at = ? WHERE queued_message_id = ?").run(at, queuedMessageId);
  }

  ledger(repo: string, query: LedgerQuery): LedgerEntry[] {
    const limit = Math.max(0, query.limit ?? DEFAULT_LEDGER_LIMIT);
    const entries: LedgerEntry[] = [];

    if (query.done !== "failed read") {
      const where = ["repo_id = ?"];
      const params: (string | number)[] = [repo];
      if (query.item !== undefined) {
        where.push("(ref = ? OR url = ?)");
        params.push(query.item, query.item);
      }
      if (query.done !== undefined) {
        where.push("disposition = ?");
        params.push(DONE_DISPOSITION[query.done]);
      }
      if (query.skippedListing !== undefined) where.push(query.skippedListing ? "kind = 'skipped listing'" : "kind <> 'skipped listing'");
      const rows = this.db.prepare(`SELECT * FROM changes WHERE ${where.join(" AND ")} ORDER BY seen_at DESC, rowid DESC LIMIT ?`).all(...params, limit) as ChangeRow[];
      for (const row of rows) entries.push({ type: "change", row: toLedgerRow(row) });
    }

    if (query.done === undefined || query.done === "failed read") {
      const where = ["repo_id = ?"];
      const params: (string | number)[] = [repo];
      if (query.item !== undefined) {
        where.push("ref = ?");
        params.push(query.item);
      }
      const rows = this.db.prepare(`SELECT * FROM failed_reads WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT ?`).all(...params, limit) as FailedReadRow[];
      for (const row of rows) entries.push({ type: "failed read", at: row.at, role: row.role, ref: row.ref, reason: row.reason });
    }

    if (query.item === undefined && query.done === undefined) {
      const wakes = this.db.prepare("SELECT * FROM wakes WHERE repo_id = ? ORDER BY queued_at DESC, id DESC LIMIT ?").all(repo, limit) as WakeRow[];
      for (const row of wakes) entries.push({ type: "wake", wake: toWake(row) });
      const polls = this.db.prepare("SELECT * FROM polls WHERE repo_id = ? ORDER BY at DESC, id DESC LIMIT ?").all(repo, limit) as PollRow[];
      for (const row of polls) entries.push({ type: "poll", poll: toPoll(row) });
    }

    // The sort is stable, so entries of one time keep the order they were gathered in: changes, failed reads, wakes, polls, each newest first.
    return entries.sort((a, b) => (entryTime(a) < entryTime(b) ? 1 : entryTime(a) > entryTime(b) ? -1 : 0)).slice(0, limit);
  }

  recentWakes(repo: string, limit: number): StoredWake[] {
    return (this.db.prepare("SELECT * FROM wakes WHERE repo_id = ? ORDER BY queued_at DESC, id DESC LIMIT ?").all(repo, Math.max(0, limit)) as WakeRow[]).map(toWake);
  }

  saveAction(action: ActionRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO actions (repo_id, id, row_id, kind, ref, what, manager_thread_id, state, sent_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(action.repo, action.id, action.rowId, action.kind, action.ref, action.what, action.managerThreadId, action.state, action.sentAt, action.doneAt);
  }

  actions(repo: string): ActionRecord[] {
    return (this.db.prepare("SELECT * FROM actions WHERE repo_id = ? ORDER BY sent_at, id").all(repo) as ActionRow[]).map(toAction);
  }

  markActionsDone(repo: string, ids: readonly string[], at: string): void {
    this.db.transaction(() => {
      const mark = this.db.prepare("UPDATE actions SET state = 'done', done_at = ? WHERE repo_id = ? AND id = ? AND state = 'sent'");
      for (const id of ids) mark.run(at, repo, id);
    })();
  }

  dropSentActions(repo: string): void {
    this.db.prepare("DELETE FROM actions WHERE repo_id = ? AND state = 'sent'").run(repo);
  }

  pruneActions(doneBefore: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM actions WHERE state = 'done' AND done_at < ?").run(doneBefore);
      this.db.prepare("DELETE FROM actions WHERE repo_id NOT IN (SELECT repo_id FROM fleets)").run();
    })();
  }

  inboxSeen(repo: string): Set<string> {
    return new Set((this.db.prepare("SELECT row_id FROM inbox_seen WHERE repo_id = ?").all(repo) as { row_id: string }[]).map((row) => row.row_id));
  }

  touchInboxSeen(repo: string, ids: readonly string[], at: string): void {
    this.db.transaction(() => {
      const touch = this.db.prepare("INSERT INTO inbox_seen (repo_id, row_id, seen_at) VALUES (?, ?, ?) ON CONFLICT (repo_id, row_id) DO UPDATE SET seen_at = excluded.seen_at");
      for (const id of ids) touch.run(repo, id, at);
    })();
  }

  inboxBaselined(repo: string): boolean {
    const row = this.db.prepare("SELECT inbox_baselined FROM fleets WHERE repo_id = ?").get(repo) as { inbox_baselined: number } | undefined;
    return row?.inbox_baselined === 1;
  }

  setInboxBaselined(repo: string): void {
    this.db.prepare("UPDATE fleets SET inbox_baselined = 1 WHERE repo_id = ?").run(repo);
  }

  prune(before: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM inbox_seen WHERE seen_at < ?").run(before);
      this.db.prepare("DELETE FROM changes WHERE seen_at < ?").run(before);
      this.db.prepare("DELETE FROM failed_reads WHERE at < ?").run(before);
      this.db.prepare("DELETE FROM polls WHERE at < ?").run(before);
      this.db.prepare("DELETE FROM wakes WHERE queued_at < ?").run(before);
    })();
  }
}
