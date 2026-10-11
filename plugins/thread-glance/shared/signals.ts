// Realtime channels, their payloads and the schemas the app validates them
// with. Nothing here imports the SDK, so the app bundle can use its values.
import * as z from "zod/mini";
import { lifecycleRowSchema } from "./lifecycle";
import { settingsSchema } from "./settings";

/** A thread record: what the server holds for one thread. */
export const threadRecordSchema = z.object({
  /** The thread's lifecycle row, null when it follows the automatic rules. */
  lifecycle: z.nullable(lifecycleRowSchema),
});
export type ThreadRecord = z.infer<typeof threadRecordSchema>;

/** Thread records by thread id. */
export const threadRecordsSchema = z.record(z.string(), threadRecordSchema);

/**
 * Where a window stands in the server's changes: the server's epoch, new on
 * every server start, and the last revision it saw of that epoch.
 */
export const syncPointSchema = z.object({
  epoch: z.string(),
  revision: z.number(),
});
export type SyncPoint = z.infer<typeof syncPointSchema>;

/** Realtime channels the server publishes on. */
export const CHANNELS = {
  records: "records",
  settings: "settings",
  order: "order",
  appearance: "appearance",
} as const;

/**
 * `records` payload: every thread record one change touched, whole, at the
 * revision it made. A thread whose row is gone has `lifecycle` null.
 */
export const recordsSignalSchema = z.object({
  epoch: z.string(),
  revision: z.number(),
  records: threadRecordsSchema,
});
export type RecordsSignal = z.infer<typeof recordsSignalSchema>;

/**
 * A whole value with the version that made it. `settings`, `order` and
 * `appearance` each publish their whole value on every change, and a window
 * keeps the one with the higher version within one epoch.
 */
export function versionedSchema<T extends z.ZodMiniType>(value: T) {
  return z.object({ epoch: z.string(), version: z.number(), value });
}
export interface Versioned<T> {
  epoch: string;
  version: number;
  value: T;
}

/** A project colour override, `#rrggbb` in lower case. */
export const projectColourSchema = z.string().check(z.regex(/^#[0-9a-f]{6}$/, "Use a colour like #1a2b3c."));

/** An uploaded project icon, as the settings page lists it; the bytes are served over HTTP. */
export const projectIconInfoSchema = z.object({
  name: z.string(),
  mime: z.string(),
  updatedAt: z.number(),
});
export type ProjectIconInfo = z.infer<typeof projectIconInfoSchema>;

/** What the server keeps per project: colour overrides and uploaded icons, by project id. */
export const appearanceSchema = z.object({
  colours: z.record(z.string(), projectColourSchema),
  icons: z.record(z.string(), projectIconInfoSchema),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const settingsSignalSchema = versionedSchema(settingsSchema);
export const orderSignalSchema = versionedSchema(z.array(z.string()));
export const appearanceSignalSchema = versionedSchema(appearanceSchema);
export type SettingsSignal = z.infer<typeof settingsSignalSchema>;
export type OrderSignal = z.infer<typeof orderSignalSchema>;
export type AppearanceSignal = z.infer<typeof appearanceSignalSchema>;
