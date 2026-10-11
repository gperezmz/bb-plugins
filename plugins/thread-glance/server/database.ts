// The plugin's SQLite database: its schema and the handle type the stores take.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type Database = ReturnType<BbPluginApi["storage"]["database"]>;
export type Kv = BbPluginApi["storage"]["kv"];

/**
 * The schema, one statement per migration. Append-only: bb records each
 * statement's hash and refuses a changed or reused index, so a later change to
 * the schema adds a statement.
 *
 * The first two statements create the `stamps` and `notes` tables of the
 * earlier list design. Installs that ran them have them recorded, so they
 * stay; `removeLegacyData` empties the tables by their shape.
 */
export const MIGRATIONS: readonly string[] = [
  "CREATE TABLE stamps (thread_id TEXT PRIMARY KEY NOT NULL, started_at INTEGER, finished_at INTEGER, seen_at INTEGER, idle_at INTEGER, pending_at INTEGER) WITHOUT ROWID",
  "CREATE TABLE notes (thread_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL) WITHOUT ROWID",
  "CREATE TABLE thread_lifecycle (thread_id TEXT PRIMARY KEY NOT NULL, settled_at INTEGER, settled_kind TEXT, parked_at INTEGER, snooze_until INTEGER, snoozed_at INTEGER, active_override INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID",
  "CREATE TABLE manual_order (thread_id TEXT PRIMARY KEY NOT NULL, position INTEGER NOT NULL) WITHOUT ROWID",
  "CREATE TABLE project_appearance (project_id TEXT PRIMARY KEY NOT NULL, colour TEXT, icon_name TEXT, icon_mime TEXT, icon_data BLOB, icon_updated_at INTEGER) WITHOUT ROWID",
  "CREATE TABLE clean_previews (token TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL) WITHOUT ROWID",
];
