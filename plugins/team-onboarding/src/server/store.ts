// Plugin-owned state. Results hold categories and redacted details only; the
// cached manifest is the only place a URL may appear.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ApprovalRecord } from "../core/approval.js";
import type { ItemResult } from "../core/model.js";
import type { Ownership } from "../core/skills.js";

/** The last good manifest, kept so the list stays right while the file is invalid. */
export interface CachedManifest {
  /** The file it was read from. */
  path?: string;
  text: string;
  /** sha256 of the file. */
  version: string;
  loadedAt: string;
}

export interface SkillSourceState {
  entryId: string;
  /** Hash of the entry's resolved sources, globs included. */
  config: string;
  /**
   * The remote commit of each source (in order) at which a full check last
   * found the installed skills exactly in sync. Only then may a check skip
   * the clone.
   */
  commits: string[];
  syncedAt: string;
}

export interface TrackedTerminal {
  terminalId: string;
  hostId: string;
  itemId: string | null;
  title: string;
  /** The command it runs or has typed, shown above it; null for older records. */
  command?: string | null;
  /** Its item was checked again after it exited. */
  rechecked?: boolean;
  createdAt: string;
}

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export class Store {
  private readonly db: Db;
  constructor(private readonly bb: BbPluginApi) {
    this.db = bb.storage.database();
    bb.storage.migrate(this.db, [
      `CREATE TABLE IF NOT EXISTS results (
         key TEXT PRIMARY KEY,
         json TEXT NOT NULL,
         ever_passed INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE TABLE IF NOT EXISTS approvals (
         hash TEXT PRIMARY KEY,
         item_id TEXT NOT NULL,
         role TEXT NOT NULL,
         text TEXT NOT NULL,
         approved_at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS skill_owners (
         folder TEXT PRIMARY KEY,
         entry_id TEXT NOT NULL,
         source_commit TEXT NOT NULL,
         git_tree TEXT NOT NULL,
         tree_hash TEXT NOT NULL
       )`,
      // Approvals no longer keep the command text (it may hold a URL).
      `UPDATE approvals SET text = ''`,
    ]);
  }

  // --- results -------------------------------------------------------------

  allResults(): Map<string, ItemResult> {
    const rows = this.db.prepare("SELECT key, json FROM results").all() as { key: string; json: string }[];
    return new Map(rows.map((row) => [row.key, JSON.parse(row.json) as ItemResult]));
  }

  everPassed(key: string): boolean {
    const row = this.db.prepare("SELECT ever_passed FROM results WHERE key = ?").get(key) as
      | { ever_passed: number }
      | undefined;
    return row?.ever_passed === 1;
  }

  putResult(key: string, result: ItemResult): void {
    this.db
      .prepare(
        `INSERT INTO results (key, json, ever_passed) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json,
           ever_passed = MAX(results.ever_passed, excluded.ever_passed)`,
      )
      .run(key, JSON.stringify(result), result.status === "ok" ? 1 : 0);
  }

  pruneResults(liveKeys: ReadonlySet<string>): void {
    const rows = this.db.prepare("SELECT key FROM results").all() as { key: string }[];
    const drop = this.db.prepare("DELETE FROM results WHERE key = ?");
    for (const row of rows) if (!liveKeys.has(row.key)) drop.run(row.key);
  }

  // --- approvals -----------------------------------------------------------

  approvals(): ApprovalRecord[] {
    const rows = this.db
      .prepare("SELECT hash, item_id, role, text, approved_at FROM approvals")
      .all() as { hash: string; item_id: string; role: string; text: string; approved_at: string }[];
    return rows.map((row) => ({
      hash: row.hash,
      itemId: row.item_id,
      role: row.role as ApprovalRecord["role"],
      text: row.text,
      approvedAt: row.approved_at,
    }));
  }

  approvedHashes(): Set<string> {
    return new Set(this.approvals().map((record) => record.hash));
  }

  approve(record: ApprovalRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO approvals (hash, item_id, role, text, approved_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.hash, record.itemId, record.role, record.text, record.approvedAt);
  }

  revoke(hash: string): void {
    this.db.prepare("DELETE FROM approvals WHERE hash = ?").run(hash);
  }

  replaceApprovals(records: readonly ApprovalRecord[]): void {
    const keep = new Set(records.map((record) => record.hash));
    for (const record of this.approvals()) if (!keep.has(record.hash)) this.revoke(record.hash);
  }

  // --- skill ownership -----------------------------------------------------

  owners(): Map<string, Ownership> {
    const rows = this.db
      .prepare("SELECT folder, entry_id, source_commit, git_tree, tree_hash FROM skill_owners")
      .all() as { folder: string; entry_id: string; source_commit: string; git_tree: string; tree_hash: string }[];
    return new Map(
      rows.map((row) => [
        row.folder,
        {
          folder: row.folder,
          entryId: row.entry_id,
          sourceCommit: row.source_commit,
          gitTree: row.git_tree,
          treeHash: row.tree_hash,
        },
      ]),
    );
  }

  own(record: Ownership): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO skill_owners (folder, entry_id, source_commit, git_tree, tree_hash) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.folder, record.entryId, record.sourceCommit, record.gitTree, record.treeHash);
  }

  disown(folder: string): void {
    this.db.prepare("DELETE FROM skill_owners WHERE folder = ?").run(folder);
  }

  // --- small key-value state ----------------------------------------------

  async manifest(): Promise<CachedManifest | null> {
    return (await this.bb.storage.kv.get<CachedManifest>("manifest")) ?? null;
  }
  async setManifest(value: CachedManifest | null): Promise<void> {
    if (value === null) await this.bb.storage.kv.delete("manifest");
    else await this.bb.storage.kv.set("manifest", value);
  }

  async skillSource(entryId: string): Promise<SkillSourceState | null> {
    return (await this.bb.storage.kv.get<SkillSourceState>(`skill-source:${entryId}`)) ?? null;
  }
  async setSkillSource(state: SkillSourceState): Promise<void> {
    await this.bb.storage.kv.set(`skill-source:${state.entryId}`, state);
  }
  async skillSourceIds(): Promise<string[]> {
    return (await this.bb.storage.kv.list("skill-source:")).map((key) => key.slice("skill-source:".length));
  }
  async deleteSkillSource(entryId: string): Promise<void> {
    await this.bb.storage.kv.delete(`skill-source:${entryId}`);
  }

  async terminals(): Promise<TrackedTerminal[]> {
    return (await this.bb.storage.kv.get<TrackedTerminal[]>("terminals")) ?? [];
  }
  async setTerminals(value: TrackedTerminal[]): Promise<void> {
    await this.bb.storage.kv.set("terminals", value.slice(-20));
  }

  async forgotten(): Promise<string[]> {
    return (await this.bb.storage.kv.get<string[]>("forgotten-machines")) ?? [];
  }
  async setForgotten(value: string[]): Promise<void> {
    await this.bb.storage.kv.set("forgotten-machines", value);
  }

  async meta(): Promise<{ lastRunAt: string | null; lastCheckAt: string | null }> {
    return (
      (await this.bb.storage.kv.get<{ lastRunAt: string | null; lastCheckAt: string | null }>("meta")) ?? {
        lastRunAt: null,
        lastCheckAt: null,
      }
    );
  }
  async setMeta(value: { lastRunAt: string | null; lastCheckAt: string | null }): Promise<void> {
    await this.bb.storage.kv.set("meta", value);
  }
}
