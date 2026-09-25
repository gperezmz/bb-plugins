/**
 * The optional fields each endpoint URL and model refused, kept in a file
 * beside `endpoints.json` because bb stops the host entry's worker after a
 * few idle minutes. Keyed by the URL as the settings write it, so the file
 * holds no expanded `${NAME}` value and no key.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./endpoints.js";

const LEARNED_FILE = "learned-fields.json";

/** URL to model to the fields left out of its requests. */
const learnedSchema = z.record(z.string(), z.record(z.string(), z.array(z.string())));
export type LearnedFields = z.infer<typeof learnedSchema>;

/** Reads the learned fields; a missing, unreadable or corrupt file reads as none. */
export async function readLearned(dataDir: string): Promise<LearnedFields> {
  try {
    const parsed = learnedSchema.safeParse(JSON.parse(await readFile(join(dataDir, LEARNED_FILE), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Replaces the stored learned fields. */
export async function writeLearned(dataDir: string, learned: LearnedFields): Promise<void> {
  await writePrivateFile(join(dataDir, LEARNED_FILE), JSON.stringify(learned));
}
