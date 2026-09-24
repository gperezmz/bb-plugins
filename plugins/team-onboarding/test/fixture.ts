// A fake bb for server tests: two machines (a server and a remote, each with
// a scratch HOME whose $HOME differs from the passwd home), a fake gh, local
// bare git repos for the manifest and skills, and a scratch data directory.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { runProcess } from "../src/host/exec.js";
import { createOps } from "../src/host/ops.js";
import plugin from "../server.js";

export const SERVER = "host_server";
export const REMOTE = "host_remote";

export interface World {
  root: string;
  dataDir: string;
  homes: Record<string, string>;
  bin: string;
  skillsRepo: string;
  /** Machines that are online. */
  online: Set<string>;
  providerStatus: Record<string, string>;
  hostCalls: { method: string; hostId: string; input: unknown }[];
  terminalInputs: { terminalId: string; text: string }[];
  terminalCreates: unknown[];
  generalSettings: Record<string, unknown>;
  machineEnv: { name: string }[];
  builtInGit: string;
  /** Machines whose $HOME is also their passwd home, as on most workstations. */
  sameHome: Set<string>;
  /** Extra env per machine for the host entry, e.g. a GH_TOKEN agents get. */
  agentsEnv: Record<string, Record<string, string>>;
  /** What `terminals.get` answers per terminal; running when not set. `error` fails the call, `missing` answers 404. */
  terminalStatus: Record<string, { status: string; exitCode: number | null } | "error" | "missing">;
  /** Delay for `providerStates`, to make a check slow; counts every call. */
  providerDelayMs: number;
  providerCalls: number;
  /** An error `setMachineEnvironmentVariable` throws when set, as bb would answer. */
  setEnvError: Error | null;
  installedPlugins: { id: string; version: string }[];
  /** Stops the plugin (its engine waits for checks under way), then removes the scratch folder. */
  cleanup(): Promise<void>;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}

/** A working copy that pushes to a bare repo; returns helpers. */
export function makeRepo(root: string, name: string) {
  const bare = join(root, `${name}.git`);
  const work = join(root, `${name}-work`);
  git(root, "init", "-q", "--bare", bare);
  git(root, "init", "-q", work);
  return {
    bare,
    url: `file://${bare}`,
    write(path: string, text: string) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), text);
    },
    link(path: string, target: string) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      execFileSync("ln", ["-sf", target, join(work, path)]);
    },
    remove(path: string) {
      rmSync(join(work, path), { recursive: true, force: true });
    },
    commit(message = "change") {
      git(work, "add", "-A");
      git(work, "commit", "-q", "--allow-empty", "-m", message);
      git(work, "push", "-q", bare, "HEAD:refs/heads/main");
    },
  };
}

export const skillMd = (name: string, body = "") => `---\nname: ${name}\ndescription: Team skill ${name}.\n---\n\n# ${name}\n${body}`;

export function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), "onboarding-server-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const ghState = join(root, "gh-state");
  mkdirSync(ghState);
  // gh: logged out until a device login "completes".
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
echo "$@" >> "${root}/gh.log"
state="${ghState}/$HOME_TAG"
case "$1 $2" in
  "auth login"|"auth refresh")
    printf '\\n! First copy your one-time code: WXYZ-1234\\nOpen this URL to continue in your web browser: https://github.com/login/device\\n' >&2
    sleep 0.3
    echo done > "$state"
    # Like gh: the token lands in hosts.yml, new on every login.
    mkdir -p "$HOME/.config/gh"; echo "github.com: {user: octo, oauth_token: gho_$$}" > "$HOME/.config/gh/hosts.yml"
    # home-manager: gh saved the token, then couldn't write config.yml.
    if [ -f "${root}/login-save-exit1" ]; then echo "failed to write config to disk: read-only file system" >&2; exit 1; fi
    exit 0 ;;
  "auth setup-git")
    git config --global --replace-all credential.https://github.com.helper "!$GH_PATH auth git-credential"; exit 0 ;;
  "auth status")
    # A GH_TOKEN (as agents see it) is the active entry: tok-<login>, or bad.
    env_entry=""
    case "$GH_TOKEN" in
      "") ;;
      bad) env_entry='{"state":"error","error":"non-200 OK status code: 401 Unauthorized","active":true,"host":"github.com","login":"","tokenSource":"GH_TOKEN","scopes":""}' ;;
      unreachable) env_entry='{"state":"error","error":"dial tcp: lookup api.github.com: no such host","active":true,"host":"github.com","login":"","tokenSource":"GH_TOKEN","scopes":""}' ;;
      *) env_entry='{"state":"success","active":true,"host":"github.com","login":"'"\${GH_TOKEN#tok-}"'","tokenSource":"GH_TOKEN","scopes":"gist, read:org, repo"}' ;;
    esac
    stored=""
    if [ -f "$state" ]; then
      active=true; [ -n "$env_entry" ] && active=false
      stored='{"state":"success","active":'$active',"host":"github.com","login":"octo","tokenSource":"hosts.yml","scopes":"gist, read:org, repo, write:public_key, read:public_key","gitProtocol":"https"}'
    fi
    sep=""; [ -n "$env_entry" ] && [ -n "$stored" ] && sep=","
    echo '{"hosts":{"github.com":['"$env_entry$sep$stored"']}}'
    exit 0 ;;
  "auth token") if [ -f "$state" ]; then echo gho_x; exit 0; fi; exit 1 ;;
  "api -i")
    if [ -f "${root}/api-ok" ]; then printf 'HTTP/2.0 200 OK\\n'; exit 0; fi
    printf 'HTTP/2.0 404 Not Found\\n'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
