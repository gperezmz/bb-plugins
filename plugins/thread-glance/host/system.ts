// The operating system as the host entry reaches it: running a command and
// reading files. `SystemAccess` is the port the probe works on; `nodeSystem`
// is the adapter and the only code here that spawns a process or opens a file.
import { execFile } from "node:child_process";
import { readdir, readFile, readlink, realpath } from "node:fs/promises";

export interface RunOptions {
  timeoutMs?: number;
  /** Give the command the worker's whole environment (Docker needs `DOCKER_HOST`, `HOME`); otherwise only `PATH`. */
  fullEnvironment?: boolean;
}

export interface SystemAccess {
  platform: NodeJS.Platform;
  /** This worker's PID and its parent's. */
  pid: number;
  ppid: number;
  /**
   * Runs `file` with `args`: no shell, the C locale, a time limit and a bound
   * on its output. Resolves to its output, also when it exits non-zero having
   * printed some (`lsof` does, for processes it may not inspect). Rejects with
   * a message that names the command and the reason only.
   */
  run(file: string, args: readonly string[], options?: RunOptions): Promise<string>;
  /** Rejects when the file cannot be read. */
  readFile(path: string): Promise<string>;
  /** The names in a directory. Rejects when it cannot be read. */
  readdir(path: string): Promise<string[]>;
  /** Rejects when the path is not a link or cannot be read. */
  readlink(path: string): Promise<string>;
  /** Rejects when the path cannot be resolved. */
  realpath(path: string): Promise<string>;
}

const COMMAND_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export const nodeSystem: SystemAccess = {
  platform: process.platform,
  pid: process.pid,
  ppid: process.ppid,
  run(file, args, options = {}) {
    const env = options.fullEnvironment
      ? { ...process.env, LC_ALL: "C" }
      : { PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" };
    return new Promise((resolve, reject) => {
      execFile(
        file,
        [...args],
        { timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env, encoding: "utf8", windowsHide: true },
        (error, stdout) => {
          if (error === null) return resolve(stdout);
          const { code, killed } = error as NodeJS.ErrnoException & { killed?: boolean };
          if (code === "ENOENT") return reject(new Error(`${file} is not installed`));
          if (killed === true) return reject(new Error(`${file} timed out`));
          if (typeof code === "number" && stdout.length > 0) return resolve(stdout);
          reject(new Error(`${file} failed`));
        },
      );
    });
  },
  readFile: (path) => readFile(path, "utf8"),
  readdir: (path) => readdir(path),
  readlink: (path) => readlink(path),
  realpath: (path) => realpath(path),
};
