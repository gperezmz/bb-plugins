import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Database, Kv } from "./database";
import { MIGRATIONS } from "./database";
import { removeLegacyData } from "./legacy-cleanup";

function fakeKv(initial: Record<string, unknown>): Kv & { rows: Map<string, unknown> } {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    async get<T>(key: string) {
      return rows.get(key) as T | undefined;
    },
    async set(key, value) {
      rows.set(key, value);
    },
    async delete(key) {
      rows.delete(key);
    },
    async list(prefix = "") {
      return [...rows.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

const tables = (db: Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (row) => row.name,
  );

function database(): Database {
  const db = new BetterSqlite3(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db as unknown as Database;
}

describe("removeLegacyData", () => {
  it("drops the earlier tables with their data and deletes the earlier KV rows, whatever the version", async () => {
    const db = database();
    db.prepare("INSERT INTO stamps (thread_id, seen_at) VALUES ('t1', 5)").run();
    db.prepare("INSERT INTO notes (thread_id, data) VALUES ('t1', '{}')").run();
    const kv = fakeKv({
      "preference:organizationMode": "machine",
      "preference:foldOlder": false,
      "stamp:t1": { seenAt: 1 },
      "note:t1": {},
    });
    const result = await removeLegacyData({ storage: { kv } }, db);
    expect(result).toEqual({ droppedTables: ["stamps", "notes"], deletedKvRows: 4 });
    expect(tables(db)).not.toContain("stamps");
    expect(tables(db)).not.toContain("notes");
    expect(kv.rows.size).toBe(0);
  });

  it("leaves the shelf list's own data alone, on every start", async () => {
    const db = database();
    db.prepare("INSERT INTO thread_lifecycle (thread_id, parked_at) VALUES ('t1', 7)").run();
    db.prepare("INSERT INTO manual_order (thread_id, position) VALUES ('t1', 0)").run();
    db.prepare("INSERT INTO project_appearance (project_id, colour) VALUES ('p1', '#112233')").run();
    const kv = fakeKv({ settings: { workingShelf: true }, "preference:organizationMode": "machine" });
    for (let start = 0; start < 3; start += 1) {
      await removeLegacyData({ storage: { kv } }, db);
      expect((db.prepare("SELECT parked_at FROM thread_lifecycle").get() as { parked_at: number }).parked_at).toBe(7);
      expect(db.prepare("SELECT thread_id FROM manual_order").all()).toHaveLength(1);
      expect(db.prepare("SELECT colour FROM project_appearance").all()).toHaveLength(1);
      expect(kv.rows.get("settings")).toEqual({ workingShelf: true });
      expect([...kv.rows.keys()]).toEqual(["settings"]);
    }
  });

  it("recognises a table by its shape: one with other columns is not the earlier design's", async () => {
    const db = new BetterSqlite3(":memory:") as unknown as Database;
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    db.exec("CREATE TABLE stamps (thread_id TEXT, seen_at INTEGER)");
    const result = await removeLegacyData({ storage: { kv: fakeKv({}) } }, db);
    expect(result.droppedTables).toEqual([]);
    expect(tables(db)).toEqual(["notes", "stamps"]);
  });

  it("does nothing on a database the earlier design never touched", async () => {
    const db = new BetterSqlite3(":memory:") as unknown as Database;
    expect(await removeLegacyData({ storage: { kv: fakeKv({}) } }, db)).toEqual({ droppedTables: [], deletedKvRows: 0 });
  });

  it("deletes a large number of KV rows", async () => {
    const rows = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`stamp:t${index}`, {}]));
    const kv = fakeKv(rows);
    const result = await removeLegacyData({ storage: { kv } }, database());
    expect(result.deletedKvRows).toBe(130);
    expect(kv.rows.size).toBe(0);
  });
});
