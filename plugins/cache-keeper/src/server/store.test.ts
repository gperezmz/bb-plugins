import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { newIdleStretch } from "../core/keeper";
import { parseSettings } from "./settings";
import { emptyRecord, ensureIncrementalVacuum, MIGRATIONS, Store, type ThreadRecord } from "./store";

const fixture = (name: string, dir = "0.1.0") => JSON.parse(readFileSync(new URL(`../../test/fixtures/${dir}/${name}`, import.meta.url), "utf8")) as unknown;

function open(path = ":memory:") {
  const db = new Database(path);
  ensureIncrementalVacuum(db);
  for (const m of MIGRATIONS) db.exec(m);
  return { db, store: new Store(db) };
}

/** The bytes a row takes: its text and integer columns as SQLite stores them. */
const rowBytes = (row: Record<string, unknown>) =>
  Object.values(row).reduce<number>((sum, v) => sum + (typeof v === "string" ? Buffer.byteLength(v) : typeof v === "number" ? 8 : 0), 0);

describe("the stored 0.1.0 shape", () => {
  it("loads a threads row, a turn_logs row and the settings of 0.1.0 with every field", () => {
    const { db, store } = open();
    const row = fixture("threads-row.json") as { thread_id: string; compact_on: number; record: string; updated_at: number };
    db.prepare("INSERT INTO threads (thread_id, compact_on, record, updated_at) VALUES (?, ?, ?, ?)").run(row.thread_id, row.compact_on, row.record, row.updated_at);
    expect(store.get(row.thread_id)).toEqual(fixture("threads-record.json"));

    const log = fixture("turn-logs-row.json") as { thread_id: string; record: string };
    db.prepare("INSERT INTO turn_logs (thread_id, record) VALUES (?, ?)").run(log.thread_id, log.record);
    expect(store.turnLog(log.thread_id)).toEqual(fixture("turn-log.json"));

    expect(parseSettings(fixture("settings.json") as Record<string, unknown>)).toEqual({ keepWarm: "every", checkIns: true, waitMs: 30 * 60_000, fetchPrices: false });
  });

  it("loads the shape main stored before 0.1.0 with every field it acted on", () => {
    const { db, store } = open();
    const row = fixture("threads-row.json", "main-d987b67") as { thread_id: string; compact_on: number; record: string; updated_at: number };
    db.prepare("INSERT INTO threads (thread_id, compact_on, record, updated_at) VALUES (?, ?, ?, ?)").run(row.thread_id, row.compact_on, row.record, row.updated_at);
    const { eventsAfterSeq: _position, ...stored } = JSON.parse(row.record) as Record<string, unknown>;
    // Every field but eventsAfterSeq, which the turn log's position replaces, is read back as stored.
    expect(store.get(row.thread_id)).toMatchObject(stored);
    expect(store.get(row.thread_id)).toMatchObject({ transcript: null, window: null, decision: null });

    const log = fixture("turn-logs-row.json", "main-d987b67") as { thread_id: string; record: string };
    db.prepare("INSERT INTO turn_logs (thread_id, record) VALUES (?, ?)").run(log.thread_id, log.record);
    const read = store.turnLog(log.thread_id)!;
    expect(read).toMatchObject({ afterSeq: 5140, delivered: [{ childId: "thr_child", at: 1790506002000 }] });
    expect(read.turns[0]).toMatchObject({ startSeq: 5123, status: "completed", repliedNothingNew: true, inputs: [{ kind: "sent", expects: { kind: "not-finished" }, at: 1790506000000 }] });

    expect(parseSettings(fixture("settings.json", "main-d987b67") as Record<string, unknown>)).toEqual({ keepWarm: "switched", checkIns: true, waitMs: 15 * 60_000, fetchPrices: true });
  });

  it("stores and reads back a record unchanged, keeping an explicit Keep warm off apart from an untouched one", () => {
    const { store } = open();
    const record = fixture("threads-record.json") as ThreadRecord;
    store.put("a", record, 1);
    expect(store.get("a")).toEqual(record);
    store.put("off", { ...emptyRecord(), keepWarm: false }, 1);
    store.put("untouched", emptyRecord(), 1);
    expect(store.get("off").keepWarm).toBe(false);
    expect(store.get("untouched").keepWarm).toBeNull();
  });
});

