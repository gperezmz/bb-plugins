/**
 * The literal keys of the Endpoints, kept in a file in the plugin's data
 * directory on the primary host that only its owner may read. The server never
 * keeps a literal key: it hands one to the host entry once, to be put here, and
 * every request reads it from here. Each key is kept with the URL it was typed
 * for, as the Endpoint holds it, and is used only for that URL, so a key never
 * reaches another server even while a change to the Endpoint is half applied.
 * An Endpoint's key is deleted when the Endpoint stops having one.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./private-file.js";

const KEYS_FILE = "keys.json";

/** Endpoint id to its literal key and the URL the key was typed for. */
const keysSchema = z.record(z.string(), z.object({ url: z.string(), key: z.string() }).strict());
export type Keys = z.infer<typeof keysSchema>;

/**
 * Reads the keys; a file that is missing reads as none.
 *
 * Throws:
 *   Error: The file exists and cannot be read or parsed. A caller that goes on
 *     to write would replace every key in it.
 */
export async function readKeys(dataDir: string): Promise<Keys> {
  let text: string;
  try {
    text = await readFile(join(dataDir, KEYS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return keysSchema.parse(JSON.parse(text));
}

/** Replaces the stored keys. */
export async function writeKeys(dataDir: string, keys: Keys): Promise<void> {
  await writePrivateFile(join(dataDir, KEYS_FILE), JSON.stringify(keys));
}
