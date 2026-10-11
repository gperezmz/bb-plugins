// The Clean previews the server has handed out, kept in the plugin database so
// one survives a restart. A preview is valid for two minutes and read once.
import * as z from "zod/mini";
import type { Database } from "../database";

export const PREVIEW_TTL_MS = 2 * 60_000;
/** The most previews kept; the oldest go first. */
export const MAX_STORED_PREVIEWS = 8;
export const MAX_PREVIEW_THREADS = 500;
export const MAX_THREAD_TERMINALS = 200;
export const MAX_THREAD_PORTS = 200;

const storedPortSchema = z.strictObject({
  port: z.number(),
  pid: z.number(),
  startedAt: z.number(),
  process: z.nullable(z.string()),
});

const storedThreadSchema = z.strictObject({
  threadId: z.string(),
  title: z.string(),
  environmentId: z.string(),
  /** The running or starting terminals the preview listed. */
  terminalIds: z.array(z.string()).check(z.maxLength(MAX_THREAD_TERMINALS)),
  ports: z.array(storedPortSchema).check(z.maxLength(MAX_THREAD_PORTS)),
});

export const storedPreviewSchema = z.strictObject({
  threads: z.array(storedThreadSchema).check(z.maxLength(MAX_PREVIEW_THREADS)),
});
export type StoredPreview = z.infer<typeof storedPreviewSchema>;
export type StoredPreviewThread = z.infer<typeof storedThreadSchema>;

export interface PreviewStore {
  /** Stores the preview under `token` until `expiresAt`, dropping expired ones and the oldest beyond the bound. */
  put(token: string, preview: StoredPreview, now: number): void;
  /**
   * Removes the preview behind `token` and returns it, or null when there is
   * none, it has expired, or it cannot be read. The token is spent either way.
   */
  take(token: string, now: number): StoredPreview | null;
}

export function createPreviewStore(db: Database): PreviewStore {
  const insert = db.prepare("INSERT OR REPLACE INTO clean_previews (token, created_at, expires_at, data) VALUES (?, ?, ?, ?)");
  const select = db.prepare("SELECT expires_at, data FROM clean_previews WHERE token = ?");
  const remove = db.prepare("DELETE FROM clean_previews WHERE token = ?");
  const removeExpired = db.prepare("DELETE FROM clean_previews WHERE expires_at <= ?");
  const removeOldest = db.prepare(
    "DELETE FROM clean_previews WHERE token IN (SELECT token FROM clean_previews ORDER BY created_at DESC, token DESC LIMIT -1 OFFSET ?)",
  );

  const write = db.transaction((token: string, data: string, now: number, expiresAt: number) => {
    removeExpired.run(now);
    insert.run(token, now, expiresAt, data);
    removeOldest.run(MAX_STORED_PREVIEWS);
  });
  const spend = db.transaction((token: string) => {
    const row = select.get(token) as { expires_at: number; data: string } | undefined;
    remove.run(token);
    return row;
  });

  return {
    put(token, preview, now) {
      write(token, JSON.stringify(preview), now, now + PREVIEW_TTL_MS);
    },
    take(token, now) {
      const row = spend(token);
      if (row === undefined || row.expires_at <= now) return null;
      try {
        const parsed = storedPreviewSchema.safeParse(JSON.parse(row.data));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}
