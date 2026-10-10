// RPC contract between the app and the server. The app imports this module
// for its types only; channel names and payload schemas live in signals.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import { PREFERENCE_KEYS, PREFERENCES, type PreferenceKey } from "./preferences";
import { stampMapSchema, syncPointSchema, type ThreadRecord } from "./signals";

const preferenceKeySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);
const preferencesSchema = z.object(
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].schema])),
);
const threadIdsSchema = z.array(z.string().check(z.minLength(1), z.maxLength(1024))).check(z.maxLength(10_000));
/**
 * Thread records by thread id, checked only for being an object: the server
 * builds them from rows its stores validated, and checking every record again
 * would cost the first `sync` more than reading them.
 */
const recordsOutputSchema = z.custom<Record<string, ThreadRecord>>(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value),
);

export const rpcContract = defineRpcContract({
  /**
   * Everything the list reads from the server in one answer: preferences,
   * scheduled sends, and the thread records that changed since `since`. With
   * `since` null, or from another epoch, `full` is true and `records` holds
   * the record of every thread not archived, to replace what the window held.
   */
  sync: {
    input: z.strictObject({ since: z.nullable(z.strictObject(syncPointSchema.shape)) }),
    output: z.strictObject({
      epoch: z.string(),
      revision: z.number(),
      full: z.boolean(),
      preferences: preferencesSchema,
      scheduled: z.strictObject({ status: z.enum(["ready", "error"]), scheduled: stampMapSchema }),
      records: recordsOutputSchema,
    }),
  },
  /**
   * The records of the named threads, archived or not, for the archived ones
   * `sync` leaves out. A thread with none is absent.
   */
  fetchArchived: {
    input: z.strictObject({ threadIds: threadIdsSchema }),
    output: z.strictObject({ epoch: z.string(), revision: z.number(), records: recordsOutputSchema }),
  },
  setPreference: {
    input: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
    output: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
  },
  resetPreference: {
    input: z.strictObject({ key: preferenceKeySchema }),
    output: z.strictObject({ key: preferenceKeySchema, value: z.unknown() }),
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
   * Records `idleAt` for threads one window saw go from busy to idle by a
   * change bb sends no event for. A thread keeps the later of its stored
   * moment and this one.
   */
  reportIdle: {
    input: z.strictObject({ threadIds: threadIdsSchema }),
    output: z.strictObject({ ok: z.literal(true) }),
  },
});

export type RpcContract = typeof rpcContract;
