// Host operations against scratch HOME directories: $HOME differs from the
// passwd home, the real ~/.ssh and git config are never touched, and bb's
// built-in git env is present or stripped per mode.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../../host.js";
import { envFor, isBuiltInGitVar, runProcess } from "./exec.js";
import { HOST_METHOD_MODES } from "../contract/host.js";
import { createOps, emptyDir, sshPaths, type OpsDeps } from "./ops.js";

let root: string;
let home: string;
let passwd: string;
let bin: string;
let bare: string;
let pluginData: string;
const codes: { loginId: string; code: string; url: string }[] = [];

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function ops(extraEnv: Record<string, string> = {}, homeDir = home) {
  const deps: OpsDeps = {
    run: runProcess,
    env: { ...baseEnv(extraEnv), HOME: homeDir },
    homedir: () => homeDir,
    passwdHome: () => passwd,
    emitDeviceCode: async (payload) => {
      codes.push(payload);
    },
    dataDir: () => pluginData,
  };
  return createOps(deps);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "onboarding-ops-"));
  home = join(root, "srv-home");
  passwd = join(root, "passwd-home");
  bin = join(root, "bin");
  pluginData = join(root, "plugin-data");
  for (const dir of [home, passwd, bin]) mkdirSync(dir, { recursive: true });
  // A fake gh with state: a device login stores a token in hosts.yml under
  // gh's config dir; `auth status` reports it, and a GH_TOKEN in the env
  // (as agents see it) as the active entry. `$root/login-mode` picks how the
  // login ends: `ok`, `save-exit1` (gh saves the token, then fails writing
  // a read-only config.yml, as on home-manager) or `fail`.
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
echo "$@" >> "${root}/gh.log"
dir="\${GH_CONFIG_DIR:-$HOME/.config/gh}"
mode=$(cat "${root}/login-mode" 2>/dev/null || echo ok)
case "$1 $2" in
  "auth login"|"auth refresh")
    printf '\\n! First copy your one-time code: AB12-CD34\\nOpen this URL to continue in your web browser: https://github.com/login/device\\n' >&2
    sleep 0.2
    if [ "$mode" = fail ]; then echo "error: device flow failed" >&2; exit 1; fi
    mkdir -p "$dir"; echo "github.com: {user: octo, oauth_token: gho_fake}" > "$dir/hosts.yml"
    if [ "$mode" = save-exit1 ]; then echo "failed to write config to disk: open $dir/config.yml: read-only file system" >&2; exit 1; fi
    exit 0 ;;
  "auth setup-git")
    echo "GH_PATH=$GH_PATH" >> "${root}/gh.log"
    if [ "$mode" = setup-fails-after-write ]; then git config --global credential.https://github.com.helper "!$GH_PATH auth git-credential"; exit 1; fi
    exit 0 ;;
  "auth status")
    if [ -f "${root}/status-error-once" ]; then rm -f "${root}/status-error-once"; echo '{"hosts":{"github.com":[{"state":"error","error":"dial tcp: i/o timeout","active":true,"host":"github.com","login":"","tokenSource":"x"}]}}'; exit 0; fi
    printf '{"hosts":{"github.com":['
    sep=""
    if [ -n "$GH_TOKEN" ]; then printf '{"state":"success","active":true,"host":"github.com","login":"token-user","tokenSource":"GH_TOKEN","scopes":"repo"}'; sep=","; fi
    if [ -f "$dir/hosts.yml" ]; then printf '%s{"state":"success","active":%s,"host":"github.com","login":"octo","tokenSource":"%s","scopes":"gist, read:org, repo"}' "$sep" "$([ -n "$sep" ] && echo false || echo true)" "$dir/hosts.yml"; fi
    echo ']}}'
    exit 0 ;;
  "api -i") printf 'HTTP/2.0 404 Not Found\\n'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  "--version "*) echo "gh version 2.101.0 (test)"; exit 0 ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  // A local bare repo that a fake URL is rewritten to by builtInGit-style env.
  bare = join(root, "bare.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  const work = join(root, "work");
  execFileSync("git", ["init", "-q", work]);
  execFileSync("git", ["-C", work, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "x"]);
  execFileSync("git", ["-C", work, "push", "-q", bare, "HEAD:refs/heads/main"]);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("env modes", () => {
  it("raw strips bb's built-in git and commit identity; as-agents keeps it", () => {
    const base = {
      PATH: "/bin",
      GH_TOKEN: "t",
      GITHUB_TOKEN: "t",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_0: "git@github.com:",
      GIT_AUTHOR_NAME: "a",
      GIT_COMMITTER_EMAIL: "c",
      BB_SECRET: "x",
    };
    const raw = envFor("raw", base);
    for (const name of Object.keys(base)) if (isBuiltInGitVar(name)) expect(raw[name]).toBeUndefined();
    expect(raw.PATH).toBe("/bin");
    expect(raw.BB_SECRET).toBeUndefined();
    const agents = envFor("as-agents", base);
    expect(agents.GH_TOKEN).toBe("t");
    expect(agents.GIT_CONFIG_KEY_0).toBe("url.https://github.com/.insteadOf");
    for (const env of [raw, agents]) {
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(env.GH_PROMPT_DISABLED).toBe("1");
    }
  });
});

describe("probe", () => {
  it("reports $HOME and the passwd home separately, and absolute SSH paths", async () => {
    const probe = await ops().probe();
    expect(probe.homedir).toBe(home);
    expect(probe.passwdHome).toBe(passwd);
    expect(probe.ssh.keyPath).toBe(join(home, ".ssh", "bb_ed25519"));
    expect(probe.ssh.keyExists).toBe(false);
    expect(probe.ghPath).toBe(join(bin, "gh"));
    expect(probe.ghVersion).toBe("2.101.0");
  });
});

describe("probe's git config", () => {
  it("reads the global git config with one git process, last value winning", async () => {
    const dir = mkdtempSync(join(root, "probe-config-"));
    writeFileSync(
      join(dir, ".gitconfig"),
      '[core]\n\tsshCommand = ssh -F /a\n\tsshCommand = ssh -F /b\n[gpg]\n\tformat = ssh\n[user]\n\tsigningKey = /k.pub\n[credential "https://github.com"]\n\thelper = one\n\thelper = two\n',
    );
    const seen: string[] = [];
    const probe = await createOps({
      run: (command, args, options) => {
        seen.push(`${command} ${args.join(" ")}`);
        return runProcess(command, args, options);
      },
      env: { ...baseEnv(), HOME: dir },
      homedir: () => dir,
      passwdHome: () => passwd,
      emitDeviceCode: async () => {},
      dataDir: () => pluginData,
    }).probe();
    expect(seen.filter((spawn) => spawn.startsWith("git config"))).toEqual(["git config --global --list -z"]);
    expect(probe.ssh.sshCommand).toBe("ssh -F /b");
    expect(probe.signing).toEqual({ format: "ssh", signingKey: "/k.pub" });
    expect(probe.credentialHelper).toBe("two");
    // No global config at all: nothing set, as before.
    const empty = await ops({}, mkdtempSync(join(root, "probe-empty-"))).probe();
    expect(empty.ssh.sshCommand).toBeNull();
    expect(empty.signing).toEqual({ format: null, signingKey: null });
    expect(empty.credentialHelper).toBeNull();
  });
});

describe("SSH fixes", () => {
  // Acceptance 3: the key goes to an absolute path named bb_ed25519, mode 0600,
  // and core.sshCommand points at a plugin-owned config with absolute paths.
  it("creates bb_ed25519 at an absolute path and never overwrites it", async () => {
    const paths = sshPaths(home);
    const first = await ops().sshKeygen({ keyPath: paths.keyPath, comment: "bb@server" });
    expect(first.created).toBe(true);
    expect(first.publicKey).toMatch(/^ssh-ed25519 \S+ bb@server$/);
    expect(statSync(paths.keyPath).mode & 0o777).toBe(0o600);
    const again = await ops().sshKeygen({ keyPath: paths.keyPath, comment: "bb@server" });
    expect(again.created).toBe(false);
    expect(existsSync(join(passwd, ".ssh"))).toBe(false);
  });

  it("writes a plugin-owned config, including the user's own config for other hosts", async () => {
    mkdirSync(join(passwd, ".ssh"), { recursive: true });
    writeFileSync(join(passwd, ".ssh", "config"), "Host other\n  User me\n");
    const paths = sshPaths(home);
    const out = await ops().writeSshConfig({ ...paths, host: "github.com" });
    const text = readFileSync(paths.configPath, "utf8");
    expect(text).toContain(`IdentityFile ${paths.keyPath}`);
    expect(text).toContain(`UserKnownHostsFile ${paths.knownHostsPath}`);
    expect(text).toContain(`Include ${join(passwd, ".ssh", "config")}`);
    expect(out.sshCommand).toBe(`ssh -F '${paths.configPath}'`);
    await ops().gitConfig({ op: "set", key: "core.sshCommand", value: out.sshCommand });
    expect(readFileSync(join(home, ".gitconfig"), "utf8")).toContain("sshCommand");
    const probe = await ops().probe();
    expect(probe.ssh.sshCommand).toBe(out.sshCommand);
    // The config parses with ssh itself.
    const resolved = execFileSync("ssh", ["-G", "-F", paths.configPath, "github.com"], { encoding: "utf8" });
    expect(resolved).toContain(`identityfile ${paths.keyPath}`);
  });

  it("writes pinned known hosts", async () => {
    const paths = sshPaths(home);
    await ops().writeKnownHosts({ path: paths.knownHostsPath, lines: ["github.com ssh-ed25519 AAAA"] });
    expect((await ops().probe()).ssh.knownHostsLines).toEqual(["github.com ssh-ed25519 AAAA"]);
  });
});

describe("plugin-owned files", () => {
  it("refuses to write through a symlink", async () => {
    const paths = sshPaths(home);
    const target = join(root, "elsewhere");
    writeFileSync(target, "keep me\n");
    rmSync(paths.knownHostsPath, { force: true });
    symlinkSync(target, paths.knownHostsPath);
    await expect(ops().writeKnownHosts({ path: paths.knownHostsPath, lines: ["github.com ssh-ed25519 AAAA"] })).rejects.toThrow(/symlink/);
    expect(readFileSync(target, "utf8")).toBe("keep me\n");
    rmSync(paths.knownHostsPath);
  });
});

describe("git env modes end to end", () => {
  const rewrite = (url: string) => ({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${url}.insteadOf`,
    GIT_CONFIG_VALUE_0: "git@github.invalid:example-org/",
  });

  // Acceptance 24 (in miniature): with bb's rewrite in the env, as-agents
  // follows it, while raw reports what the machine has on its own.
  it("as-agents follows bb's URL rewrite; raw doesn't", async () => {
    const env = rewrite(`file://${bare.replace(/bare\.git$/, "")}`);
    const agents = await ops(env).lsRemote({ url: "git@github.invalid:example-org/bare.git", ref: "main", mode: "as-agents" });
    expect(agents.category).toBe("ok");
    expect(agents.sha).toMatch(/^[0-9a-f]{40}$/);
    const raw = await ops(env).lsRemote({ url: "git@github.invalid:example-org/bare.git", ref: "main", mode: "raw" });
    expect(raw.category).not.toBe("ok");
  });

  it("reports a missing ref", async () => {
    const out = await ops().lsRemote({ url: bare, ref: "does-not-exist", mode: "raw" });
    expect(out.category).toBe("ref-missing");
  });
});

describe("gh operations with a fake gh", () => {
  /** A fresh HOME per login test, so stored logins don't leak between them. */
  function freshHome(name: string) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const loginMode = (mode: string) => writeFileSync(join(root, "login-mode"), mode);
  const ghLog = () => (existsSync(join(root, "gh.log")) ? readFileSync(join(root, "gh.log"), "utf8") : "");
  const clearLog = () => rmSync(join(root, "gh.log"), { force: true });
  const input = { loginId: "l1", host: "github.com", scopes: ["repo", "read:org"], flow: "login" as const };

  // Hypothesis 4 (parser side): the code is read from stderr and signalled;
  // then setup-git runs with GH_PATH pointing at the PATH entry.
  it("streams the device code, then runs setup-git with a stable GH_PATH", async () => {
    codes.length = 0;
    loginMode("ok");
    clearLog();
    const out = await ops({ GH_TOKEN: "should-be-stripped" }, freshHome("login-ok")).startDeviceLogin(input);
    expect(out).toMatchObject({ ok: true, setupGit: true, login: "octo", note: null });
    expect(codes).toEqual([{ loginId: "l1", code: "AB12-CD34", url: "https://github.com/login/device" }]);
    const log = ghLog();
    expect(log).toContain("auth login --web --clipboard=false --insecure-storage -h github.com -s repo,read:org");
    expect(log).toContain(`GH_PATH=${join(bin, "gh")}`);
  });

  // gh saves the token, then exits 1 because config.yml is a read-only link
  // into the Nix store: the login worked, and says why gh complained.
  it("counts a saved login as success when gh exits non-zero afterwards", async () => {
    loginMode("save-exit1");
    const out = await ops({}, freshHome("login-save-exit1")).startDeviceLogin(input);
    expect(out).toMatchObject({ ok: true, exitCode: 1, login: "octo", note: "config-not-saved" });
    expect(out.output).toContain("read-only file system");
  });

  it("doesn't take an older stored login for a new one", async () => {
    const dir = freshHome("login-stale");
    loginMode("ok");
    expect((await ops({}, dir).startDeviceLogin(input)).ok).toBe(true);
    loginMode("fail");
    const again = await ops({}, dir).startDeviceLogin(input);
    expect(again).toMatchObject({ ok: false, exitCode: 1, note: null });
  });

  it("fails when nothing was stored", async () => {
    loginMode("fail");
    expect(await ops({}, freshHome("login-fail")).startDeviceLogin(input)).toMatchObject({ ok: false, setupGit: false, login: null });
  });

  // home-manager configures gh's helper in a read-only ~/.config/git/config:
  // setup-git isn't run at all, and the result counts as done.
  it("skips setup-git when git already uses a gh helper from a read-only config", async () => {
    const dir = freshHome("login-hm");
    const store = join(root, "nix-store-git");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "config"), '[credential "https://github.com"]\n\thelper = !/nix/store/x-gh/bin/gh auth git-credential\n');
    chmodSync(join(store, "config"), 0o444);
    mkdirSync(join(dir, ".config", "git"), { recursive: true });
    symlinkSync(join(store, "config"), join(dir, ".config", "git", "config"));
    loginMode("save-exit1");
    clearLog();
    const out = await ops({}, dir).startDeviceLogin(input);
    expect(out).toMatchObject({ ok: true, setupGit: true, note: "config-not-saved" });
    expect(ghLog()).not.toContain("auth setup-git");
    const setup = await ops({}, dir).ghSetupGit({ host: "github.com" });
    expect(setup).toMatchObject({ exitCode: 0, skipped: true, credentialReady: true });
    const status = await ops({}, dir).ghStatus({ host: "github.com" });
    expect(status.credentialReady).toBe(true);
    // And gitConfig reports the read-only file instead of failing.
    const set = await ops({}, dir).gitConfig({ op: "set", key: "gpg.format", value: "ssh" });
    expect(set).toEqual({ value: null, readOnlyFile: join(dir, ".config", "git", "config") });
    expect(readFileSync(join(store, "config"), "utf8")).not.toContain("gpg");
    expect((await ops({}, dir).probe()).gitGlobal).toEqual({ path: join(dir, ".config", "git", "config"), writable: false });
  });

  it("counts a failed setup-git as done when git has the helper afterwards", async () => {
    loginMode("setup-fails-after-write");
    const out = await ops({}, freshHome("login-setup-fails")).startDeviceLogin(input);
    expect(out).toMatchObject({ ok: true, setupGit: true });
  });

  // A Mac's keychain helper could prompt: helpers are only read from
  // config, never run, and git's own URL matching finds them.
  it("reads helpers from config with git's URL rules and never runs one", async () => {
    const dir = freshHome("helper-other");
    const marker = join(root, "helper-ran");
    writeFileSync(join(dir, ".gitconfig"), `[credential]\n\thelper = "!f() { touch '${marker}'; echo password=probe-secret; }; f"\n`);
    const status = await ops({}, dir).ghStatus({ host: "github.com" });
    expect(status.credentialReady).toBe(false);
    loginMode("ok");
    await ops({}, dir).startDeviceLogin(input);
    await ops({}, dir).ghSetupGit({ host: "github.com" });
    expect(existsSync(marker)).toBe(false);
    const slash = freshHome("helper-url-form");
    writeFileSync(join(slash, ".gitconfig"), '[credential "https://github.com/"]\n\thelper = !/opt/gh/bin/gh auth git-credential\n');
    expect((await ops({}, slash).ghStatus({ host: "github.com" })).credentialReady).toBe(true);
    const reset = freshHome("helper-reset");
    writeFileSync(join(reset, ".gitconfig"), '[credential "https://github.com"]\n\thelper = !/opt/gh/bin/gh auth git-credential\n\thelper =\n');
    expect((await ops({}, reset).ghStatus({ host: "github.com" })).credentialReady).toBe(false);
  });

  // The before-check couldn't reach GitHub and the login then failed: the
  // old stored login must not read as a new one.
  it("compares what gh stored, not what gh auth status could reach", async () => {
    const dir = freshHome("login-before-error");
    loginMode("ok");
    expect((await ops({}, dir).startDeviceLogin(input)).ok).toBe(true);
    writeFileSync(join(root, "status-error-once"), "");
    loginMode("fail");
    expect(await ops({}, dir).startDeviceLogin(input)).toMatchObject({ ok: false, exitCode: 1 });
  });

  it("never counts a cancelled login", async () => {
    loginMode("save-exit1");
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    expect(await ops({}, freshHome("login-cancel")).startDeviceLogin(input, abort.signal)).toMatchObject({ ok: false, login: null });
  });

  it("reports GH_TOKEN as agents see it, and never in raw mode", async () => {
    const dir = freshHome("agents-token");
    const agents = await ops({ GH_TOKEN: "t" }, dir).ghAgentsStatus({ host: "github.com" });
    expect(agents.stdout).toContain('"tokenSource":"GH_TOKEN"');
    const raw = await ops({ GH_TOKEN: "t" }, dir).ghStatus({ host: "github.com" });
    expect(raw.stdout).not.toContain("GH_TOKEN");
  });

  it("classifies gh api output without keeping names in the category", async () => {
    const out = await ops().ghApiRepo({ host: "github.com", repo: "example-org/private" });
    expect(out.category).toBe("no-access");
    expect(out.ssoUrl).toBeNull();
  });

  it("reports gh auth status raw output for the server to classify", async () => {
    const out = await ops({}, freshHome("status-empty")).ghStatus({ host: "github.com" });
    expect(out.installed).toBe(true);
    expect(out.stdout.trim()).toBe('{"hosts":{"github.com":[]}}');
  });
});

