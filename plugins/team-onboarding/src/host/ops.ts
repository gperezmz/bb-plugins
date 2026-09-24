// The host entry's operations. Plain functions over injected dependencies, so
// the same code runs in the host worker, in the server process when the host
// entry can't load (server machine only), and in tests against scratch homes.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir as osHomedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyGhApi,
  classifyGhAuthStatus,
  classifyLoginNote,
  classifyLsRemote,
  classifySshTest,
  isEnvToken,
  parseDeviceCode,
} from "../core/redact.js";
import type { Probe } from "../contract/host.js";
import { combined, envFor, runProcess, shellQuote, which, type EnvMode, type Runner } from "./exec.js";

export interface OpsDeps {
  run: Runner;
  /** The daemon's environment (BB_* already stripped by bb). */
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  passwdHome: () => string;
  emitDeviceCode: (payload: { loginId: string; code: string; url: string }) => Promise<void>;
  /** The plugin's own data folder on this machine (the host entry's `experimental_paths.dataDir`). */
  dataDir: () => string;
}

export function defaultDeps(emitDeviceCode: OpsDeps["emitDeviceCode"], dataDir: OpsDeps["dataDir"]): OpsDeps {
  return {
    run: runProcess,
    env: process.env,
    homedir: osHomedir,
    passwdHome: () => {
      try {
        return userInfo().homedir;
      } catch {
        return osHomedir();
      }
    },
    emitDeviceCode,
    dataDir,
  };
}

/** Where the plugin keeps its SSH files, always absolute. */
export function sshPaths(home: string) {
  const dir = join(home, ".ssh");
  return {
    dir,
    keyPath: join(dir, "bb_ed25519"),
    knownHostsPath: join(dir, "bb_known_hosts"),
    configPath: join(dir, "bb_config"),
  };
}

/** The plugin-owned SSH config, which `Include`s the user's own config last. */
export function sshConfigText(input: { host: string; keyPath: string; knownHostsPath: string; include: string | null }): string {
  return [
    "# Written by bb Team Onboarding. git uses it through core.sshCommand;",
    "# your ~/.ssh/config is never edited.",
    `Host ${input.host}`,
    `  HostName ${input.host}`,
    "  User git",
    `  IdentityFile ${input.keyPath}`,
    "  IdentitiesOnly yes",
    `  UserKnownHostsFile ${input.knownHostsPath}`,
    "  StrictHostKeyChecking yes",
    input.include === null ? "" : `\n# Everything else keeps using your own SSH config.\nInclude ${input.include}\n`,
  ].join("\n");
}

const SHORT = 30_000;

