// Reads the manager's manifest file from disk and hands its text to the domain.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ManifestFiles } from "../application/ports";
import { parseManifest } from "../domain/manifest";
import type { ManifestRead } from "../domain/model";

/** A manifest longer than this is not read. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;

const unreadable = (reason: string): ManifestRead => ({ status: "unreadable", reason });

/** Reads `fleet/manifest.md` by absolute path. A reason names the path's problem and never quotes the file. */
export class FileManifests implements ManifestFiles {
  async read(path: string): Promise<ManifestRead> {
    if (!isAbsolute(path)) return unreadable("the manifest path is not absolute");
    let text: string;
    try {
      const info = await stat(path);
      if (!info.isFile()) return unreadable("the manifest path is not a file");
      if (info.size > MAX_MANIFEST_BYTES) return unreadable("the manifest is over 1 MiB");
      const bytes = await readFile(path);
      if (bytes.byteLength > MAX_MANIFEST_BYTES) return unreadable("the manifest is over 1 MiB");
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { status: "missing" };
      if (error instanceof TypeError) return unreadable("the manifest is not valid UTF-8");
      return unreadable(`the manifest cannot be read${typeof code === "string" ? ` (${code})` : ""}`);
    }
    try {
      return parseManifest(text);
    } catch {
      return unreadable("the manifest cannot be parsed");
    }
  }
}