describe("credential helpers on git ls-remote", () => {
  // A server that always asks for credentials, so git would call its helpers.
  it("never lets git run a helper or askpass unless the engineer asked", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.writeHead(401, { "www-authenticate": 'Basic realm="x"' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const dir = join(root, "helper-home");
      mkdirSync(dir, { recursive: true });
      const helperRan = join(root, "keychain-helper-ran");
      const askpassRan = join(root, "askpass-ran");
      writeFileSync(join(root, "askpass.sh"), `#!/bin/sh\ntouch '${askpassRan}'\necho x\n`);
      chmodSync(join(root, "askpass.sh"), 0o755);
      writeFileSync(join(dir, ".gitconfig"), `[credential]\n\thelper = "!f() { touch '${helperRan}'; }; f"\n`);
      const url = `http://127.0.0.1:${port}/example-org/private.git`;
      const env = { GIT_ASKPASS: join(root, "askpass.sh"), SSH_ASKPASS: join(root, "askpass.sh") };
      for (const mode of ["raw", "as-agents"] as const) {
        const out = await ops(env, dir).lsRemote({ url, mode });
        expect(out.category).toBe("no-auth");
      }
      expect(existsSync(helperRan)).toBe(false);
      expect(existsSync(askpassRan)).toBe(false);
      await ops(env, dir).lsRemote({ url, mode: "raw", helpers: true });
      expect(existsSync(helperRan)).toBe(true);
      expect(existsSync(askpassRan)).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("nothing a scheduled check runs can prompt", () => {
  it("signs only with bb's key file, through plain ssh-keygen, with no hooks", async () => {
    const dir = join(root, "sign-home");
    mkdirSync(dir, { recursive: true });
    const paths = sshPaths(dir);
    await ops({}, dir).sshKeygen({ keyPath: paths.keyPath, comment: "bb@x" });
    const programRan = join(root, "sign-program-ran");
    const hookRan = join(root, "sign-hook-ran");
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "pre-commit"), `#!/bin/sh\ntouch '${hookRan}'\n`);
    chmodSync(join(root, "hooks", "pre-commit"), 0o755);
    writeFileSync(join(root, "op-ssh-sign"), `#!/bin/sh\ntouch '${programRan}'\nexit 1\n`);
    chmodSync(join(root, "op-ssh-sign"), 0o755);
    const config = (key: string) =>
      `[gpg]\n\tformat = ssh\n[gpg "ssh"]\n\tprogram = ${join(root, "op-ssh-sign")}\n[user]\n\tsigningkey = ${key}\n[core]\n\thooksPath = ${join(root, "hooks")}\n\tfsmonitor = ${join(root, "op-ssh-sign")}\n`;
    writeFileSync(join(dir, ".gitconfig"), config(`${paths.keyPath}.pub`));
    const own = await ops({ SSH_ASKPASS: join(root, "askpass.sh"), DISPLAY: ":0" }, dir).signingTest({ keyPath: paths.keyPath });
    expect(own).toMatchObject({ ok: true, skipped: false });
    expect(existsSync(programRan)).toBe(false);
    expect(existsSync(hookRan)).toBe(false);
    // A key of the user's is left untested: signing it could prompt.
    writeFileSync(join(dir, ".gitconfig"), config("/home/someone/.ssh/id_ed25519.pub"));
    expect(await ops({}, dir).signingTest({ keyPath: paths.keyPath })).toMatchObject({ ok: true, skipped: true });
    expect(existsSync(programRan)).toBe(false);
  });

  it("uses only the plugin's ssh settings in the background, and puts BatchMode first on a click", async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const recorder: OpsDeps = {
      run: async (command, args, options) => {
        if (command === "git" && args[0] === "config") {
          return { exitCode: 0, stdout: "ssh -o BatchMode=no -F '/h/.ssh/bb_config'\n", stderr: "", timedOut: false, notFound: false };
        }
        seen.push(options.env);
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, notFound: false };
      },
      env: baseEnv({ SSH_ASKPASS: "/usr/bin/askpass" }),
      homedir: () => home,
      passwdHome: () => passwd,
      emitDeviceCode: async () => {},
      dataDir: () => pluginData,
    };
    const recorded = createOps(recorder);
    await recorded.lsRemote({ url: "git@github.com:example-org/x.git", mode: "raw" });
    const background = seen[0]!.GIT_SSH_COMMAND!;
    expect(background).toMatch(/^ssh -F \/dev\/null -o BatchMode=yes -o ConnectTimeout=10 -o IdentityAgent=none -o StrictHostKeyChecking=yes /);
    expect(background).not.toContain("BatchMode=no");
    expect(background).not.toContain("bb_config");
    expect(seen[0]!.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(seen[0]!.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(seen[0]!.SSH_ASKPASS).toBeUndefined();
    expect(seen[0]!.SSH_ASKPASS_REQUIRE).toBe("never");
    await recorded.lsRemote({ url: "git@github.com:example-org/x.git", mode: "raw", helpers: true });
    expect(seen[1]!.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -o ConnectTimeout=10 -o BatchMode=no -F '/h/.ssh/bb_config'");
    expect(seen[1]!.GIT_CONFIG_GLOBAL).toBeUndefined();
    // ssh keeps the first value it sees.
    const resolved = execFileSync("ssh", ["-G", "-o", "BatchMode=yes", "-o", "IdentityAgent=none", "-o", "BatchMode=no", "github.com"], { encoding: "utf8" });
    expect(resolved).toMatch(/^batchmode yes$/m);
    expect(resolved).toMatch(/^identityagent none$/m);
    await recorded.sshTest({ ...sshPaths(home), host: "github.com" });
    expect(seen[2]!.SSH_ASKPASS_REQUIRE).toBe("never");
  });

  it("ignores the user's ssh config in a background ssh test, and reads it on a click", async () => {
    const args: (readonly string[])[] = [];
    const recorded = createOps({
      run: async (command, commandArgs) => {
        if (command === "ssh") args.push(commandArgs);
        return { exitCode: 255, stdout: "", stderr: "", timedOut: false, notFound: false };
      },
      env: baseEnv(),
      homedir: () => home,
      passwdHome: () => passwd,
      emitDeviceCode: async () => {},
      dataDir: () => pluginData,
    });
    const paths = sshPaths(home);
    await recorded.sshTest({ ...paths, host: "github.com" });
    await recorded.sshTest({ ...paths, host: "github.com", userConfig: true });
    expect(args[0]!.slice(0, 2)).toEqual(["-F", "/dev/null"]);
    expect(args[1]!.slice(0, 2)).toEqual(["-F", paths.configPath]);
  });

  // A user's insteadOf, say one pointing a URL elsewhere, can't change what a
  // background check reaches; a click honours it.
  it("runs background git outside any repository in $HOME", async () => {
    const dir = join(root, "dotfiles-home");
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "url./nonexistent/.insteadOf", bare]);
    expect((await ops({}, dir).lsRemote({ url: bare, ref: "main", mode: "raw" })).category).toBe("ok");
  });

  it("keeps its empty folder private and empty, and replaces it otherwise", async () => {
    const data = join(root, "empty-data");
    const dir = await emptyDir(data);
    expect(dir).toBe(join(data, "empty-cwd"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const again = async () => {
      expect(await emptyDir(data)).toBe(dir);
      expect(lstatSync(dir).isDirectory()).toBe(true);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(readdirSync(dir)).toEqual([]);
    };
    // Cleaned away.
    rmSync(dir, { recursive: true, force: true });
    await again();
    // Something put inside it, a repository with its own config say.
    execFileSync("git", ["init", "-q", dir]);
    await again();
    // Opened up to other users.
    chmodSync(dir, 0o777);
    await again();
    // Replaced by a symlink to a folder elsewhere, which is left alone.
    const elsewhere = join(root, "elsewhere-dir");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "keep"), "x");
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(elsewhere, dir);
    await again();
    expect(readFileSync(join(elsewhere, "keep"), "utf8")).toBe("x");
    // Background git runs from it even after it was cleaned.
    rmSync(join(pluginData, "empty-cwd"), { recursive: true, force: true });
    expect((await ops().lsRemote({ url: bare, ref: "main", mode: "raw" })).category).toBe("ok");
  });

  it("reads none of the user's git config in the background", async () => {
    const dir = join(root, "insteadof-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitconfig"), `[url "/nonexistent/"]\n\tinsteadOf = ${bare}\n`);
    expect((await ops({}, dir).lsRemote({ url: bare, ref: "main", mode: "raw" })).category).toBe("ok");
    expect((await ops({}, dir).lsRemote({ url: bare, ref: "main", mode: "raw", helpers: true })).category).not.toBe("ok");
  });

  it("disables gh's prompts on every gh call", async () => {
    const seen: { command: string; env: NodeJS.ProcessEnv }[] = [];
    const recorded = createOps({
      run: async (command, _args, options) => {
        seen.push({ command, env: options.env });
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, notFound: false };
      },
      env: baseEnv(),
      homedir: () => home,
      passwdHome: () => passwd,
      emitDeviceCode: async () => {},
      dataDir: () => pluginData,
    });
    await recorded.ghStatus({ host: "github.com" });
    await recorded.ghAgentsStatus({ host: "github.com" });
    await recorded.ghApiRepo({ host: "github.com", repo: "example-org/x", mode: "as-agents" });
    await recorded.ghSetupGit({ host: "github.com" });
    const gh = seen.filter((call) => call.command.endsWith("/gh"));
    expect(gh.length).toBeGreaterThanOrEqual(4);
    for (const call of gh) expect(call.env.GH_PROMPT_DISABLED).toBe("1");
  });
});

