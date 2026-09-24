// The team manifest is a file provisioned on the bb server, never fetched:
// a manifest URL can sit behind credentials, and a file an admin or a
// provisioning script puts in place needs none.
//
// The default place is `<bb data dir>/team-onboarding/onboarding.yaml`. The
// "Manifest file" setting may name another absolute path, but only to a file
// called `onboarding.yaml` or `onboarding.yml`: the setting is reachable from
// `bb plugin config set`, and validation messages can quote the file, so it
// must not become a way to read other files on the server.
import { createHash, randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";

/** The largest manifest read; the parser refuses more too. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

const FILE_NAME = /^onboarding\.ya?ml$/;

export function defaultManifestPath(dataDir: string): string {
  return join(dataDir, "team-onboarding", "onboarding.yaml");
}

/** Why a "Manifest file" setting can't be used, or null when it can. */
export function manifestPathProblem(value: string): string | null {
  const path = value.trim();
  if (path === "") return null;
  if (path.includes("\0") || path.length > 4096) return "Use an absolute path.";
  if (!isAbsolute(path)) return "Use an absolute path on the bb server, e.g. /etc/bb/onboarding.yaml.";
  if (path.split("/").includes("..")) return "Use a path without '..'.";
  if (path.endsWith("/")) return "Name the file, not a folder.";
  if (!FILE_NAME.test(basename(path))) return "The file must be called onboarding.yaml or onboarding.yml.";
  return null;
}

/** Where the plugin looks: the setting when it is usable, else the default. */
export function resolveManifestPath(setting: string, dataDir: string): string {
  const path = setting.trim();
  return path !== "" && manifestPathProblem(path) === null ? normalize(path) : defaultManifestPath(dataDir);
}

export interface ManifestFile {
  path: string;
  exists: boolean;
  /** sha256 of the contents, the manifest's version. */
  sha: string | null;
  mtime: string | null;
  text: string | null;
  /** Why the file couldn't be read, e.g. too large or not a regular file. */
  problem: string | null;
}

/**
 * Reads the manifest file. A symlink is followed only to a file that is also
 * called onboarding.yaml or .yml, or into the Nix store (home-manager links
 * files there), so the name rule can't be sidestepped to read another file;
 * what it names must be a regular file.
 */
export async function readManifestFile(path: string): Promise<ManifestFile> {
  const none = { path, exists: false, sha: null, mtime: null, text: null, problem: null };
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      const target = await realpath(path).catch(() => null);
      if (target !== null && !FILE_NAME.test(basename(target)) && !target.startsWith("/nix/store/")) {
        return { ...none, exists: true, problem: "It is a symlink to a file that isn't called onboarding.yaml; point the setting at the file itself." };
      }
    }
  } catch {
    // Missing: stat below says so.
  }
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return none;
    return { ...none, problem: "The file can't be read." };
  }
  if (!info.isFile()) return { ...none, exists: true, problem: "It isn't a regular file." };
  if (info.size > MAX_MANIFEST_BYTES) return { ...none, exists: true, problem: "It is larger than 256 KiB." };
  // A hard link is another name for some other file, like a symlink: refused
  // outside the Nix store, which links identical files together itself.
  if (info.nlink > 1) {
    const real = await realpath(path).catch(() => path);
    if (!real.startsWith("/nix/store/")) return { ...none, exists: true, problem: "It has other hard links; install a copy with bb team-onboarding manifest install." };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return { ...none, exists: true, problem: "The file can't be read." };
  }
  return {
    path,
    exists: true,
    sha: createHash("sha256").update(bytes).digest("hex"),
    mtime: info.mtime.toISOString(),
    text: bytes.toString("utf8"),
    problem: null,
  };
}

/**
 * Writes a manifest atomically: a temporary file in the same folder, mode
 * 0644, then a rename over the old one, so a reader sees the old file or the
 * new one, never half of either. It never writes through a symlink.
 */
export async function writeManifestFile(path: string, text: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`${path} is a symlink, managed outside bb; replace what it points to instead.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temp = join(dirname(path), `.onboarding.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o644, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Calls `onChange` soon after the file may have changed. Watches its folder
 * (the file itself may not exist yet, and a rename replaces it); when the
 * folder doesn't exist or can't be watched, the scheduled check still reads
 * the file each tick.
 */
export function watchManifestFile(path: string, onChange: () => void): { stop: () => void; active: () => boolean } {
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  try {
    watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
      if (name !== null && name !== basename(path)) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, 300);
      timer.unref?.();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
  return {
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      watcher?.close();
      watcher = null;
    },
    // A folder that didn't exist yet, or a watch that failed: the tick tries again.
    active: () => watcher !== null,
  };
}