export function createOps(deps: OpsDeps) {
  const env = (mode: EnvMode) => {
    const base = envFor(mode, deps.env);
    base.HOME = deps.homedir();
    return base;
  };
  const run = (
    command: string,
    args: readonly string[],
    mode: EnvMode,
    options: { timeoutMs?: number; signal?: AbortSignal; cwd?: string; input?: string; onStderr?: (chunk: string) => void; env?: NodeJS.ProcessEnv } = {},
  ) =>
    deps.run(command, args, {
      env: options.env ?? env(mode),
      timeoutMs: options.timeoutMs ?? SHORT,
      signal: options.signal,
      cwd: options.cwd ?? deps.homedir(),
      input: options.input,
      onStderr: options.onStderr,
    });

  const gitGet = async (key: string, mode: EnvMode = "raw"): Promise<string | null> => {
    const result = await run("git", ["config", "--global", "--get", key], mode);
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  };

  /**
   * git's env for a check. On a click: the user's own config and ssh command,
   * with our options right after the program, since ssh keeps the first
   * value it sees and a `-o BatchMode=no` in the user's command must lose.
   * In the background: none of the user's git config (no insteadOf,
   * fsmonitor, hooks or `env …` ssh command can interfere) and ssh with
   * only the plugin's own settings, no ~/.ssh/config and no SSH agent,
   * which can prompt even in batch mode.
   */
  const gitEnv = async (mode: EnvMode, engineer: boolean) => {
    const base = env(mode);
    base.SSH_ASKPASS_REQUIRE = "never";
    delete base.SSH_ASKPASS;
    if (!engineer) {
      base.GIT_CONFIG_GLOBAL = "/dev/null";
      base.GIT_CONFIG_NOSYSTEM = "1";
      base.GIT_SSH_COMMAND = await backgroundSsh();
      return base;
    }
    const sshCommand = (await gitGet("core.sshCommand", mode)) ?? "ssh";
    const options = "-o BatchMode=yes -o ConnectTimeout=10";
    const split = /^('[^']*'|"[^"]*"|\S+)(.*)$/s.exec(sshCommand.trim());
    base.GIT_SSH_COMMAND = split === null ? `ssh ${options}` : `${split[1]} ${options}${split[2]}`;
    return base;
  };

  /** ssh with only the plugin's settings: its key and pinned hosts, else ssh's defaults. */
  const backgroundSsh = async () => {
    const paths = sshPaths(deps.homedir());
    const knownHosts = [paths.knownHostsPath, join(deps.passwdHome(), ".ssh", "known_hosts")].join(" ");
    const options = [
      "-F", "/dev/null",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "IdentityAgent=none",
      "-o", "StrictHostKeyChecking=yes",
      "-o", shellQuote(`UserKnownHostsFile=${knownHosts}`),
      ...((await exists(paths.keyPath)) ? ["-o", shellQuote(`IdentityFile=${paths.keyPath}`)] : []),
    ];
    return `ssh ${options.join(" ")}`;
  };

  const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() || null;

  /**
   * Every value in the global git config by key, in file order, as
   * `git config --global --get-all` would give them: section and variable
   * names lower-case, subsections as written. Empty when there is none.
   */
  const gitGlobalValues = async (): Promise<Map<string, string[]>> => {
    const result = await run("git", ["config", "--global", "--list", "-z"], "raw");
    const values = new Map<string, string[]>();
    if (result.exitCode !== 0) return values;
    for (const entry of result.stdout.split("\0")) {
      if (entry === "") continue;
      const newline = entry.indexOf("\n");
      const key = newline === -1 ? entry : entry.slice(0, newline);
      values.set(key, [...(values.get(key) ?? []), newline === -1 ? "" : entry.slice(newline + 1)]);
    }
    return values;
  };

  /**
   * The file `git config --global` writes: `$GIT_CONFIG_GLOBAL`, else
   * `~/.gitconfig`, else the XDG file when only that one exists (git's rule).
   */
  const gitGlobalFile = async (): Promise<string> => {
    const raw = env("raw");
    if (raw.GIT_CONFIG_GLOBAL) return raw.GIT_CONFIG_GLOBAL;
    const home = deps.homedir();
    const dotfile = join(home, ".gitconfig");
    const xdg = join(raw.XDG_CONFIG_HOME || join(home, ".config"), "git", "config");
    if (await exists(dotfile)) return dotfile;
    return (await exists(xdg)) ? xdg : dotfile;
  };

  /**
   * Whether git uses gh for HTTPS to `host` without bb's env, read from git
   * config only (`--get-urlmatch`, git's own URL rules). No credential helper
   * is ever run: on a Mac a keychain helper could prompt on every scheduled
   * check.
   */
  const credentialReady = async (host: string): Promise<boolean> => {
    const out = await run("git", ["config", "--get-urlmatch", "credential.helper", `https://${host}`], "raw");
    return out.exitCode === 0 && GH_HELPER.test(out.stdout.trim());
  };

  /** gh's own directory, where `hosts.yml` keeps a stored login. */
  const ghConfigDir = () => {
    const raw = env("raw");
    if (raw.GH_CONFIG_DIR) return raw.GH_CONFIG_DIR;
    return join(raw.XDG_CONFIG_HOME || join(deps.homedir(), ".config"), "gh");
  };

  return {
    async probe(): Promise<Probe> {
      const home = deps.homedir();
      const paths = sshPaths(home);
      const raw = env("raw");
      const ghPath = which("gh", raw);
      const [gh, git, ssh] = await Promise.all([
        ghPath === null ? null : run(ghPath, ["--version"], "raw"),
        run("git", ["--version"], "raw"),
        run("ssh", ["-V"], "raw"),
      ]);
      let keyMode: number | null = null;
      let keyExists = false;
      try {
        const info = await stat(paths.keyPath);
        keyExists = info.isFile();
        keyMode = info.mode & 0o777;
      } catch {
        // No key.
      }
      const readText = async (path: string) => {
        try {
          return await readFile(path, "utf8");
        } catch {
          return null;
        }
      };
      const knownHosts = (await readText(paths.knownHostsPath)) ?? "";
      // One read of the global git config for every value below, rather
      // than a git process per key.
      const config = await gitGlobalValues();
      const last = (key: string) => config.get(key)?.at(-1)?.trim() || null;
      const helpers = (config.get("credential.https://github.com.helper") ?? []).map((line) => line.trim()).filter(Boolean);
      const globalFile = await gitGlobalFile();
      return {
        platform: process.platform,
        arch: process.arch,
        user: safeUser(),
        homedir: home,
        passwdHome: deps.passwdHome(),
        ghPath,
        ghVersion: gh === null || gh.exitCode !== 0 ? null : /(\d+\.\d+\.\d+)/.exec(gh.stdout)?.[1] ?? null,
        gitVersion: git.exitCode === 0 ? /(\d+\.\d+\.\d+)/.exec(git.stdout)?.[1] ?? null : null,
        sshVersion: ssh.notFound ? null : firstLine(ssh.stderr || ssh.stdout),
        ssh: {
          keyPath: paths.keyPath,
          keyExists,
          keyMode,
          publicKey: (await readText(`${paths.keyPath}.pub`))?.trim() ?? null,
          knownHostsPath: paths.knownHostsPath,
          knownHostsLines: knownHosts.split("\n").map((line) => line.trim()).filter(Boolean),
          configPath: paths.configPath,
          configText: await readText(paths.configPath),
          sshCommand: last("core.sshcommand"),
        },
        credentialHelper: helpers[helpers.length - 1] ?? null,
        gitGlobal: { path: globalFile, writable: await writable(globalFile) },
        sshDirWritable: await writable(paths.dir),
        userSshConfig: await exists(join(deps.passwdHome(), ".ssh", "config")),
        sshAgent: Boolean(env("raw").SSH_AUTH_SOCK),
        knownHostsWritable: await writable(paths.knownHostsPath),
        configWritable: await writable(paths.configPath),
        signing: {
          format: last("gpg.format"),
          signingKey: last("user.signingkey"),
        },
      };
    },

    async sshKeygen(input: { keyPath: string; comment: string }) {
      await refuseSymlink(dirname(input.keyPath));
      try {
        await stat(input.keyPath);
        return { created: false, publicKey: null, readOnlyFile: null };
      } catch {
        // Only create when no key exists.
      }
      if (!(await writable(dirname(input.keyPath)))) return { created: false, publicKey: null, readOnlyFile: dirname(input.keyPath) };
      await mkdir(dirname(input.keyPath), { recursive: true, mode: 0o700 });
      const result = await run(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-C", input.comment, "-f", input.keyPath],
        "raw",
        { input: "" },
      );
      if (result.exitCode !== 0) throw new Error(`ssh-keygen failed (exit ${result.exitCode})`);
      await chmod(input.keyPath, 0o600);
      return { created: true, publicKey: (await readFile(`${input.keyPath}.pub`, "utf8")).trim(), readOnlyFile: null };
    },

    async writeKnownHosts(input: { path: string; lines: string[] }) {
      await refuseSymlink(input.path);
      if (!(await writable(input.path))) return { written: 0, readOnlyFile: input.path };
      try {
        await mkdir(dirname(input.path), { recursive: true, mode: 0o700 });
        await writeFile(input.path, `${input.lines.join("\n")}\n`, { mode: 0o644 });
      } catch (error) {
        if (isReadOnlyError(error)) return { written: 0, readOnlyFile: input.path };
        throw error;
      }
      return { written: input.lines.length, readOnlyFile: null };
    },

    async writeSshConfig(input: { configPath: string; keyPath: string; knownHostsPath: string; host: string }) {
      await refuseSymlink(input.configPath);
      const sshCommand = `ssh -F ${shellQuote(input.configPath)}`;
      if (!(await writable(input.configPath))) return { written: false, sshCommand, readOnlyFile: input.configPath };
      const userConfig = join(deps.passwdHome(), ".ssh", "config");
      const include = (await exists(userConfig)) ? userConfig : null;
      const text = sshConfigText({ ...input, include });
      try {
        await mkdir(dirname(input.configPath), { recursive: true, mode: 0o700 });
        await writeFile(input.configPath, text, { mode: 0o600 });
        await chmod(input.configPath, 0o600);
      } catch (error) {
        if (isReadOnlyError(error)) return { written: false, sshCommand, readOnlyFile: input.configPath };
        throw error;
      }
      return { written: true, sshCommand, readOnlyFile: null };
    },

    async gitConfig(input: { op: "get" | "set"; key: string; value?: string }) {
      if (input.op === "get") return { value: await gitGet(input.key), readOnlyFile: null };
      if (input.value === undefined) throw new Error("gitConfig set needs a value");
      // A config managed elsewhere (home-manager links it from the Nix store)
      // is reported, not fought with.
      const file = await gitGlobalFile();
      if (!(await writable(file))) return { value: null, readOnlyFile: file };
      const result = await run("git", ["config", "--global", input.key, input.value], "raw");
      if (result.exitCode !== 0) {
        if (/read-only file system|permission denied/i.test(result.stderr)) return { value: null, readOnlyFile: file };
        // Another git holds config.lock: busy, not read-only.
        if (/could not lock config file/i.test(result.stderr)) throw new Error("git config is locked by another git process; try again");
        throw new Error(`git config failed (exit ${result.exitCode})`);
      }
      return { value: input.value, readOnlyFile: null };
    },

    async sshTest(input: { configPath: string; keyPath: string; knownHostsPath: string; host: string; userConfig?: boolean }) {
      const result = await run(
        "ssh",
        [
          // In the background, none of ~/.ssh/config (the plugin's config
          // Includes it): its Match exec or ProxyCommand could open a window.
          "-F", input.userConfig === true ? input.configPath : "/dev/null",
          "-i", input.keyPath,
          "-o", `UserKnownHostsFile=${input.knownHostsPath}`,
          "-o", "IdentitiesOnly=yes",
          "-o", "StrictHostKeyChecking=yes",
          "-o", "BatchMode=yes",
          // The key under test is a file; the user's agent could prompt.
          "-o", "IdentityAgent=none",
          "-o", "ConnectTimeout=10",
          "-T", `git@${input.host}`,
        ],
        "raw",
        { input: "", env: quietSshEnv(env("raw")) },
      );
      const classified = classifySshTest(result.exitCode, result.stdout, result.stderr);
      return { exitCode: result.exitCode, output: combined(result), ...classified };
    },

    async lsRemote(input: { url: string; ref?: string; mode: EnvMode; helpers?: boolean }, signal?: AbortSignal) {
      if (input.url.startsWith("-")) throw new Error("invalid url");
      // No HTTP redirects: a public host could send git to an internal one.
      // Never an askpass program (GIT_TERMINAL_PROMPT=0 is always set).
      const args = ["-c", "http.followRedirects=false", "-c", "core.askPass=", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
      const lsEnv = await gitEnv(input.mode, input.helpers === true);
      delete lsEnv.GIT_ASKPASS;
      delete lsEnv.SSH_ASKPASS;
      // No credential helper unless the engineer started the check: on a Mac
      // a keychain helper can prompt. An empty helper clears the list, bb's
      // own included, since -c comes after GIT_CONFIG_*.
      if (input.helpers !== true) args.push("-c", "credential.helper=");
      args.push("ls-remote", "--", input.url);
      if (input.ref !== undefined) args.push(input.ref);
      // In the background, from an empty folder: a repository in $HOME (dotfiles)
      // would bring its own config.
      const cwd = input.helpers === true ? undefined : await emptyDir(deps.dataDir());
      const result = await run("git", args, input.mode, { env: lsEnv, signal, timeoutMs: 45_000, cwd });
      const sha = result.exitCode === 0 ? /^([0-9a-f]{40})\s/m.exec(result.stdout)?.[1] ?? null : null;
      const category =
        result.exitCode === 0 && input.ref !== undefined && sha === null ? "ref-missing" : classifyLsRemote(result.exitCode, result.stderr);
      return { exitCode: result.exitCode, output: combined(result), category, sha };
    },

    async ghStatus(input: { host: string }) {
      const gh = which("gh", env("raw"));
      if (gh === null) {
        return { exitCode: 127, output: "gh not found on PATH", installed: false, stdout: "", credentialHelper: null, credentialReady: false };
      }
      const result = await run(gh, ["auth", "status", "--json", "hosts"], "raw");
      const helper = await run("git", ["config", "--global", "--get-all", `credential.https://${input.host}.helper`], "raw");
      const helpers = helper.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
      return {
        exitCode: result.exitCode,
        output: combined(result),
        installed: true,
        stdout: result.stdout,
        credentialHelper: helpers[helpers.length - 1] ?? null,
        credentialReady: await credentialReady(input.host),
      };
    },

    async ghAgentsStatus(input: { host: string }) {
      const agentsEnv = env("as-agents");
      const gh = which("gh", agentsEnv);
      if (gh === null) return { exitCode: 127, output: "gh not found on PATH", installed: false, stdout: "" };
      const result = await run(gh, ["auth", "status", "--json", "hosts", "--hostname", input.host], "as-agents");
      return { exitCode: result.exitCode, output: combined(result), installed: true, stdout: result.stdout };
    },

    async ghSetupGit(input: { host: string }) {
      const raw = env("raw");
      const gh = which("gh", raw);
      if (gh === null) return { exitCode: 127, output: "gh not found on PATH", credentialReady: false, skipped: false };
      if (await credentialReady(input.host)) {
        return { exitCode: 0, output: "git config already uses gh's credential helper for this host; gh auth setup-git wasn't needed.", credentialReady: true, skipped: true };
      }
      // The helper path is baked into git config: point it at the PATH entry,
      // not a versioned store path that breaks on upgrade.
      raw.GH_PATH = gh;
      const result = await run(gh, ["auth", "setup-git", "--hostname", input.host], "raw", { env: raw });
      return { exitCode: result.exitCode, output: combined(result), credentialReady: await credentialReady(input.host), skipped: false };
    },

    async ghApiRepo(input: { host: string; repo: string; mode?: EnvMode }) {
      const mode = input.mode ?? "raw";
      const gh = which("gh", env(mode));
      if (gh === null) return { exitCode: 127, output: "gh not found on PATH", category: "no-auth", ssoUrl: null };
      const result = await run(gh, ["api", "-i", "--silent", "--hostname", input.host, `repos/${input.repo}`], mode);
      const ssoUrl = /^x-github-sso:.*\burl=([^;\s]+)/im.exec(result.stdout)?.[1] ?? null;
      return {
        exitCode: result.exitCode,
        output: combined(result),
        category: classifyGhApi(result.exitCode, result.stdout, result.stderr),
        ssoUrl: ssoUrl !== null && /^https:\/\//.test(ssoUrl) ? ssoUrl : null,
      };
    },

    async ghSshKeyAdd(input: { host: string; publicKeyPath: string; title: string; type: "authentication" | "signing" }) {
      const raw = env("raw");
      const gh = which("gh", raw);
      if (gh === null) return { exitCode: 127, output: "gh not found on PATH", ok: false };
      raw.GH_HOST = input.host;
      const result = await run(gh, ["ssh-key", "add", input.publicKeyPath, "--title", input.title, "--type", input.type], "raw", { env: raw });
      return { exitCode: result.exitCode, output: combined(result), ok: result.exitCode === 0 };
    },

    async signingTest(input: { keyPath: string }) {
      // Only bb's own key file is tested. A key of the user's may sign
      // through their program (1Password's op-ssh-sign, say) or need a
      // passphrase, and a scheduled check must not make either prompt.
      const configured = await gitGet("user.signingkey");
      if (configured !== null && configured !== `${input.keyPath}.pub` && configured !== input.keyPath) {
        return { exitCode: 0, output: "Commits are signed with a key of your own; the plugin doesn't test it.", ok: true, skipped: true };
      }
      const dir = await mkdtemp(join(tmpdir(), "bb-onboarding-sign-"));
      try {
        const publicKey = (await readFile(`${input.keyPath}.pub`, "utf8")).trim();
        const allowed = join(dir, "allowed_signers");
        await writeFile(allowed, `bb-onboarding@localhost ${publicKey}\n`);
        // Plain ssh-keygen with the private key file (no agent, no askpass,
        // no display), and none of the user's hooks.
        // None of the user's git config either (fsmonitor, hooks, insteadOf).
        const signEnv = quietSshEnv(env("raw"));
        delete signEnv.SSH_AUTH_SOCK;
        delete signEnv.DISPLAY;
        signEnv.GIT_CONFIG_GLOBAL = "/dev/null";
        signEnv.GIT_CONFIG_NOSYSTEM = "1";
        const opts = { cwd: dir, env: signEnv };
        const git = (args: string[]) => run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], "raw", opts);
        await git(["init", "-q"]);
        const commit = await git([
          "-c", "user.name=bb onboarding",
          "-c", "user.email=bb-onboarding@localhost",
          "-c", "gpg.format=ssh",
          "-c", "gpg.ssh.program=ssh-keygen",
          "-c", `user.signingkey=${input.keyPath}`,
          "commit", "-q", "--no-verify", "--allow-empty", "-S", "-m", "signing test",
        ]);
        if (commit.exitCode !== 0) return { exitCode: commit.exitCode, output: combined(commit), ok: false, skipped: false };
        const verify = await git(["-c", "gpg.format=ssh", "-c", "gpg.ssh.program=ssh-keygen", "-c", `gpg.ssh.allowedSignersFile=${allowed}`, "verify-commit", "HEAD"]);
        return { exitCode: verify.exitCode, output: combined(verify), ok: verify.exitCode === 0, skipped: false };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async startDeviceLogin(
      input: { loginId: string; host: string; scopes: string[]; flow: "login" | "refresh" },
      signal?: AbortSignal,
    ) {
      const raw = env("raw");
      const gh = which("gh", raw);
      if (gh === null) return { exitCode: 127, output: "gh not found on PATH", ok: false, setupGit: false, login: null, note: null };
      // gh can save the login and still exit non-zero (a read-only config.yml
      // from home-manager, say), so success is read from what gh stored.
      const hostsFile = join(ghConfigDir(), "hosts.yml");
      const stored = async () => {
        const status = await run(gh, ["auth", "status", "--json", "hosts", "--hostname", input.host], "raw");
        const auth = classifyGhAuthStatus(status.stdout, input.host, input.scopes);
        return { ok: auth.state === "logged-in" && !isEnvToken(auth.tokenSource) && auth.missingScopes.length === 0, login: auth.login };
      };
      // What gh stored before, as a digest: the file holds the token.
      const before = await fingerprint(hostsFile);
      const scopeArgs = input.scopes.length > 0 ? ["-s", input.scopes.join(",")] : [];
      const args =
        input.flow === "login"
          ? ["auth", "login", "--web", "--clipboard=false", "--insecure-storage", "-h", input.host, ...scopeArgs]
          : ["auth", "refresh", "--insecure-storage", "-h", input.host, ...scopeArgs];
      let buffer = "";
      let sent = false;
      const result = await run(gh, args, "raw", {
        env: raw,
        signal,
        timeoutMs: 16 * 60_000,
        onStderr: (chunk) => {
          if (sent) return;
          buffer = (buffer + chunk).slice(-8192);
          const code = parseDeviceCode(buffer);
          if (code !== null) {
            sent = true;
            void deps.emitDeviceCode({ loginId: input.loginId, code: code.code, url: code.url });
          }
        },
      });
      const failed = { exitCode: result.exitCode, output: combined(result), ok: false, setupGit: false, login: null, note: null };
      if (signal?.aborted === true) return failed;
      const after = await stored();
      // A non-zero exit counts only when this run changed what gh stored, so
      // an older login left in place is never taken for a new one, whatever
      // `gh auth status` could reach before the login.
      const changed = (await fingerprint(hostsFile)) !== before;
      if (!after.ok || (result.exitCode !== 0 && !changed)) return failed;
      const note = result.exitCode === 0 ? null : classifyLoginNote(result.stderr);
      // A helper that already works (home-manager's, say) is left alone, and
      // a setup-git that fails on a read-only gitconfig still counts when git
      // gets credentials.
      let setupGit = await credentialReady(input.host);
      let setupOutput = "";
      if (!setupGit) {
        raw.GH_PATH = gh;
        const setup = await run(gh, ["auth", "setup-git", "--hostname", input.host], "raw", { env: raw });
        setupOutput = combined(setup);
        setupGit = setup.exitCode === 0 || (await credentialReady(input.host));
      }
      const output = [combined(result), setupOutput].filter(Boolean).join("\n");
      return { exitCode: result.exitCode, output, ok: true, setupGit, login: after.login, note };
    },

    async runCheck(input: { command: string; timeoutMs: number }, signal?: AbortSignal) {
      const result = await run("/bin/sh", ["-c", input.command], "as-agents", {
        timeoutMs: input.timeoutMs,
        signal,
        input: "",
      });
      return { exitCode: result.exitCode, output: combined(result), timedOut: result.timedOut };
    },

    async toolVersion(input: { bin: string; args: string[]; pattern: string }) {
      const agentsEnv = env("as-agents");
      const path = which(input.bin, agentsEnv);
      if (path === null) return { exitCode: 127, output: `${input.bin} not found on PATH`, found: false, version: null };
      const result = await run(path, input.args, "as-agents", { timeoutMs: 15_000, input: "" });
      let version: string | null = null;
      try {
        const match = new RegExp(input.pattern).exec(`${result.stdout}\n${result.stderr}`);
        version = match?.[1] ?? match?.[0] ?? null;
      } catch {
        version = null;
      }
      return { exitCode: result.exitCode, output: combined(result), found: true, version };
    },
  };
}

export type HostOps = ReturnType<typeof createOps>;

/** ssh that never asks for a passphrase through a GUI askpass program. */
function quietSshEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  delete base.SSH_ASKPASS;
  base.SSH_ASKPASS_REQUIRE = "never";
  return base;
}