describe("read-only targets", () => {
  it("reports a locked git config as busy, not read-only", async () => {
    const dir = join(root, "locked-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitconfig"), "[user]\n\tname = x\n");
    writeFileSync(join(dir, ".gitconfig.lock"), "");
    await expect(ops({}, dir).gitConfig({ op: "set", key: "gpg.format", value: "ssh" })).rejects.toThrow(/locked by another git process/);
  });

  it("reports a read-only ~/.ssh instead of failing", async () => {
    const dir = join(root, "ro-home");
    mkdirSync(join(dir, ".ssh"), { recursive: true });
    chmodSync(join(dir, ".ssh"), 0o555);
    try {
      const paths = sshPaths(dir);
      expect((await ops({}, dir).probe()).sshDirWritable).toBe(false);
      expect(await ops({}, dir).writeKnownHosts({ path: paths.knownHostsPath, lines: ["github.com ssh-ed25519 AAAA"] })).toEqual({ written: 0, readOnlyFile: paths.knownHostsPath });
      expect((await ops({}, dir).writeSshConfig({ ...paths, host: "github.com" })).readOnlyFile).toBe(paths.configPath);
      expect(await ops({}, dir).sshKeygen({ keyPath: paths.keyPath, comment: "bb@x" })).toEqual({ created: false, publicKey: null, readOnlyFile: join(dir, ".ssh") });
      expect(existsSync(paths.keyPath)).toBe(false);
    } finally {
      chmodSync(join(dir, ".ssh"), 0o755);
    }
  });
});

