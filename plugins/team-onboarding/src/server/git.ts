// git and gh on the server machine, from the server process: skills sources.
// Uses the server's own git credentials and gh login. Raw output stays in
// memory.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { lookup } from "node:dns/promises";
import { classifyLsRemote, type AccessCategory } from "../core/redact.js";
import { assertPublicUrl, InternalHostError } from "./netguard.js";
import { combined, envFor, runProcess, shellQuote, which, type RunResult, type Runner } from "../host/exec.js";
import { byEngineer } from "./interaction.js";
import { emptyDir } from "../host/ops.js";
import { count } from "./meter.js";

export interface GitDeps {
  run: Runner;
  env: NodeJS.ProcessEnv;
  /** DNS lookup for the public-host check; tests may replace it. */
  resolve?: typeof lookup;
  /** The plugin's own data folder, for the empty folder background git runs from. */
  dataDir: () => string;
}

/** Local paths or public hosts only (see src/core/netguard.ts). */
async function publicOnly(url: string, resolve?: typeof lookup): Promise<void> {
  try {
    await assertPublicUrl(url, resolve);
  } catch (error) {
    if (error instanceof InternalHostError) throw new GitError("blocked", error.message, "");
    throw error;
  }
}

export function defaultGitDeps(dataDir: GitDeps["dataDir"]): GitDeps {
  const run: Runner = (command, args, options) => {
    count("spawn:server");
    return runProcess(command, args, options);
  };
  return { run, env: process.env, dataDir };
}

