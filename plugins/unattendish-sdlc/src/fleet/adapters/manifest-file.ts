// Reads the manager's manifest file from disk and hands its text to the domain.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ManifestFiles } from "../application/ports";
import { parseManifest, writtenSections } from "../domain/manifest";
import type { ManifestRead, WrittenSection } from "../domain/model";

/** A manifest longer than this is not read. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;

const unreadable = (reason: string): ManifestRead => ({ status: "unreadable", reason });

const parse = (text: string): ManifestRead => {
  try {
    return parseManifest(text);
  } catch {
    return unreadable("the manifest cannot be parsed");
  }
};

/** Reads `fleet/manifest.md` by absolute path. A reason names the path's problem and never quotes the file. */
export class FileManifests implements ManifestFiles {
  async read(path: string): Promise<ManifestRead> {
    const loaded = await this.load(path);
    return "read" in loaded ? loaded.read : parse(loaded.text);
  }

  async readSections(path: string): Promise<{ readonly read: ManifestRead; readonly written: readonly WrittenSection[] }> {
    const loaded = await this.load(path);
    if ("read" in loaded) return { read: loaded.read, written: [] };
    const read = parse(loaded.text);
    return { read, written: read.status === "ok" ? writtenSections(loaded.text) : [] };
  }

  private async load(path: string): Promise<{ readonly read: ManifestRead } | { readonly text: string }> {
    if (!isAbsolute(path)) return { read: unreadable("the manifest path is not absolute") };
    let text: string;
    try {
      const info = await stat(path);
      if (!info.isFile()) return { read: unreadable("the manifest path is not a file") };
      if (info.size > MAX_MANIFEST_BYTES) return { read: unreadable("the manifest is over 1 MiB") };
      const bytes = await readFile(path);
      if (bytes.byteLength > MAX_MANIFEST_BYTES) return { read: unreadable("the manifest is over 1 MiB") };
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { read: { status: "missing" } };
      if (error instanceof TypeError) return { read: unreadable("the manifest is not valid UTF-8") };
      return { read: unreadable(`the manifest cannot be read${typeof code === "string" ? ` (${code})` : ""}`) };
    }
    return { text };
  }
}