describe("tool versions and team checks", () => {
  it("reads a version with a bare program name and no shell", async () => {
    const node = await ops().toolVersion({ bin: "node", args: ["--version"], pattern: "(\\d+\\.\\d+\\.\\d+)" });
    expect(node.found).toBe(true);
    expect(node.version).toMatch(/^\d+\.\d+\.\d+$/);
    const missing = await ops().toolVersion({ bin: "definitely-not-a-tool-xyz", args: [], pattern: "(.*)" });
    expect(missing).toMatchObject({ found: false, version: null });
  });

  it("runs an approved command and reports its exit code and timeouts", async () => {
    expect((await ops().runCheck({ command: "exit 3", timeoutMs: 5000 })).exitCode).toBe(3);
    expect((await ops().runCheck({ command: "sleep 5", timeoutMs: 1000 })).timedOut).toBe(true);
  });
});

describe("declared git-env modes", () => {
  it("runs each method in the mode HOST_METHOD_MODES declares", async () => {
    const seen: { command: string; hasToken: boolean }[] = [];
    const recording: OpsDeps = {
      run: async (command, args, options) => {
        seen.push({ command: `${command} ${args[0] ?? ""}`, hasToken: options.env.GH_TOKEN !== undefined || options.env.GIT_CONFIG_COUNT !== undefined });
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, notFound: false };
      },
      env: baseEnv({ GH_TOKEN: "t", GIT_CONFIG_COUNT: "0" }),
      homedir: () => home,
      passwdHome: () => passwd,
      emitDeviceCode: async () => {},
      dataDir: () => pluginData,
    };
    const recorded = createOps(recording);
    const paths = sshPaths(home);
    const calls: [keyof typeof HOST_METHOD_MODES, () => Promise<unknown>][] = [
      ["probe", () => recorded.probe()],
      ["gitConfig", () => recorded.gitConfig({ op: "get", key: "gpg.format" })],
      ["sshTest", () => recorded.sshTest({ ...paths, host: "github.com" })],
      ["ghStatus", () => recorded.ghStatus({ host: "github.com" })],
      ["ghAgentsStatus", () => recorded.ghAgentsStatus({ host: "github.com" })],
      ["ghSetupGit", () => recorded.ghSetupGit({ host: "github.com" })],
      ["ghApiRepo", () => recorded.ghApiRepo({ host: "github.com", repo: "example-org/x" })],
      ["runCheck", () => recorded.runCheck({ command: "true", timeoutMs: 1000 })],
      ["toolVersion", () => recorded.toolVersion({ bin: "node", args: [], pattern: "(.*)" })],
    ];
    for (const [method, call] of calls) {
      seen.length = 0;
      await call();
      expect(seen.length, method).toBeGreaterThan(0);
      const wantToken = HOST_METHOD_MODES[method] === "as-agents";
      for (const spawn of seen) expect({ method, spawn: spawn.command, hasToken: spawn.hasToken }).toEqual({ method, spawn: spawn.command, hasToken: wantToken });
    }
    for (const mode of ["raw", "as-agents"] as const) {
      seen.length = 0;
      await recorded.lsRemote({ url: "https://example.com/x.git", mode });
      expect(seen.every((spawn) => spawn.hasToken === (mode === "as-agents"))).toBe(true);
    }
  });
});

describe("host entry contract", () => {
  it("rejects inputs outside the allow-list", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    await expect(harness.experimental_call("toolVersion", { bin: "/bin/sh", args: [], pattern: "x" })).rejects.toThrow();
    await expect(harness.experimental_call("sshKeygen", { keyPath: "relative/key", comment: "x" })).rejects.toThrow();
    await expect(
      harness.experimental_call("gitConfig", { op: "set", key: "credential.helper" as "core.sshCommand", value: "x" }),
    ).rejects.toThrow();
    await expect(
      harness.experimental_call("gitConfig", { op: "set", key: "core.sshCommand", value: "sh -c 'curl evil'" }),
    ).rejects.toThrow();
    await expect(harness.experimental_call("gitConfig", { op: "set", key: "gpg.format", value: "openpgp" })).rejects.toThrow();
    await expect(
      harness.experimental_call("writeKnownHosts", { path: "/tmp/x", lines: ["evil.example.com ssh-ed25519 AAAA; rm -rf /"] }),
    ).rejects.toThrow();
    await harness.experimental_dispose();
  });
});