/** A git credential helper that is gh's own, whatever path it runs gh from. */
const GH_HELPER = /gh(\.exe)?['"]?\s+auth\s+git-credential/;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * An empty folder for git that must read no repository's config:
 * `<data>/empty-cwd`, in the plugin's own data folder, never a shared temp
 * folder. Each use checks it is a real folder (not a symlink), owned by this
 * user, mode 0700 and empty; anything else, whoever made it, is removed and
 * made again.
 */
export async function emptyDir(dataDir: string): Promise<string> {
  const dir = join(dataDir, "empty-cwd");
  if (await isPrivateEmptyDir(dir)) return dir;
  // rm removes a symlink itself, not what it points to.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  // Not recursive: if something else appears in between, this fails.
  await mkdir(dir, { mode: 0o700 });
  if (!(await isPrivateEmptyDir(dir))) throw new Error("the plugin's empty working folder isn't private");
  return dir;
}

async function isPrivateEmptyDir(dir: string): Promise<boolean> {
  try {
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
    if ((info.mode & 0o777) !== 0o700) return false;
    return (await readdir(dir)).length === 0;
  } catch {
    return false;
  }
}

/** A digest of a file's contents, or null when it doesn't exist. */
async function fingerprint(path: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

function isReadOnlyError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}

/**
 * Whether the plugin could write `path`: the file itself (through any
 * symlink, e.g. into a read-only Nix store) or, when it doesn't exist yet,
 * the nearest directory that does.
 */
async function writable(path: string): Promise<boolean> {
  let target = path;
  for (;;) {
    try {
      const real = await realpath(target);
      if (real.startsWith("/nix/store/")) return false;
      await access(real, constants.W_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = dirname(target);
      if (parent === target) return false;
      target = parent;
    }
  }
}

/** The plugin writes its own files only; a symlink in their place is refused. */
async function refuseSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`${path} is a symlink; not writing through it`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}
