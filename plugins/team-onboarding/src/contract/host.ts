// The host entry's contract: a small, allow-listed set of operations the
// server asks every machine to run. None takes a free-form command except
// `runCheck`, which runs only commands the engineer approved.
//
// Each method runs in one git-env mode (see `HOST_METHOD_MODES`):
// - `as-agents` keeps bb's built-in git env and answers "does this work for
//   agents on this machine?";
// - `raw` strips GH_TOKEN, GITHUB_TOKEN, GIT_CONFIG_*, GIT_AUTHOR_* and
//   GIT_COMMITTER_* and answers "what does this machine have on its own?".
import { defineRpcContract, type ExperimentalHostSignals } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isVersionProbe } from "../core/probes.js";

const absPath = z.string().regex(/^\/[^\0]*$/, "an absolute path").max(4096);
const hostName = z.string().regex(/^[a-z0-9.-]+$/i).max(253);
const scope = z.string().regex(/^[a-z:_]+$/);

/** Git config keys the plugin may read or write, all in the global file. */
export const GIT_CONFIG_KEYS = [
  "core.sshCommand",
  "gpg.format",
  "user.signingkey",
  "commit.gpgsign",
  "gpg.ssh.allowedSignersFile",
] as const;

/**
 * The only values `gitConfig set` writes. `core.sshCommand` is run by git as
 * a command, so it is pinned to the plugin's own `ssh -F '<abs path>'`.
 */
const GIT_CONFIG_VALUES: Record<(typeof GIT_CONFIG_KEYS)[number], RegExp> = {
  "core.sshCommand": /^ssh -F '\/[^'\0\n]+'$/,
  "gpg.format": /^ssh$/,
  "user.signingkey": /^\/[^\0\n]+\.pub$/,
  "commit.gpgsign": /^(true|false)$/,
  "gpg.ssh.allowedSignersFile": /^\/[^\0\n]+$/,
};

/**
 * Set when a write was refused because the target is read-only, e.g. a file
 * home-manager links from the Nix store: the file bb would have written.
 */
const readOnlyFile = z.string().nullable();

const commandResult = z.object({
  exitCode: z.number().int(),
  /** Bounded raw output. The server keeps it in memory only. */
  output: z.string(),
});

export const probeOutput = z.object({
  platform: z.string(),
  arch: z.string(),
  user: z.string(),
  /** `os.homedir()`, i.e. `$HOME`. */
  homedir: z.string(),
  /** `os.userInfo().homedir`, the passwd entry ssh uses for `~`. */
  passwdHome: z.string(),
  ghPath: z.string().nullable(),
  ghVersion: z.string().nullable(),
  gitVersion: z.string().nullable(),
  sshVersion: z.string().nullable(),
  ssh: z.object({
    keyPath: z.string(),
    keyExists: z.boolean(),
    keyMode: z.number().int().nullable(),
    publicKey: z.string().nullable(),
    knownHostsPath: z.string(),
    knownHostsLines: z.array(z.string()),
    configPath: z.string(),
    configText: z.string().nullable(),
    sshCommand: z.string().nullable(),
  }),
  credentialHelper: z.string().nullable(),
  /** The file `git config --global` writes, and whether it can. */
  gitGlobal: z.object({ path: z.string(), writable: z.boolean() }),
  /** Whether the plugin can create its files in `~/.ssh`. */
  sshDirWritable: z.boolean(),
  /** Whether the user has a ~/.ssh/config, which background checks don't read. */
  userSshConfig: z.boolean(),
  /** Whether an SSH agent is reachable (SSH_AUTH_SOCK), which background checks don't use. */
  sshAgent: z.boolean(),
  /** Whether the plugin's known-hosts file and SSH config can be written. */
  knownHostsWritable: z.boolean(),
  configWritable: z.boolean(),
  signing: z.object({
    format: z.string().nullable(),
    signingKey: z.string().nullable(),
  }),
});
export type Probe = z.infer<typeof probeOutput>;

