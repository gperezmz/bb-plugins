// RPC contract between the app and the server. The app imports this module
// for its types only; channel names and payload schemas live in signals.ts.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import * as z from "zod/mini";
import { lifecycleRowSchema } from "./lifecycle";
import { settingsSchema, SETTING_KEYS, type SettingKey } from "./settings";
import {
  appearanceSchema,
  projectColourSchema,
  syncPointSchema,
  threadRecordsSchema,
  versionedSchema,
} from "./signals";

const idSchema = z.string().check(z.minLength(1), z.maxLength(1024));
const threadIdSchema = z.strictObject({ threadId: idSchema });
const threadIdsSchema = z.array(idSchema).check(z.maxLength(10_000));

/**
 * Thread records by thread id, checked only for being an object: the server
 * builds them from rows its stores validated, and checking every record again
 * would cost the first `sync` more than reading them.
 */
const recordsOutputSchema = z.custom<z.infer<typeof threadRecordsSchema>>(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value),
);

const reclaimSchema = z.strictObject({
  stoppedRuntime: z.boolean(),
  closedTerminals: z.number(),
  keptTerminals: z.number(),
});

/** One thread's row before and after an action, which Undo hands back. */
const changeSchema = z.strictObject({
  threadId: z.string(),
  before: z.nullable(lifecycleRowSchema),
  after: z.nullable(lifecycleRowSchema),
  /** The action unpinned the thread, and Undo pins it again. */
  unpinned: z.boolean(),
});

/** What a lifecycle action did: the rows it changed, and the Reclaim it ran. */
const actionOutputSchema = z.strictObject({
  changes: z.array(changeSchema),
  reclaim: reclaimSchema,
  /** The reclaim note for the toast, null when nothing was reclaimed. */
  note: z.nullable(z.string()),
});

const settingsVersionedSchema = versionedSchema(settingsSchema);
const orderVersionedSchema = versionedSchema(z.array(z.string()));
const appearanceVersionedSchema = versionedSchema(appearanceSchema);

const settingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

