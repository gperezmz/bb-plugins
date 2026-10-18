/** Files only the plugin's owner may read, in the plugin's data directory. */
import { chmod, rename, writeFile } from "node:fs/promises";

/** Replaces `file` in one step, with a file only its owner may read. */
export async function writePrivateFile(file: string, text: string): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}
