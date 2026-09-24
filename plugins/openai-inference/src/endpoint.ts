/**
 * Where each service sends its requests: the plugin's settings, else, for the
 * gateway, the `GATEWAY_URL` and `GATEWAY_VIRTUAL_KEY` variables in bb's
 * environment. The server hands the settings to the host entry, which keeps
 * them in a file only its user can read, so a restarted worker still has them.
 */
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { endpointSettingsByServiceSchema, type EndpointSettingsByService, type ServiceId } from "./contract.js";

export interface Endpoint {
  /** Base URL that `/chat/completions` is appended to, without a trailing slash. */
  baseUrl: string;
  apiKey: string | null;
}

export const NO_SETTINGS: EndpointSettingsByService = {
  gateway: { baseUrl: null, apiKey: null },
  local: { baseUrl: null, apiKey: null },
};

const SETTINGS_FILE = "endpoints.json";

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Resolves a service's endpoint, or returns why it has none.
 *
 * Args:
 *   serviceId: The service bb asked for.
 *   settings: The settings the server last sent.
 *   env: The host process's environment.
 */
export function resolveEndpoint(
  serviceId: ServiceId,
  settings: EndpointSettingsByService,
  env: Readonly<Record<string, string | undefined>>,
): Endpoint | { missing: string } {
  const own = settings[serviceId];
  const baseUrl =
    nonEmpty(own.baseUrl) ?? (serviceId === "gateway" ? nonEmpty(env.GATEWAY_URL) : null);
  const apiKey =
    nonEmpty(own.apiKey) ?? (serviceId === "gateway" ? nonEmpty(env.GATEWAY_VIRTUAL_KEY) : null);
  if (baseUrl === null) {
    return {
      missing:
        serviceId === "gateway"
          ? "No gateway URL: set GATEWAY_URL in bb's environment or the plugin's Gateway base URL setting."
          : "No local server URL: set the plugin's Local server base URL setting.",
    };
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** Reads the settings the server last sent; none sent yet reads as no settings. */
export async function readSettings(dataDir: string): Promise<EndpointSettingsByService> {
  try {
    const parsed = endpointSettingsByServiceSchema.safeParse(
      JSON.parse(await readFile(join(dataDir, SETTINGS_FILE), "utf8")),
    );
    return parsed.success ? parsed.data : NO_SETTINGS;
  } catch {
    return NO_SETTINGS;
  }
}

/** Replaces the stored settings; the file holds keys, so only its owner may read it. */
export async function writeSettings(dataDir: string, settings: EndpointSettingsByService): Promise<void> {
  const file = join(dataDir, SETTINGS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(settings), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}
