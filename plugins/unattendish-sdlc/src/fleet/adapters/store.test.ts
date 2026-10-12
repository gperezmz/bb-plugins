import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Registration } from "../domain/model";
import { describeStore } from "../testing/store-contract";
import { MIGRATIONS, SqliteStore } from "./store";

/** What the host does: each statement runs once, by its index, which the database remembers. */
const migrated = (db: Database.Database, upTo = MIGRATIONS.length): Database.Database => {
  db.exec("CREATE TABLE IF NOT EXISTS applied_migrations (n INTEGER NOT NULL)");
  const done = (db.prepare("SELECT COUNT(*) AS n FROM applied_migrations").get() as { n: number }).n;
  for (let at = done; at < upTo; at += 1) {
    db.exec(MIGRATIONS[at]!);
    db.prepare("INSERT INTO applied_migrations (n) VALUES (?)").run(at);
  }
  return db;
};

describeStore("SqliteStore", () => {
  const db = migrated(new Database(":memory:"));
  return { store: new SqliteStore(db), close: () => db.close() };
});

const registration: Registration = {
  repo: { host: "github.com", path: "org/repo" },
  managerThreadId: "thr_manager",
  tracker: { kind: "forge-issues" },
  manifestPath: "/work/fleet/manifest.md",
  operator: "ana",
  labels: { spec: "spec", ready: "status:ready", inProgress: "in progress", needsInput: "needs input" },
  marker: "— fleet",
  echoActors: [],
  contract: 1,
  intervalMs: 90_000,
  registeredAt: "2026-10-12T10:00:00.000Z",
};

describe("SqliteStore on a database", () => {
  let folder: string | undefined;
  afterEach(() => {
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it("reads a wake stored before the not-watched line was kept as one without it", () => {
    const before = MIGRATIONS.findIndex((statement) => statement.startsWith("ALTER TABLE wakes"));
    const db = migrated(new Database(":memory:"), before);
    db.prepare("INSERT INTO wakes (repo_id, kind, thread_id, queued_message_id, queued_at, since) VALUES ('r', 'changes', 'thr_manager', 'msg_1', '2026-10-12T10:00:00.000Z', '2026-10-12T09:00:00.000Z')").run();
    migrated(db);
    expect(new SqliteStore(db).openWake("r")).toMatchObject({ queuedMessageId: "msg_1", notWatched: null });
    db.close();
  });

  it("reads a refusal and a not-watched line stored before their why was kept as a refused credential", () => {
    const before = MIGRATIONS.indexOf("ALTER TABLE fleets ADD COLUMN refused_why TEXT");
    const db = migrated(new Database(":memory:"), before);
    db.prepare("INSERT INTO fleets (repo_id, registration, refused_since, refused_prefix) VALUES ('r', ?, '2026-10-12T09:00:00.000Z', 'github.com/org')").run(JSON.stringify(registration));
    db.prepare(
      "INSERT INTO wakes (repo_id, kind, thread_id, queued_message_id, queued_at, since, not_watched_since, not_watched_prefix) VALUES ('r', 'not-watched', 'thr_manager', 'msg_1', '2026-10-12T10:00:00.000Z', '2026-10-12T09:00:00.000Z', '2026-10-12T09:00:00.000Z', 'github.com/org')",
    ).run();
    migrated(db);
    const store = new SqliteStore(db);
    expect(store.getFleet("r")).toMatchObject({ refused: { since: "2026-10-12T09:00:00.000Z", prefix: "github.com/org", announced: false, why: "refused" }, unreadablePolls: 0 });
    expect(store.openWake("r")!.notWatched).toEqual({ since: "2026-10-12T09:00:00.000Z", prefix: "github.com/org", why: "refused" });
    db.close();
  });

  it("runs every migration as one statement", () => {
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) expect(() => db.prepare(statement).run()).not.toThrow();
    db.close();
  });

  it("creates the indexes its queries use", () => {
    const db = migrated(new Database(":memory:"));
    const plan = (sql: string, ...params: unknown[]) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((step) => step.detail).join("\n");
    expect(plan("SELECT * FROM changes WHERE repo_id = ? AND ref = ?", "r", "#1")).toContain("USING INDEX");
    expect(plan("SELECT * FROM changes WHERE repo_id = ? AND url = ?", "r", "u")).toContain("USING INDEX");
    expect(plan("SELECT * FROM changes WHERE repo_id = ? AND disposition = 'held' ORDER BY at", "r")).toContain("USING INDEX");
    expect(plan("SELECT * FROM changes WHERE repo_id = ? AND wake_id = ?", "r", 1)).toContain("USING INDEX");
    expect(plan("SELECT * FROM wakes WHERE queued_message_id = ?", "m")).toContain("USING INDEX");
    expect(plan("DELETE FROM changes WHERE seen_at < ?", "t")).toContain("USING INDEX");
    db.close();
  });

  it("keeps its data when the database file is opened again", () => {
    folder = mkdtempSync(join(tmpdir(), "fleet-store-"));
    const file = join(folder, "data.db");

    const first = migrated(new Database(file));
    const before = new SqliteStore(first);
    before.saveRegistration(registration, [{ code: "no-credential", text: "No credential for github.com/org." }]);
    before.commit({ repo: "github.com/org/repo", at: "2026-10-12T10:05:00.000Z", cursors: [{ role: "forge", cursor: { since: "2026-10-12T10:04:00.000Z", items: {} } }] });
    before.recordChange("github.com/org/repo", {
      key: "k1",
      role: "forge",
      ref: "#1",
      url: "https://github.com/org/repo/pull/1",
      kind: "merged",
      label: null,
      actor: "bob",
      at: "2026-10-12T10:00:00.000Z",
      seenAt: "2026-10-12T10:01:00.000Z",
      disposition: "wake",
      rule: null,
    });
    const wake = before.createWake("github.com/org/repo", { kind: "changes", threadId: "thr_manager", queuedMessageId: "msg_1", queuedAt: "2026-10-12T10:06:00.000Z", since: "2026-10-12T10:00:00.000Z", catchUpMs: null, heldSince: null, notWatched: null });
    first.close();

    const second = migrated(new Database(file));
    const after = new SqliteStore(second);
    expect(after.getFleet("github.com/org/repo")?.registration).toEqual(registration);
    expect(after.getFleet("github.com/org/repo")?.notWatched).toHaveLength(1);
    expect(after.getFleet("github.com/org/repo")?.lastPolledAt).toBe("2026-10-12T10:05:00.000Z");
    expect(after.getCursor("github.com/org/repo", "forge")).toEqual({ since: "2026-10-12T10:04:00.000Z", items: {} });
    expect(after.dispositions("github.com/org/repo", ["k1"]).get("k1")).toBe("wake");
    expect(after.openWake("github.com/org/repo")).toEqual(wake);
    expect(after.createWake("github.com/org/repo", { kind: "changes", threadId: "thr_manager", queuedMessageId: null, queuedAt: "2026-10-12T10:07:00.000Z", since: "2026-10-12T10:00:00.000Z", catchUpMs: null, heldSince: null, notWatched: null }).id).toBeGreaterThan(wake.id);
    second.close();
  });

  it("holds only the columns of its types, so no column can carry a token or a service's text", () => {
    const db = migrated(new Database(":memory:"));
    const columns = (db.prepare("SELECT m.name AS tbl, p.name AS col FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'").all() as { tbl: string; col: string }[]).map((c) => `${c.tbl}.${c.col}`);
    expect(columns.filter((column) => /token|secret|body|title|text|name/i.test(column.split(".")[1]!))).toEqual([]);
    db.close();
  });
});
