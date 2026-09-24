// Child processes for the host entry: bounded output, timeouts, cancellation
// and the two git-env modes.
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type EnvMode = "raw" | "as-agents";

const MAX_OUTPUT = 256 * 1024;

/** Variables `raw` mode removes: bb's built-in git and commit identity. */
export function isBuiltInGitVar(name: string): boolean {
  return (
    name === "GH_TOKEN" ||
    name === "GITHUB_TOKEN" ||
    name === "GH_ENTERPRISE_TOKEN" ||
    name === "GIT_CONFIG_COUNT" ||
    name.startsWith("GIT_CONFIG_KEY_") ||
    name.startsWith("GIT_CONFIG_VALUE_") ||
    name.startsWith("GIT_AUTHOR_") ||
    name.startsWith("GIT_COMMITTER_")
  );
}

/**
 * The environment for one call. Every call disables git and gh prompts; `raw`
 * also strips bb's built-in git so the answer is about the machine itself.
 */
export function envFor(mode: EnvMode, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (name.startsWith("BB_")) continue;
    if (mode === "raw" && isBuiltInGitVar(name)) continue;
    env[name] = value;
  }
  delete env.GH_FORCE_TTY;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "never";
  env.GH_PROMPT_DISABLED = "1";
  env.GH_NO_UPDATE_NOTIFIER = "1";
  env.GH_SPINNER_DISABLED = "1";
  env.NO_COLOR = "1";
  return env;
}

export interface RunOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  input?: string;
  onStderr?: (chunk: string) => void;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  notFound: boolean;
}

export type Runner = (command: string, args: readonly string[], options: RunOptions) => Promise<RunResult>;

/** Runs a program without a shell. Resolves on exit; never rejects. */
export const runProcess: Runner = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], {
        env: options.env,
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (cause) {
      resolve({ exitCode: 127, stdout: "", stderr: String(cause), timedOut: false, notFound: true });
      return;
    }
    const kill = () => {
      if (child.exitCode === null) child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 3000).unref();
    };
    const onAbort = () => kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: 127,
        stdout,
        stderr: stderr + String(error.message),
        timedOut,
        notFound: error.code === "ENOENT",
      });
    });
    child.on("close", (code, signal) => {
      finish({
        exitCode: code ?? (signal === null ? 1 : 128 + 15),
        stdout,
        stderr,
        timedOut,
        notFound: false,
      });
    });
    child.stdin?.on("error", () => {});
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });

/** Finds a program on PATH without running a shell. */
export function which(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** Joins stdout and stderr, bounded, for the in-memory "Show details" view. */
export function combined(result: RunResult): string {
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return text.length > 16_000 ? `${text.slice(0, 16_000)}\n…` : text;
}

/** Single-quotes a path for a shell-interpreted string such as core.sshCommand. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
