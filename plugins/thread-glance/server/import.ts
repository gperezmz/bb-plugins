// First-run import of bb's own thread-list preferences.
import { execFile } from "node:child_process";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  mapBbPreferences,
  preferenceDefault,
  type PreferenceKey,
} from "../shared/preferences";
import type { PreferenceStore } from "./preference-store";

export const IMPORT_MARKER_KEY = "migration:import:v1";
const CLI_TIMEOUT_MS = 5_000;
const CLI_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export type ImportSource = "local-storage" | "cli" | "none";

export interface ImportResult {
  status: "already-imported" | "imported" | "defaults";
  source: ImportSource | null;
  keys: PreferenceKey[];
}

/**
 * Reads bb's preferences from its CLI and returns the parsed JSON, or null
 * when the command fails or prints something that is not JSON.
 */
export type BbCliReader = () => Promise<unknown>;

export interface ImportDeps {
  kv: BbPluginApi["storage"]["kv"];
  log: BbPluginApi["log"];
  store: PreferenceStore;
  readBbCli: BbCliReader;
}

/**
 * Returns bb's preference object from a mirror or CLI value, or null when it
 * holds no preferences.
 *
 * bb 0.43 writes both as a flat key-to-value object. A JSON string and a
 * `{ preferences }` wrapper (the shape of bb's `listPreferences` RPC) are
 * unwrapped too, so an app that sends the raw localStorage string or a newer
 * bb that wraps the object still imports.
 */
export function unwrapBbPreferences(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const inner = record.preferences;
  if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return record;
}

/** The bb binary: `BB_CLI` when the server has it, else `bb` on PATH. */
export function bbCliPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BB_CLI?.trim();
  return configured ? configured : "bb";
}

/** Runs `bb thread-list prefs list --json` with a 5 s timeout. */
export function createBbCliReader(
  log: BbPluginApi["log"],
  env: NodeJS.ProcessEnv = process.env,
): BbCliReader {
  return () =>
    new Promise((resolve) => {
      const file = bbCliPath(env);
      execFile(
        file,
        ["thread-list", "prefs", "list", "--json"],
        { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER_BYTES, encoding: "utf8" },
        (error, stdout) => {
          if (error) {
            log.warn(`could not run ${file} thread-list prefs list: ${error.message}`);
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(stdout) as unknown);
          } catch {
            log.warn(`${file} thread-list prefs list printed output that is not JSON`);
            resolve(null);
          }
        },
      );
    });
}

/**
 * Imports bb's preferences once, from the first source that holds any:
 * `bbMirror` (bb's localStorage mirror, sent by the app), then bb's CLI, then
 * nothing. A key that already has a kv row keeps it, and a value equal to our
 * default is not written. The marker is set whichever source won, so a later
 * call returns `already-imported`.
 */
export async function importPreferences(
  deps: ImportDeps,
  bbMirror: unknown,
): Promise<ImportResult> {
  if ((await deps.kv.get<unknown>(IMPORT_MARKER_KEY)) !== undefined) {
    return { status: "already-imported", source: null, keys: [] };
  }

  let source: ImportSource = "none";
  let mapped: Record<string, unknown> = {};
  const fromMirror = bbMirror === null ? null : unwrapBbPreferences(bbMirror);
  const mirrorMapped = fromMirror === null ? {} : mapBbPreferences(fromMirror);
  if (Object.keys(mirrorMapped).length > 0) {
    source = "local-storage";
    mapped = mirrorMapped;
  } else {
    const cli = unwrapBbPreferences(await deps.readBbCli());
    const cliMapped = cli === null ? {} : mapBbPreferences(cli);
    if (Object.keys(cliMapped).length > 0) {
      source = "cli";
      mapped = cliMapped;
    }
  }

  const keys: PreferenceKey[] = [];
  for (const [key, value] of Object.entries(mapped) as [PreferenceKey, unknown][]) {
    if (await deps.store.isStored(key)) continue;
    if (JSON.stringify(value) === JSON.stringify(preferenceDefault(key))) continue;
    await deps.store.write(key, value);
    keys.push(key);
  }
  await deps.kv.set(IMPORT_MARKER_KEY, { source, keys, at: Date.now() });

  deps.log.info(
    source === "none"
      ? "no bb thread-list preferences found; using the defaults"
      : `imported bb thread-list preferences from ${source}: ${keys.join(", ") || "none differ from the defaults"}`,
  );
  return { status: source === "none" ? "defaults" : "imported", source, keys };
}
