// Per-project appearance in the plugin database's `project_appearance` table:
// the colour override and the uploaded icon. Read into memory once and written
// through; icon bytes stay in the table and are read when served.
import type { Appearance } from "../shared/signals";
import type { Database } from "./database";

export interface StoredIcon {
  name: string;
  mime: string;
  data: Buffer;
}

export interface AppearanceStore {
  /** The colour overrides and icon infos by project id, as `sync` carries them. */
  read(): Appearance;
  /** Sets or, with null, removes a project's colour override. Returns whether it changed. */
  setColour(projectId: string, colour: string | null): boolean;
  /** Stores a project's uploaded icon, replacing any, or removes it with null. Returns whether it changed. */
  setIcon(projectId: string, icon: StoredIcon | null, at: number): boolean;
  /** The bytes of a project's uploaded icon. */
  readIcon(projectId: string): StoredIcon | null;
  /** Deletes everything held for a project. Returns whether anything was. */
  forget(projectId: string): boolean;
}

interface Row {
  colour: string | null;
  icon: { name: string; mime: string; updatedAt: number } | null;
}

export function createAppearanceStore(db: Database): AppearanceStore {
  const rows = new Map<string, Row>();
  const selectAll = db
    .prepare("SELECT project_id, colour, icon_name, icon_mime, icon_updated_at FROM project_appearance")
    .raw(true);
  for (const [projectId, colour, name, mime, updatedAt] of selectAll.all() as [
    string,
    string | null,
    string | null,
    string | null,
    number | null,
  ][]) {
    const icon =
      typeof name === "string" && typeof mime === "string"
        ? { name, mime, updatedAt: typeof updatedAt === "number" ? updatedAt : 0 }
        : null;
    if (typeof colour === "string" || icon !== null) {
      rows.set(projectId, { colour: typeof colour === "string" ? colour : null, icon });
    }
  }
  const upsertColour = db.prepare(
    "INSERT INTO project_appearance (project_id, colour) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET colour = excluded.colour",
  );
  const upsertIcon = db.prepare(
    "INSERT INTO project_appearance (project_id, icon_name, icon_mime, icon_data, icon_updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET icon_name = excluded.icon_name, icon_mime = excluded.icon_mime, icon_data = excluded.icon_data, icon_updated_at = excluded.icon_updated_at",
  );
  const selectIcon = db.prepare("SELECT icon_name, icon_mime, icon_data FROM project_appearance WHERE project_id = ?").raw(true);
  const remove = db.prepare("DELETE FROM project_appearance WHERE project_id = ?");
  const dropEmpty = db.prepare(
    "DELETE FROM project_appearance WHERE project_id = ? AND colour IS NULL AND icon_name IS NULL",
  );

  function settle(projectId: string): void {
    const row = rows.get(projectId);
    if (row !== undefined && row.colour === null && row.icon === null) {
      rows.delete(projectId);
      dropEmpty.run(projectId);
    }
  }

  return {
    read() {
      const appearance: Appearance = { colours: {}, icons: {} };
      for (const [projectId, row] of rows) {
        if (row.colour !== null) appearance.colours[projectId] = row.colour;
        if (row.icon !== null) appearance.icons[projectId] = row.icon;
      }
      return appearance;
    },
    setColour(projectId, colour) {
      const row = rows.get(projectId) ?? { colour: null, icon: null };
      if (row.colour === colour) return false;
      upsertColour.run(projectId, colour);
      rows.set(projectId, { ...row, colour });
      settle(projectId);
      return true;
    },
    setIcon(projectId, icon, at) {
      const row = rows.get(projectId) ?? { colour: null, icon: null };
      if (icon === null) {
        if (row.icon === null) return false;
        upsertIcon.run(projectId, null, null, null, null);
        rows.set(projectId, { ...row, icon: null });
        settle(projectId);
        return true;
      }
      upsertIcon.run(projectId, icon.name, icon.mime, icon.data, at);
      rows.set(projectId, { ...row, icon: { name: icon.name, mime: icon.mime, updatedAt: at } });
      return true;
    },
    readIcon(projectId) {
      const raw = selectIcon.get(projectId) as [string | null, string | null, Buffer | null] | undefined;
      if (raw === undefined || raw[0] === null || raw[1] === null || raw[2] === null) return null;
      return { name: raw[0], mime: raw[1], data: raw[2] };
    },
    forget(projectId) {
      if (!rows.has(projectId)) return false;
      remove.run(projectId);
      rows.delete(projectId);
      return true;
    },
  };
}