export class GitError extends Error {
  constructor(
    readonly category: AccessCategory | "needs-login" | "not-found" | "blocked",
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

export function createGit(deps: GitDeps) {
  const env = () => {
    const base = envFor("as-agents", deps.env);
    if (byEngineer()) {
      base.GIT_SSH_COMMAND = base.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=10";
    } else {
      // In the background none of the user's git or ssh config (an insteadOf,
      // fsmonitor, hooks, `Match exec`) and no SSH agent, which can ask for
      // approval even in batch mode. Keys in files still work.
      base.GIT_CONFIG_GLOBAL = "/dev/null";
      base.GIT_CONFIG_NOSYSTEM = "1";
      for (const name of Object.keys(base)) if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(name)) delete base[name];
      base.GIT_SSH_COMMAND = "ssh -F /dev/null -o BatchMode=yes -o IdentityAgent=none -o ConnectTimeout=10";
    }
    base.SSH_ASKPASS_REQUIRE = "never";
    delete base.GIT_ASKPASS;
    delete base.SSH_ASKPASS;
    return base;
  };
  /**
   * Unless the engineer started the work, git asks no credential helper but
   * gh's, which reads gh's stored login or GH_TOKEN and never prompts: a
   * Mac's keychain helper could. GitHub ssh URLs are fetched over HTTPS
   * through that helper, as bb itself does on other machines. Private GitHub
   * sources keep working; other private hosts wait for a click in the page.
   */
  const credentialArgs = (): string[] => {
    if (byEngineer()) return [];
    const gh = which("gh", env());
    return [
      "-c", "credential.helper=",
      ...(gh === null ? [] : ["-c", `credential.helper=!${shellQuote(gh)} auth git-credential`]),
      "-c", "url.https://github.com/.insteadOf=git@github.com:",
      "-c", "url.https://github.com/.insteadOf=ssh://git@github.com/",
    ];
  };
  // No HTTP redirects: a public host could otherwise send git to an internal one.
  // In the background, commands without a folder of their own run from an
  // empty one: the server's working directory may be a repository.
  const git = async (args: string[], options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {}) =>
    deps.run("git", ["-c", "http.followRedirects=false", "-c", "core.askPass=", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...credentialArgs(), ...args], {
      env: env(),
      cwd: options.cwd ?? (byEngineer() ? undefined : await emptyDir(deps.dataDir())),
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 120_000,
      input: "",
    });
  const must = (result: RunResult, what: string) => {
    if (result.exitCode === 0) return result;
    const category = classifyLsRemote(result.exitCode, result.stderr);
    throw new GitError(category, `${what} failed (${category})`, combined(result));
  };

  return {
    /** The commit a ref points at, or null when the ref doesn't exist. */
    async lsRemote(url: string, ref: string | null, signal?: AbortSignal): Promise<string | null> {
      await publicOnly(url, deps.resolve);
      if (ref !== null && /^[0-9a-f]{40}$/.test(ref)) return ref;
      const result = must(await git(["ls-remote", "--", url, ref ?? "HEAD"], { signal, timeoutMs: 45_000 }), "git ls-remote");
      return pickRef(result.stdout, ref);
    },

    /** Tag names on the remote, to tell a pinned tag from a tracked branch. */
    async remoteTags(url: string, signal?: AbortSignal): Promise<string[]> {
      await publicOnly(url, deps.resolve);
      const result = await git(["ls-remote", "--tags", "--", url], { signal, timeoutMs: 45_000 });
      if (result.exitCode !== 0) return [];
      return result.stdout
        .split("\n")
        .map((line) => /refs\/tags\/(.+?)(\^\{\})?$/.exec(line)?.[1])
        .filter((tag): tag is string => tag !== undefined);
    },

    /**
     * A shallow, blob-less, sparse checkout of `patterns` at `ref` in a
     * temporary directory. The caller removes it with `cleanup`.
     */
    async sparseClone(
      url: string,
      ref: string | null,
      patterns: string[],
      signal?: AbortSignal,
    ): Promise<{ dir: string; commit: string; cleanup: () => Promise<void> }> {
      await publicOnly(url, deps.resolve);
      const parent = await mkdtemp(join(tmpdir(), "bb-onboarding-src-"));
      const dir = join(parent, "src");
      const cleanup = () => rm(parent, { recursive: true, force: true });
      try {
        const isSha = ref !== null && /^[0-9a-f]{40}$/.test(ref);
        const cloneArgs = ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout"];
        if (ref !== null && !isSha) cloneArgs.push("--branch", ref);
        must(await git([...cloneArgs, "--", url, dir], { signal }), "git clone");
        if (isSha) {
          must(await git(["fetch", "--quiet", "--depth", "1", "origin", ref], { cwd: dir, signal }), "git fetch");
          must(await git(["update-ref", "HEAD", ref], { cwd: dir, signal }), "git update-ref");
        }
        must(await git(["sparse-checkout", "set", "--no-cone", ...patterns], { cwd: dir, signal }), "git sparse-checkout");
        must(await git(["checkout", "--quiet", isSha ? ref : "HEAD"], { cwd: dir, signal }), "git checkout");
        const head = must(await git(["rev-parse", "HEAD"], { cwd: dir, signal }), "git rev-parse");
        return { dir, commit: head.stdout.trim(), cleanup };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },

    /** The git tree id of `path` at `commit` in a checkout. */
    async treeId(dir: string, commit: string, path: string): Promise<string | null> {
      const result = await git(["rev-parse", `${commit}:${path}`], { cwd: dir, timeoutMs: 15_000 });
      return result.exitCode === 0 ? result.stdout.trim() : null;
    },
  };
}

export type Git = ReturnType<typeof createGit>;

/** The commit for `ref` in `git ls-remote` output: branch, then peeled tag, then tag. */
export function pickRef(output: string, ref: string | null): string | null {
  const rows = output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((row): row is [string, string] => row.length === 2);
  const find = (name: string) => rows.find(([, refName]) => refName === name)?.[0] ?? null;
  if (ref === null) return find("HEAD");
  return (
    find(`refs/heads/${ref}`) ??
    find(`refs/tags/${ref}^{}`) ??
    find(`refs/tags/${ref}`) ??
    find(ref) ??
    null
  );
}

/** Sparse patterns for a list of skill folder globs: everything under each static prefix. */
export function sparsePatterns(globs: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const glob of globs) {
    const trimmed = glob.replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (trimmed === "" || trimmed === ".") {
      patterns.add("/*");
      continue;
    }
    const segments: string[] = [];
    for (const segment of trimmed.split("/")) {
      if (/[*?[]/.test(segment)) break;
      segments.push(segment);
    }
    patterns.add(segments.length === 0 ? "/*" : `/${segments.join("/")}/`);
  }
  return [...patterns];
}