esac
case "$1" in --version) echo "gh version 2.101.0 (test)"; exit 0 ;; esac
exit 0
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const homes: Record<string, string> = {};
  for (const id of [SERVER, REMOTE]) {
    homes[id] = join(root, `home-${id}`);
    mkdirSync(homes[id]!, { recursive: true });
    mkdirSync(join(root, `passwd-${id}`), { recursive: true });
  }
  const manifest = makeRepo(root, "manifest");
  const skills = makeRepo(root, "skills");
  // The server side runs gh and git from this process: keep them off the
  // real machine's login and tokens.
  const savedEnv = { PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  const restoreEnv = () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const dataDir = join(root, "data");
  mkdirSync(join(dataDir, "skills"), { recursive: true });
  const world = {
    root,
    dataDir,
    homes,
    bin,
    skillsRepo: skills.url,
    online: new Set([SERVER, REMOTE]),
    providerStatus: { [SERVER]: "ready", [REMOTE]: "ready" },
    hostCalls: [],
    terminalInputs: [],
    terminalCreates: [],
    generalSettings: {
      defaultMachineAccess: null,
      defaultProviderId: null,
      machineGitCredentialsEnabled: true,
      machineServerUrl: null,
      managedBranchPrefix: "bb/",
      providerCompletedTurnDisplay: {},
      providerOrder: [],
      showDiagnosticEvents: false,
      showKeyboardHints: true,
      steerActiveThreadOnEnter: false,
      streamerMode: false,
      telemetryEnabled: false,
    },
    machineEnv: [],
    builtInGit: "not logged in",
    agentsEnv: {},
    sameHome: new Set(),
    setEnvError: null,
    terminalStatus: {},
    providerDelayMs: 0,
    providerCalls: 0,
    installedPlugins: [],
    cleanup: async () => {
      await (world as unknown as { dispose?: () => Promise<void> }).dispose?.();
      restoreEnv();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
    // Repos are returned through helpers below.
    ...({ _manifest: manifest, _skills: skills } as object),
  } as World;
  return world;
}

export function repos(world: World) {
  const w = world as unknown as { _manifest: ReturnType<typeof makeRepo>; _skills: ReturnType<typeof makeRepo> };
  return { manifest: w._manifest, skills: w._skills };
}

export async function boot(world: World, settings: Record<string, string | number | boolean> = {}) {
  const opsFor = (hostId: string) =>
    createOps({
      run: runProcess,
      env: {
        PATH: `${world.bin}:${process.env.PATH ?? ""}`,
        HOME: world.homes[hostId]!,
        HOME_TAG: hostId,
        GIT_CONFIG_NOSYSTEM: "1",
        ...world.agentsEnv[hostId],
      },
      homedir: () => world.homes[hostId]!,
      passwdHome: () => (world.sameHome.has(hostId) ? world.homes[hostId]! : join(world.root, `passwd-${hostId}`)),
      emitDeviceCode: async (payload) => {
        await harness.behavior.experimental_emitHostSignal(hostId, "deviceCode", payload);
      },
      dataDir: () => join(world.root, `plugin-data-${hostId}`),
    });
  let terminalCount = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "team-onboarding",
    dataDir: world.dataDir,
    settings,
    agentSkillIds: ["team-onboarding"],
    experimental_callHostRpc: async ({ method, input, hostId, signal }) => {
      world.hostCalls.push({ method, hostId, input });
      if (!world.online.has(hostId)) throw new Error("host disconnected");
      const ops = opsFor(hostId) as unknown as Record<string, (input: unknown, signal?: AbortSignal) => Promise<unknown>>;
      return ops[method]!(input, signal);
    },
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: SERVER, name: "server", status: world.online.has(SERVER) ? "connected" : "disconnected", type: "persistent" }),
          makeHostResponse({
            id: REMOTE,
            name: "laptop",
            status: world.online.has(REMOTE) ? "connected" : "disconnected",
            type: "persistent",
            lastSeenAt: Date.now() - 3600_000,
          }),
        ],
        installProviderCli: async () => ({}) as never,
      },
      system: {
        config: async () => ({ primaryHostId: SERVER, generalSettings: { ...world.generalSettings } }) as never,
        providerStates: async (args?: { hostId?: string }) => {
          world.providerCalls += 1;
          if (world.providerDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, world.providerDelayMs));
          return {
            providers: [
              {
                providerId: "claude-code",
                displayName: "Claude Code",
                status: world.providerStatus[args?.hostId ?? SERVER] ?? "ready",
                statusMessage: null,
                accountEmail: null,
                planLabel: null,
                installedVersion: "2.1.281",
                minimumSupportedVersion: null,
                canInstall: true,
                canUpdate: false,
                loginCommand: "claude /login",
              },
            ],
          } as never;
        },
        machineEnvironment: async () =>
          ({ builtInGit: { status: world.builtInGit, statusMessage: "" }, variables: world.machineEnv.map((v) => ({ ...v, note: null, secret: true, value: null })) }) as never,
        setMachineEnvironmentVariable: async (input: { name: string }) => {
          if (world.setEnvError !== null) throw world.setEnvError;
          world.machineEnv.push({ name: input.name });
          return {} as never;
        },
        updateGeneralSettings: async (next: Record<string, unknown>) => {
          world.generalSettings = { ...next };
          world.builtInGit = next.machineGitCredentialsEnabled === false ? "disabled" : world.builtInGit;
          return {} as never;
        },
        version: async () => ({ currentVersion: "0.43.4", latestVersion: "0.43.4", updateAvailable: false, upgradeCommand: "npm i -g bb-app", isDevelopment: false, source: "npm" }) as never,
      },
      plugins: {
        list: async () => ({ plugins: world.installedPlugins }) as never,
        checkUpdates: async () => [] as never,
        install: async (args: { source: string }) => {
          world.installedPlugins.push({ id: args.source.includes("helper") ? "helper" : "unknown", version: "1.0.0" });
          return {} as never;
        },
        getSettings: async () => ({ values: {} }) as never,
        marketplaces: { list: async () => [] as never },
      },
      terminals: {
        create: async (args: unknown) => {
          world.terminalCreates.push(args);
          terminalCount += 1;
          return { id: `term-${terminalCount}`, status: "running" } as never;
        },
        input: async (args: { terminalId: string; dataBase64: string }) => {
          world.terminalInputs.push({ terminalId: args.terminalId, text: Buffer.from(args.dataBase64, "base64").toString("utf8") });
          return {} as never;
        },
        get: async (args: { terminalId: string }) => {
          const answer = world.terminalStatus[args.terminalId] ?? { status: "running", exitCode: null };
          if (answer === "error") throw new Error("socket hang up");
          if (answer === "missing") throw Object.assign(new Error("Terminal not found"), { name: "BbHttpError", status: 404, code: "not_found" });
          return answer as never;
        },
      },
      files: {
        read: async (args: { path: string }) => ({ content: readFileSync(args.path, "utf8"), contentEncoding: "utf8" }) as never,
      },
      subscribe: () => () => {},
    },
  });
  await plugin(bb);
  (world as unknown as { dispose?: () => Promise<void> }).dispose = () => harness.lifecycle.dispose();
  return { bb, harness };
}

/** Waits until `check` passes, polling. */
export async function until<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