describe("the size budget", () => {
  it("keeps a typical thread's threads row within 600 B and a sends row within 200 B", () => {
    const { db, store } = open();
    const typical: ThreadRecord = {
      ...emptyRecord(),
      compactOn: true,
      setting: 2,
      stretch: { ...newIdleStretch(1790503200000), chargedUsd: 0.455295123 },
      accountedSeq: 51234,
      lastSendId: 1234,
      transcript: {
        sessionId: "7dfc9da6-b6a9-4955-9df9-530b2c0ccda6",
        unreadable: null,
        cursor: {
          cwdSlug: "-home-user-src-github-com-acme-webapp",
          ino: 409612345,
          offset: 36700160,
          fold: {
            facts: { lastRequestAt: 1790506700000, lifetime: "1h", context: 412000, model: "claude-opus-5-5", requests: 812, userMessages: 97, lastCompaction: null },
            lastKey: "4998e577e5f92635",
            contextAt: 1790506700000,
            keeperTurn: false,
            awaitingRequest: false,
          },
        },
      },
      window: { model: "claude-opus-5-5", tokens: 1000000 },
      decision: { at: 1790506740000, what: "keep-warm", reason: null },
    };
    store.put("thr_4f9a2c1b7d3e", typical, 1790506740000);
    const row = db.prepare("SELECT * FROM threads").get() as Record<string, unknown>;
    expect(rowBytes(row)).toBeLessThanOrEqual(600);

    const id = store.claimSend({ threadId: "thr_4f9a2c1b7d3e", at: 1790506740000, dueKey: "keep-warm:1790506700000", kind: "keep-warm", hash: "4998e577e5f92635", stretchStartedAt: 1790503200000, forecastUsd: 0.2060012 })!;
    store.confirmSend(id, 1234);
    store.chargeSend(id, "thr_4f9a2c1b7d3e", 0.2123456789, true);
    const send = db.prepare("SELECT * FROM sends").get() as Record<string, unknown>;
    expect(rowBytes(send)).toBeLessThanOrEqual(200);
  });
});

describe("tidying", () => {
  it("deletes a thread's rows, and a turn log alone", () => {
    const { store } = open();
    store.put("t", emptyRecord(), 1);
    store.putTurnLog("t", { afterSeq: 1, requests: {}, turns: [], delivered: [] });
    store.deleteTurnLog("t");
    expect(store.turnLog("t")).toBeNull();
    expect(store.has("t")).toBe(true);
    store.putTurnLog("t", { afterSeq: 1, requests: {}, turns: [], delivered: [] });
    store.delete("t");
    expect(store.has("t")).toBe(false);
    expect(store.turnLog("t")).toBeNull();
  });

  it("creates the database with incremental auto-vacuum, and the file shrinks after a prune", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cache-keeper-db-")), "data.db");
    const { db, store } = open(path);
    expect((db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum).toBe(2);
    const day = 86_400_000;
    db.exec("PRAGMA synchronous = OFF");
    store.transaction(() => {
      for (let i = 0; i < 4000; i++) {
        const id = store.claimSend({ threadId: `thr_${i}`, at: i, dueKey: `k${i}`, kind: "keep-warm", hash: "h".repeat(16), stretchStartedAt: 0, forecastUsd: 0.1 })!;
        store.confirmSend(id, store.addHistory(`thr_${i}`, i, "keep-warm", { usd: 0.1, threads: [`thr_${i}`], folded: ["x".repeat(200)] }));
      }
    });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = statSync(path).size;
    store.prune(90 * day);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    expect(store.history(0)).toEqual([]);
    expect(statSync(path).size).toBeLessThan(before / 2);
  });

  it("switches an existing database made without auto-vacuum over to it", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (x)");
    ensureIncrementalVacuum(db);
    expect((db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum).toBe(2);
  });

  it("claims a due time once, even after the claim was left unfinished", () => {
    const { store } = open();
    const claim = { threadId: "t", at: 1, dueKey: "compact:59", kind: "compact" as const, hash: "h", stretchStartedAt: 0, forecastUsd: 0 };
    expect(store.claimSend(claim)).not.toBeNull();
    expect(store.claimSend(claim)).toBeNull();
    expect(store.claimSend({ ...claim, dueKey: "compact:120" })).not.toBeNull();
  });
});
