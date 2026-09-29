// RPC contract between the app and the server. The app imports this module
// for its types only; channel names and payload schemas live in signals.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import { PREFERENCE_KEYS, PREFERENCES, type PreferenceKey } from "./preferences";
import { stampMapSchema, stampsSchema, threadNotesSchema } from "./signals";

export * from "./signals";

const preferenceKeySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);
const preferencesSchema = z.object(
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].schema])),
);
const threadIdsSchema = z.array(z.string().check(z.minLength(1), z.maxLength(1024))).check(z.maxLength(10_000));

export const rpcContract = defineRpcContract({
  listPreferences: {
    input: z.null(),
    output: z.strictObject({ preferences: preferencesSchema }),
  },
  setPreference: {
    input: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
    output: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
  },
  resetPreference: {
    input: z.strictObject({ key: preferenceKeySchema }),
    output: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
  },
  /**
   * First-run import. `bbMirror` is the parsed value of bb's own
   * localStorage mirror, or null when the app found none; the server then
   * tries `bb thread-list prefs list --json`. Runs at most once.
   */
  importPreferences: {
    input: z.strictObject({ bbMirror: z.nullable(z.unknown()) }),
    output: z.strictObject({
      status: z.enum(["already-imported", "imported", "defaults"]),
      source: z.nullable(z.enum(["local-storage", "cli", "none"])),
      keys: z.array(preferenceKeySchema),
    }),
  },
  listStamps: {
    input: z.null(),
    output: z.strictObject({ stamps: stampsSchema }),
  },
  /** Records `seenAt` for child threads the user viewed. */
  markSeen: {
    input: z.strictObject({ threadIds: threadIdsSchema }),
    output: z.strictObject({ at: z.number() }),
  },
  /** Deletes `seenAt`, so Mark unread shows a finished child as unread. */
  clearSeen: {
    input: z.strictObject({ threadIds: threadIdsSchema }),
    output: z.strictObject({ ok: z.literal(true) }),
  },
  /**
   * Records `idleAt` for threads a window saw go from busy to idle. A thread
   * keeps the later of its stored moment and this one.
   */
  markIdle: {
    input: z.strictObject({ threadIds: threadIdsSchema }),
    output: z.strictObject({ at: z.number() }),
  },
  /** Notes per thread id (see `noteSchema`). */
  listNotes: {
    input: z.null(),
    output: z.strictObject({ notes: z.record(z.string(), threadNotesSchema) }),
  },
  /** Earliest future `sendAt` per thread (scheduled sends). */
  listScheduled: {
    input: z.null(),
    output: z.strictObject({ status: z.enum(["ready", "error"]), scheduled: stampMapSchema }),
  },
});

export type RpcContract = typeof rpcContract;
