/**
 * The literal keys of the Endpoints, kept in a file in the plugin's data
 * directory on the primary host that only its owner may read. The server never
 * holds a literal key: the page sends one to the host entry once, to be put
 * here, and every request reads it from here. The file holds no URL and no
 * other secret, and an Endpoint's key is deleted when the Endpoint stops
 * having one.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./private-file.js";

const KEYS_FILE = "keys.json";

/** Endpoint id to its literal key. */
const keysSchema = z.record(z.string(), z.string());
export type Keys = z.infer<typeof keysSchema>;

/** Reads the keys; a missing, unreadable or corrupt file reads as none. */
export async function readKeys(dataDir: string): Promise<Keys> {
  try {
    const parsed = keysSchema.safeParse(JSON.parse(await readFile(join(dataDir, KEYS_FILE), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Replaces the stored keys. */
export async function writeKeys(dataDir: string, keys: Keys): Promise<void> {
  await writePrivateFile(join(dataDir, KEYS_FILE), JSON.stringify(keys));
}
