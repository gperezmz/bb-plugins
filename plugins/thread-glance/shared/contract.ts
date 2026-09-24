// RPC contract between the app and the server. The app imports this module
// for its types only; channel names and payload schemas live in signals.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PREFERENCE_KEYS, PREFERENCES, type PreferenceKey } from "./preferences";
import { stampsSchema, threadNotesSchema } from "./signals";

export * from "./signals";

const preferenceKeySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);
const preferencesSchema = z.object(
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].schema])),
);
const stampMapSchema = z.record(z.string(), z.number());
const threadIdsSchema = z.array(z.string().min(1).max(1024)).max(10_000);

export const rpcContract = defineRpcContract({
  listPreferences: {
    input: z.null(),
    output: z.object({ preferences: preferencesSchema }).strict(),
  },
  setPreference: {
    input: z.object({ key: preferenceKeySchema, value: z.unknown() }).strict(),
    output: z.object({ key: preferenceKeySchema, value: z.unknown() }).strict(),
  },
  resetPreference: {
    input: z.object({ key: preferenceKeySchema }).strict(),
    output: z.object({ key: preferenceKeySchema, value: z.unknown() }).strict(),
  },
  /**
   * First-run import. `bbMirror` is the parsed value of bb's own
   * localStorage mirror, or null when the app found none; the server then
   * tries `bb thread-list prefs list --json`. Runs at most once.
   */
  importPreferences: {
    input: z.object({ bbMirror: z.unknown().nullable() }).strict(),
    output: z
      .object({
        status: z.enum(["already-imported", "imported", "defaults"]),
        source: z.enum(["local-storage", "cli", "none"]).nullable(),
        keys: z.array(preferenceKeySchema),
      })
      .strict(),
  },
  listStamps: {
    input: z.null(),
    output: z.object({ stamps: stampsSchema }).strict(),
  },
  /** Records `seenAt` for child threads the user viewed. */
  markSeen: {
    input: z.object({ threadIds: threadIdsSchema }).strict(),
    output: z.object({ at: z.number() }).strict(),
  },
  /** Deletes `seenAt`, so Mark unread shows a finished child as unread. */
  clearSeen: {
    input: z.object({ threadIds: threadIdsSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  /** Notes per thread id (see `noteSchema`). */
  listNotes: {
    input: z.null(),
    output: z.object({ notes: z.record(z.string(), threadNotesSchema) }).strict(),
  },
  /** Earliest future `sendAt` per thread (scheduled sends). */
  listScheduled: {
    input: z.null(),
    output: z
      .object({ status: z.enum(["ready", "error"]), scheduled: stampMapSchema })
      .strict(),
  },
});

export type RpcContract = typeof rpcContract;