export const rpcContract = defineRpcContract({
  /**
   * Everything the list reads from the server in one answer. With `since`
   * null, or from another epoch, `full` is true and `records` holds the record
   * of every thread not archived, to replace what the window held; otherwise
   * it holds the records that changed since. `settings`, `order` and
   * `appearance` are always whole, with the version a window keeps the latest of.
   */
  sync: {
    input: z.strictObject({ since: z.nullable(z.strictObject(syncPointSchema.shape)) }),
    output: z.strictObject({
      epoch: z.string(),
      revision: z.number(),
      full: z.boolean(),
      records: recordsOutputSchema,
      settings: settingsVersionedSchema,
      order: orderVersionedSchema,
      appearance: appearanceVersionedSchema,
    }),
  },

  /**
   * Snoozes a thread until `until` (epoch ms): unpins it, records the wake and
   * snooze times, then Reclaims. Refuses a busy thread and a time in the past
   * or more than a year ahead. The app resolves presets and the picker in the
   * local time zone and sends the time.
   */
  snooze: {
    input: z.strictObject({ threadId: idSchema, until: z.number() }),
    output: actionOutputSchema,
  },
  /** Wake now: clears the thread's snooze. */
  wake: { input: threadIdSchema, output: actionOutputSchema },
  /** Parks a thread: unpins it, records the park time, then Reclaims. Refuses a busy thread. */
  park: { input: threadIdSchema, output: actionOutputSchema },
  /** Resume: returns a parked (or snoozed, or settled) thread to Active, with the active override. */
  resume: { input: threadIdSchema, output: actionOutputSchema },
  /**
   * Settles the thread and every thread below it: refuses if any is busy,
   * unpins the tree's pinned threads, marks each settled (manual), then
   * Reclaims each. Keeps a snapshot in memory for `undoSettle` until `undoUntil`.
   */
  settle: {
    input: threadIdSchema,
    output: z.strictObject({
      changes: z.array(changeSchema),
      reclaim: reclaimSchema,
      note: z.nullable(z.string()),
      undoToken: z.string(),
      /** Epoch ms after which `undoSettle` answers that the Settle can no longer be undone. */
      undoUntil: z.number(),
    }),
  },
  /** Undo of a Settle, from its snapshot, for each thread where nothing changed since. */
  undoSettle: {
    input: z.strictObject({ threadId: idSchema, undoToken: z.string() }),
    output: actionOutputSchema,
  },
  /**
   * Un-settle: returns the thread to Active (with the active override), its
   * settled descendants to the automatic rules, and reopens its ancestors.
   */
  unsettle: { input: threadIdSchema, output: actionOutputSchema },
  /**
   * Undo of a snooze, park, Wake now or similar: puts each change's `before`
   * row back where the thread's row still equals its `after`. A `before` that
   * is a snooze whose time has passed is skipped. Undo of Resume is `park`,
   * and of Un-settle is `settle`.
   */
  undoLifecycle: {
    input: z.strictObject({ changes: z.array(changeSchema).check(z.maxLength(1000)) }),
    output: z.strictObject({
      changes: z.array(changeSchema),
      /** Threads whose row changed since, or whose snooze ended; each with the reason. */
      skipped: z.array(z.strictObject({ threadId: z.string(), reason: z.string() })),
    }),
  },
  /** Opening a woke thread, or dismissing its Woke marker: clears the row when the thread is woke; otherwise nothing changes. */
  dismissWoke: { input: threadIdSchema, output: actionOutputSchema },
  /** Clears the row of a pinned thread. Does nothing for a thread that is not pinned. */
  clearPinned: { input: threadIdSchema, output: actionOutputSchema },

  /**
   * Puts the threads of `threadIds` (a subset, in their new sequence) in
   * Manual order, leaving the places of every other thread.
   */
  reorder: { input: z.strictObject({ threadIds: threadIdsSchema }), output: orderVersionedSchema },

  /**
   * Saves the edited settings fields (a `SettingsPatch`). The server checks
   * them field by field and refuses with each invalid field's message, so the
   * patch is not narrowed here.
   */
  writeSettings: { input: z.strictObject({ patch: z.record(z.string(), z.unknown()) }), output: settingsVersionedSchema },
  /** Resets the named settings, or all of them, to their defaults. */
  resetSettings: {
    input: z.strictObject({ keys: z.optional(z.array(settingKeySchema)) }),
    output: settingsVersionedSchema,
  },

  /** Sets a project's colour override. */
  setProjectColour: {
    input: z.strictObject({ projectId: idSchema, colour: projectColourSchema }),
    output: appearanceVersionedSchema,
  },
  /** Removes a project's colour override. */
  resetProjectColour: { input: z.strictObject({ projectId: idSchema }), output: appearanceVersionedSchema },
  /** Forgets a removed project's colour and icon. */
  forgetProject: { input: z.strictObject({ projectId: idSchema }), output: appearanceVersionedSchema },
  /** Stores an uploaded project icon (SVG, PNG, ICO, JPEG, GIF, AVIF or WebP, up to 1 MB). */
  uploadProjectIcon: {
    input: z.strictObject({ projectId: idSchema, name: z.string(), mime: z.string(), dataBase64: z.string() }),
    output: appearanceVersionedSchema,
  },
  /** Removes an uploaded project icon, so the favicon or the monogram shows (Use automatic). */
  clearProjectIcon: { input: z.strictObject({ projectId: idSchema }), output: appearanceVersionedSchema },

  /** Runs an auto-settle pass now, queued behind the one running; returns the threads it settled and un-settled. */
  runAutoSettle: {
    input: z.strictObject({}),
    output: z.strictObject({ settled: z.array(z.string()), unsettled: z.array(z.string()) }),
  },
});

export type RpcContract = typeof rpcContract;
