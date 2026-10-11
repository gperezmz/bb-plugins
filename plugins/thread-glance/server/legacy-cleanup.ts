// Removes the data of the earlier list design. It is recognised by its shape,
// never by the installed version: a `stamps` table with exactly the earlier
// columns, a `notes` table with exactly its earlier columns, and KV rows under
// the earlier key prefixes. The shelf list keeps none of its data under those
// names, so running this on every start leaves the lifecycle rows, the manual
// order, the settings and the project appearance as they are. The tables
// themselves stay, empty: bb records their migrations as applied, so the
// earlier design keeps working if it is installed again on the same database.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Database, Kv } from "./database";

/** Tables of the earlier design and the columns that identify each. */
const LEGACY_TABLES: Readonly<Record<string, readonly string[]>> = {
  stamps: ["thread_id", "started_at", "finished_at", "seen_at", "idle_at", "pending_at"],
  notes: ["thread_id", "data"],
};

/** KV key prefixes of the earlier design: preferences, stamps and notes. */
export const LEGACY_KV_PREFIXES: readonly string[] = ["preference:", "stamp:", "note:"];

const KV_DELETE_BATCH = 50;

function columnsOf(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
}

function sameColumns(found: readonly string[], expected: readonly string[]): boolean {
  return found.length === expected.length && expected.every((name) => found.includes(name));
}

export interface LegacyCleanup {
  /** The earlier tables that held rows, now empty. */
  clearedTables: string[];
  deletedKvRows: number;
}

/** Deletes the rows of the earlier design's tables, which stay, and its KV rows. */
export async function removeLegacyData(
  bb: { storage: { kv: Kv }; log?: Pick<BbPluginApi["log"], "info"> },
  db: Database,
): Promise<LegacyCleanup> {
  const clearedTables: string[] = [];
  for (const [table, columns] of Object.entries(LEGACY_TABLES)) {
    const found = columnsOf(db, table);
    if (found.length > 0 && sameColumns(found, columns)) {
      if (db.prepare(`DELETE FROM ${table}`).run().changes > 0) clearedTables.push(table);
    }
  }
  let deletedKvRows = 0;
  for (const prefix of LEGACY_KV_PREFIXES) {
    const keys = await bb.storage.kv.list(prefix);
    for (let start = 0; start < keys.length; start += KV_DELETE_BATCH) {
      for (const key of keys.slice(start, start + KV_DELETE_BATCH)) {
        // `list` matches a prefix; the key must start with it to be the earlier design's.
        if (!key.startsWith(prefix)) continue;
        await bb.storage.kv.delete(key);
        deletedKvRows += 1;
      }
      // Lets bb's server answer other requests while a large clean-up runs.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  if (clearedTables.length > 0 || deletedKvRows > 0) {
    bb.log?.info(
      `removed the earlier list's data: ${clearedTables.length} tables, ${deletedKvRows} stored values`,
    );
  }
  return { clearedTables, deletedKvRows };
}