export const hostContract = defineRpcContract({
  probe: {
    input: z.object({}).strict(),
    output: probeOutput,
  },
  sshKeygen: {
    input: z.object({ keyPath: absPath, comment: z.string().regex(/^[\w.@-]{1,100}$/) }).strict(),
    output: z.object({ created: z.boolean(), publicKey: z.string().nullable(), readOnlyFile }),
  },
  writeSshConfig: {
    input: z
      .object({ configPath: absPath, keyPath: absPath, knownHostsPath: absPath, host: hostName })
      .strict(),
    output: z.object({ written: z.boolean(), sshCommand: z.string(), readOnlyFile }),
  },
  writeKnownHosts: {
    input: z
      .object({
        path: absPath,
        lines: z
          .array(z.string().regex(/^[a-z0-9.-]+ (ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+$/))
          .min(1)
          .max(10),
      })
      .strict(),
    output: z.object({ written: z.number().int(), readOnlyFile }),
  },
  gitConfig: {
    input: z
      .object({
        op: z.enum(["get", "set"]),
        key: z.enum(GIT_CONFIG_KEYS),
        value: z.string().max(4096).optional(),
      })
      .strict()
      .refine((input) => input.op === "get" || (input.value !== undefined && GIT_CONFIG_VALUES[input.key].test(input.value)), {
        message: "value not allowed for this key",
      }),
    output: z.object({ value: z.string().nullable(), readOnlyFile }),
  },
  sshTest: {
    input: z
      .object({
        configPath: absPath,
        keyPath: absPath,
        knownHostsPath: absPath,
        host: hostName,
        /** Read the plugin's config and the ~/.ssh/config it includes: a click only. */
        userConfig: z.boolean().optional(),
      })
      .strict(),
    output: commandResult.extend({ login: z.string().nullable(), category: z.string() }),
  },
  lsRemote: {
    input: z
      .object({
        url: z.string().min(1).max(2048),
        ref: z.string().max(255).optional(),
        mode: z.enum(["as-agents", "raw"]),
        /**
         * Let git ask its configured credential helpers. Only for a check
         * the engineer started: on a Mac a keychain helper can prompt.
         */
        helpers: z.boolean().optional(),
      })
      .strict(),
    output: commandResult.extend({ category: z.string(), sha: z.string().nullable() }),
  },
  ghStatus: {
    input: z.object({ host: hostName }).strict(),
    output: commandResult.extend({
      installed: z.boolean(),
      stdout: z.string(),
      credentialHelper: z.string().nullable(),
      /** git config names gh's helper for this host (read from config only). */
      credentialReady: z.boolean(),
    }),
  },
  /** `gh auth status` as agents on this machine see it: GH_TOKEN included. */
  ghAgentsStatus: {
    input: z.object({ host: hostName }).strict(),
    output: commandResult.extend({ installed: z.boolean(), stdout: z.string() }),
  },
  ghSetupGit: {
    input: z.object({ host: hostName }).strict(),
    /** `skipped`: git config already names gh's helper, so gh wasn't run. */
    output: commandResult.extend({ credentialReady: z.boolean(), skipped: z.boolean() }),
  },
  ghApiRepo: {
    input: z
      .object({
        host: hostName,
        repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        /** `as-agents` answers with the GH_TOKEN agents get; `raw` (default) with the machine's gh login. */
        mode: z.enum(["as-agents", "raw"]).optional(),
      })
      .strict(),
    output: commandResult.extend({ category: z.string(), ssoUrl: z.string().nullable() }),
  },
  ghSshKeyAdd: {
    input: z
      .object({
        host: hostName,
        publicKeyPath: absPath,
        title: z.string().regex(/^[\w .@-]{1,100}$/),
        type: z.enum(["authentication", "signing"]),
      })
      .strict(),
    output: commandResult.extend({ ok: z.boolean() }),
  },
  signingTest: {
    input: z.object({ keyPath: absPath }).strict(),
    /** `skipped`: the signing key isn't bb's, so nothing was signed. */
    output: commandResult.extend({ ok: z.boolean(), skipped: z.boolean() }),
  },
  startDeviceLogin: {
    input: z
      .object({
        loginId: z.string().regex(/^[\w-]{1,64}$/),
        host: hostName,
        scopes: z.array(scope).max(20),
        flow: z.enum(["login", "refresh"]),
      })
      .strict(),
    output: commandResult.extend({
      /** The post-condition: a token is stored for the host with the scopes asked for. */
      ok: z.boolean(),
      setupGit: z.boolean(),
      /** The account the stored login belongs to. */
      login: z.string().nullable(),
      /** Set when gh exited non-zero although the login was saved. */
      note: z.enum(["config-not-saved", "gh-exit"]).nullable(),
    }),
  },
  runCheck: {
    input: z
      .object({
        command: z.string().min(1).max(4000),
        timeoutMs: z.number().int().min(1000).max(300_000),
      })
      .strict(),
    output: commandResult.extend({ timedOut: z.boolean() }),
  },
  toolVersion: {
    input: z
      .object({
        bin: z.string().regex(/^[A-Za-z0-9._+-]+$/),
        args: z.array(z.string().max(200)).max(10),
        pattern: z.string().max(200),
      })
      .strict()
      .refine((input) => isVersionProbe(input.bin, input.args), "args must be a version probe for this program"),
    output: commandResult.extend({ found: z.boolean(), version: z.string().nullable() }),
  },
});

export type HostContract = typeof hostContract;
export type HostMethod = keyof HostContract & string;

/** The git-env mode each method runs in. */
export const HOST_METHOD_MODES: Record<HostMethod, "raw" | "as-agents" | "input"> = {
  probe: "raw",
  sshKeygen: "raw",
  writeSshConfig: "raw",
  writeKnownHosts: "raw",
  gitConfig: "raw",
  sshTest: "raw",
  // The caller picks: `as-agents` for github.access on non-server machines.
  lsRemote: "input",
  ghStatus: "raw",
  ghAgentsStatus: "as-agents",
  ghSetupGit: "raw",
  // The caller picks, as for lsRemote.
  ghApiRepo: "input",
  ghSshKeyAdd: "raw",
  signingTest: "raw",
  startDeviceLogin: "raw",
  runCheck: "as-agents",
  toolVersion: "as-agents",
};

export const hostSignals = {
  deviceCode: {
    payload: z
      .object({
        loginId: z.string(),
        code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        url: z.string(),
      })
      .strict(),
  },
} satisfies ExperimentalHostSignals;
