// Runs one item's check on one machine and reports an outcome, a category,
// a redacted detail and small facts. Raw output goes back separately and the
// engine keeps it in memory only.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Probe } from "../contract/host.js";
import { GITHUB_KNOWN_HOSTS } from "../core/github-keys.js";
import type { Manifest } from "../core/manifest.js";
import type { Facts, ItemDef, Outcome } from "../core/model.js";
import { atLogin, CATEGORY_TEXT, classifyGhAuthStatus, hasScope, isEnvToken, isShareableLogin, type GhAuthStatus } from "../core/redact.js";
import type { Machine } from "../core/status.js";
import { compareVersions } from "../core/version.js";
import { sshConfigText } from "../host/ops.js";
import { NoHostEntryError, type HostGateway } from "./gateway.js";
import { assertPublicUrl, InternalHostError } from "./netguard.js";
import { timed } from "./meter.js";
import type { SkillsSync } from "./skills-sync.js";

export interface CheckOutput {
  outcome: Outcome;
  category: string;
  detail: string;
  facts: Facts;
  raw?: string;
  links?: { label: string; url: string }[];
}

export interface ManifestState {
  status: "none" | "ok" | "error" | "loading";
  manifest: Manifest | null;
  error: string | null;
}

/** Per-run caches so one run asks each machine and bb only once. */
export class RunContext {
  private readonly cache = new Map<string, Promise<unknown>>();
  constructor(
    readonly bb: BbPluginApi,
    readonly gateway: HostGateway,
    readonly signal?: AbortSignal,
    /** The engineer started this run (Recheck, a fix): git may ask its credential helpers. */
    readonly interactive = false,
    /** The schedule started this run: results whose inputs didn't change may be reused. */
    readonly scheduled = false,
  ) {}

  once<T>(key: string, make: () => Promise<T>): Promise<T> {
    let value = this.cache.get(key) as Promise<T> | undefined;
    if (value === undefined) {
      value = timed(`ctx:${key.split(":")[0]}`, make());
      // Failures aren't cached: a later check may succeed.
      value.catch(() => this.cache.delete(key));
      this.cache.set(key, value);
    }
    return value;
  }

  probe(hostId: string): Promise<Probe> {
    return this.once(`probe:${hostId}`, () => this.gateway.probe(hostId, { signal: this.signal }));
  }
  ghStatus(hostId: string, host: string) {
    return this.once(`gh:${hostId}:${host}`, () => this.gateway.call("ghStatus", hostId, { host }, { signal: this.signal }));
  }
  /** gh's answer with the environment agents get there, GH_TOKEN included. */
  ghAgentsStatus(hostId: string, host: string) {
    return this.once(`gh-agents:${hostId}:${host}`, () => this.gateway.call("ghAgentsStatus", hostId, { host }, { signal: this.signal }));
  }
  providerStates(hostId: string) {
    return this.once(`providers:${hostId}`, () => this.bb.sdk.system.providerStates({ hostId, signal: this.signal }));
  }
  machineEnvironment() {
    return this.once("machine-env", () => this.bb.sdk.system.machineEnvironment());
  }
  config() {
    return this.once("config", () => this.bb.sdk.system.config({ signal: this.signal }));
  }
  plugins() {
    return this.once("plugins", () => this.bb.sdk.plugins.list());
  }
  pluginUpdates() {
    return this.once("plugin-updates", () => this.bb.sdk.plugins.checkUpdates());
  }
  marketplaces() {
    return this.once("marketplaces", () => this.bb.sdk.plugins.marketplaces.list());
  }
  version() {
    return this.once("version", () => this.bb.sdk.system.version());
  }
  /** GitHub's live host keys, to notice a rotation. Null when unreachable. */
  /** Whether the manifest's GitHub host resolves to public addresses only. */
  hostAllowed(host: string): Promise<boolean> {
    return this.once(`host-ok:${host}`, () =>
      assertPublicUrl(`https://${host}/`).then(
        () => true,
        (error) => {
          if (error instanceof InternalHostError) return false;
          throw error;
        },
      ),
    );
  }

  githubMeta(): Promise<string[] | null> {
    return this.once("github-meta", async () => {
      try {
        const response = await fetch("https://api.github.com/meta", {
          headers: { accept: "application/vnd.github+json" },
          signal: this.signal,
        });
        if (!response.ok) return null;
        const meta = (await response.json()) as { ssh_keys?: string[] };
        return (meta.ssh_keys ?? []).map((key) => `github.com ${key}`);
      } catch {
        return null;
      }
    });
  }
}

export interface CheckEnv {
  context: RunContext;
  manifest: ManifestState;
  skills: SkillsSync;
  approved: ReadonlySet<string>;
  machines: readonly Machine[];
}

const pass = (detail: string, facts: Facts = {}, raw?: string): CheckOutput => ({ outcome: "pass", category: "ok", detail, facts, raw });
const fail = (category: string, detail?: string, facts: Facts = {}, raw?: string): CheckOutput => ({
  outcome: "fail",
  category,
  detail: detail ?? CATEGORY_TEXT[category] ?? "Needs attention.",
  facts,
  raw,
});
const error = (category: string, detail: string, raw?: string): CheckOutput => ({ outcome: "error", category, detail, facts: {}, raw });

export async function runCheck(item: ItemDef, machine: Machine, env: CheckEnv): Promise<CheckOutput> {
  try {
    return await check(item, machine, env);
  } catch (cause) {
    if (cause instanceof NoHostEntryError) {
      return error("no-host-entry", `The onboarding helper can't run on ${machine.name}. Use Check in terminal.`);
    }
    if (env.context.signal?.aborted) throw cause;
    return error("error", "The check couldn't run.", cause instanceof Error ? cause.message : String(cause));
  }
}

async function check(item: ItemDef, machine: Machine, env: CheckEnv): Promise<CheckOutput> {
  const { context } = env;
  const manifest = env.manifest.manifest;
  const spec = item.check;
  switch (spec.kind) {
    case "skills-orphaned":
      return {
        outcome: "update",
        category: "removed",
        detail: `No longer in your team's manifest: ${spec.folders.join(", ")}.`,
        facts: { removed: spec.folders },
      };
    case "manifest": {
      switch (env.manifest.status) {
        case "ok":
          return pass("Loaded.", { teamName: manifest?.team.name ?? null });
        case "none":
          // Not an item then (items.ts); kept so the switch covers every status.
          return pass("No team manifest on this server; it doesn't apply.");
        case "loading":
          return error("loading", "Loading the manifest…");
        case "error":
          return fail("invalid", env.manifest.error ?? "The manifest file couldn't be used.");
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "bb-version": {
      const version = await context.version();
      if (version.updateAvailable && version.latestVersion !== null) {
        return {
          outcome: "update",
          category: "update",
          detail: `bb ${version.latestVersion} is available (you have ${version.currentVersion}).`,
          facts: { upgradeCommand: version.upgradeCommand, version: version.currentVersion },
        };
      }
      return pass(`bb ${version.currentVersion}.`, { version: version.currentVersion });
    }
    case "gh-installed": {
      const probe = await context.probe(machine.id);
      if (probe.ghPath === null) {
        return fail("not-installed", "gh isn't installed on the server machine.", { platform: probe.platform });
      }
      return pass(`gh ${probe.ghVersion ?? ""} is installed.`.replace("  ", " "), { version: probe.ghVersion, platform: probe.platform });
    }
    case "gh-login": {
      const status = await context.ghStatus(machine.id, spec.host);
      if (!status.installed) return fail("not-installed", "Install gh first.", {}, status.output);
      const auth = classifyGhAuthStatus(status.stdout, spec.host, spec.scopes);
      const perMachine = manifest?.github.mode === "per-machine";
      // What agents act as: a GH_TOKEN in their environment beats any gh login.
      const agents = await agentsAuth(context, machine.id, spec.host, spec.scopes);
      if (agents !== null && isEnvToken(agents.auth.tokenSource)) {
        return envTokenOutcome(agents.auth, auth, agents.raw, status.output);
      }
      const facts: Facts = {
        login: auth.login,
        missingScopes: auth.missingScopes,
        tokenSource: isEnvToken(auth.tokenSource) ? auth.tokenSource : auth.tokenSource === null ? null : "gh",
      };
      if (auth.category === "env-token") {
        return fail(
          "env-token",
          "A GH_TOKEN machine variable overrides the login, and gh can't refresh it. Update or remove that variable.",
          facts,
          status.output,
        );
      }
      if (auth.state !== "logged-in") {
        const breaks = perMachine
          ? `Agents on ${machine.name} can't push until you log in again.`
          : "Agents on all machines can't push until you log in again.";
        return fail(auth.category === "expired" ? "expired" : "not-logged-in", auth.category === "expired" ? breaks : "Not logged in to GitHub.", facts, status.output);
      }
      if (auth.category === "missing-scope") {
        return fail(
          "missing-scope",
          `Logged in as ${atLogin(auth.login)}, but missing ${auth.missingScopes.join(", ")}.`,
          facts,
          status.output,
        );
      }
      if (!status.credentialReady) {
        return fail("no-git-helper", `Logged in as ${atLogin(auth.login)}, but git doesn't use gh for HTTPS yet.`, facts, status.output);
      }
      return pass(`Logged in as ${atLogin(auth.login)}.`, facts, status.output);
    }
    case "builtin-git":
      return checkBuiltinGit(machine, env);
    case "github-mode": {
      const config = await context.config();
      return config.generalSettings.machineGitCredentialsEnabled
        ? fail("builtin", "bb still shares the server's GitHub login with every machine.")
        : pass("Every machine uses its own GitHub login.");
    }
    case "repo-access":
      return checkAccess(spec, machine, env);
    case "ssh-key":
    case "ssh-known-hosts":
    case "ssh-config":
    case "ssh-uploaded":
    case "ssh-signing":
      return checkSsh(spec, item, machine, env);
    case "provider": {
      const states = await context.providerStates(machine.id);
      const state = states.providers.find((provider) => provider.providerId === spec.providerId);
      if (state === undefined) return fail("not-installed", "bb doesn't know this agent.");
      const facts: Facts = {
        canInstall: state.canInstall,
        canUpdate: state.canUpdate,
        loginCommand: state.loginCommand,
        installedVersion: state.installedVersion,
      };
      switch (state.status) {
        case "ready":
          return pass(state.installedVersion === null ? "Ready." : `Ready (${state.installedVersion}).`, facts);
        case "not_installed":
          return { ...fail("not_installed", `Not installed on ${machine.name}.`, facts) };
        case "unauthenticated":
          return fail(
            "unauthenticated",
            state.loginCommand === null ? providerHint(state.displayName, states) : `Not logged in on ${machine.name}.`,
            facts,
          );
        case "expired":
          return fail("expired", `The login on ${machine.name} expired.`, facts);
        case "unsupported_version":
          return fail("unsupported_version", `Version ${state.installedVersion ?? "?"} is too old; bb needs ${state.minimumSupportedVersion ?? "a newer one"}.`, facts);
        default:
          return error("unknown", state.statusMessage === null ? "bb couldn't tell." : "bb couldn't tell.");
      }
    }
    case "skills": {
      const entry = manifest?.skills.find((skill) => skill.id === spec.entryId);
      if (entry === undefined || manifest === null) return error("error", "Not in the manifest.");
      if (entry.source === "plugin") {
        const result = await checkPlugin(item, entry.id, entry.install, undefined, env);
        return { ...result, facts: { ...result.facts, source: "plugin" } };
      }
      const result = await env.skills.check(entry, manifest, context.signal, context.scheduled);
      return { outcome: result.outcome, category: result.category, detail: result.detail, facts: result.facts, raw: result.raw };
    }
    case "plugin": {
      const entry = manifest?.plugins.find((plugin) => plugin.id === spec.entryId);
      if (entry === undefined) return error("error", "Not in the manifest.");
      return checkPlugin(item, entry.id, entry.install, entry.settings, env);
    }
    case "marketplace": {
      const entry = manifest?.marketplaces.find((marketplace) => marketplace.id === spec.entryId);
      if (entry === undefined) return error("error", "Not in the manifest.");
      if (!item.commands.every((command) => env.approved.has(command.hash))) {
        return { outcome: "needs-approval", category: "needs-approval", detail: "Your team wants to add a plugin marketplace. Review its source first.", facts: {} };
      }
      const list = await context.marketplaces();
      const found = list.find((marketplace) => sameSource(marketplace.source, entry.source) || marketplace.name === entry.id);
      return found === undefined ? fail("not-installed", "Not added yet.") : pass(`Added (${found.entryCount} plugins).`);
    }
    case "tool": {
      const raw = await env.context.gateway.call("toolVersion", machine.id, { bin: spec.bin, args: spec.args, pattern: spec.pattern }, { signal: context.signal });
      // Only a version number is kept: whatever else the team's pattern
      // captured stays in the (redacted, in-memory) raw output.
      const result = { ...raw, version: versionOnly(raw.version) };
      const entry = manifest?.tools.find((tool) => tool.id === spec.entryId);
      const facts: Facts = { version: result.version, hint: entry?.hint ?? null };
      if (!result.found) return fail("not-installed", `${spec.bin} isn't installed on ${machine.name}.`, facts, result.output);
      if (spec.min !== null) {
        if (result.version === null) return fail("unknown-version", `Couldn't read the version of ${spec.bin}.`, facts, result.output);
        if (compareVersions(result.version, spec.min) < 0) {
          return fail("too-old", `${spec.bin} ${result.version} is older than ${spec.min}.`, facts, result.output);
        }
      }
      return pass(result.version === null ? "Installed." : `${spec.bin} ${result.version}.`, facts, result.output);
    }
    case "env": {
      const machineEnv = await context.machineEnvironment();
      const found = machineEnv.variables.some((variable) => variable.name === spec.name);
      return found ? pass("Set for every machine.") : fail("not-set", "Not set yet.");
    }
    case "team-check": {
      const run = item.commands.find((command) => command.role === "run")!;
      const fixCommand = item.commands.find((command) => command.role === "fix");
      const entry = manifest?.checks.find((c) => c.id === spec.entryId);
      const facts: Facts = { fixKind: entry?.fix?.kind ?? null };
      if (!env.approved.has(run.hash)) {
        return {
          outcome: "needs-approval",
          category: "needs-approval",
          detail: "A command from your team. Review it before it runs.",
          facts: { ...facts, fixPending: fixCommand !== undefined && !env.approved.has(fixCommand.hash) },
        };
      }
      const result = await env.context.gateway.call("runCheck", machine.id, { command: spec.command, timeoutMs: 60_000 }, { timeoutMs: 75_000, signal: context.signal });
      if (result.timedOut) return error("timeout", "The check took longer than a minute.", result.output);
      return result.exitCode === 0
        ? pass("Passes.", facts, result.output)
        : fail("failed", `The check failed (exit ${result.exitCode}).`, facts, result.output);
    }
  }
}

/** `2.55.0`, `v22.1.0`, `1.9.17p2`, `21.0.2+13-LTS`: a version number, or nothing. */
export function versionOnly(captured: string | null): string | null {
  const match = captured === null ? null : /\bv?(\d+(?:\.\d+){0,3}(?:[-+.p][A-Za-z0-9]{1,12}){0,3})\b/.exec(captured);
  return match === null ? null : match[1]!.slice(0, 40);
}

function providerHint(displayName: string, _states: unknown): string {
  return `Not logged in. Sign in to ${displayName} on this machine; bb shows how in Settings → Providers.`;
}

async function checkPlugin(
  item: ItemDef,
  pluginId: string,
  install: string,
  settings: Record<string, string | number | boolean> | undefined,
  env: CheckEnv,
): Promise<CheckOutput> {
  if (!item.commands.every((command) => env.approved.has(command.hash))) {
    return {
      outcome: "needs-approval",
      category: "needs-approval",
      detail: "Plugins run with full trust. Review its source before it's installed.",
      facts: {},
    };
  }
  const list = await env.context.plugins();
  const installed = list.plugins.find((plugin) => plugin.id === pluginId);
  if (installed === undefined) return fail("not-installed", "Not installed yet.");
  const updates = await env.context.pluginUpdates().catch(() => []);
  const update = updates.find((entry) => entry.id === pluginId);
  if (update?.outcome === "update-available") {
    return {
      outcome: "update",
      category: "update",
      detail: `Version ${update.candidate?.display ?? "newer"} is available (you have ${update.installed.display}).`,
      facts: { version: installed.version },
    };
  }
  if (settings !== undefined && Object.keys(settings).length > 0) {
    const current = await env.context.bb.sdk.plugins.getSettings({ pluginId });
    const values = (current as { values?: Record<string, unknown> }).values ?? {};
    const differs = Object.entries(settings).filter(([key, value]) => values[key] !== value).map(([key]) => key);
    if (differs.length > 0) return fail("settings", `Team settings not applied: ${differs.join(", ")}.`, { version: installed.version });
  }
  return pass(`Installed (${installed.version}).`, { version: installed.version });
}

function sameSource(a: string, b: string): boolean {
  const normalise = (value: string) => value.replace(/^git:/, "").replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  return normalise(a) === normalise(b);
}

/** gh's answer for agents on a machine, or null when the host can't say. */
async function agentsAuth(context: RunContext, hostId: string, host: string, scopes: readonly string[]) {
  const status = await context.ghAgentsStatus(hostId, host).catch(() => null);
  if (status === null || !status.installed) return null;
  return { auth: classifyGhAuthStatus(status.stdout, host, scopes), raw: status.output };
}

/**
 * `github.login` when agents get a token from their environment: it is what
 * they act as, so it decides the item. gh's own stored login is reported
 * next to it, and a device login stays on offer as an extra.
 */
function envTokenOutcome(agents: GhAuthStatus, stored: GhAuthStatus, agentsRaw: string, storedRaw: string): CheckOutput {
  const variable = agents.tokenSource!;
  const storedLogin = stored.state === "logged-in" ? stored.login : null;
  const facts: Facts = {
    login: agents.login,
    storedLogin,
    tokenSource: variable,
    missingScopes: agents.missingScopes,
  };
  const raw = [agentsRaw, storedRaw].filter(Boolean).join("\n");
  if (agents.state !== "logged-in" && agents.errorKind === "unreachable") {
    return error("network", `Couldn't reach GitHub to check the ${variable} agents use.`, raw);
  }
  if (agents.state !== "logged-in") {
    return fail(
      "env-token-invalid",
      `Agents get a ${variable} that GitHub doesn't accept, and it takes precedence over any gh login. Replace or remove it where it is set.`,
      facts,
      raw,
    );
  }
  if (agents.missingScopes.length > 0) {
    return fail(
      "env-token-scope",
      `Agents use a token from ${variable} (${atLogin(agents.login)}), but it lacks ${agents.missingScopes.join(", ")}. gh can't add permissions to it; replace the token where ${variable} is set.`,
      facts,
      raw,
    );
  }
  let detail = `Agents use a token from ${variable} (${atLogin(agents.login)}).`;
  if (storedLogin !== null && storedLogin !== agents.login) {
    detail += ` gh's own login here is a different account, ${atLogin(storedLogin)}; ${variable} takes precedence while it is set.`;
  } else if (storedLogin !== null) {
    detail += " gh's own login is saved here too.";
  }
  return { outcome: "pass", category: "agents-token", detail, facts, raw };
}

/**
 * `github.builtin-git` on one machine: do agents there get GitHub? bb's own
 * status answers when it shares the server's login. When it shares nothing,
 * each other machine is asked what its agents reach GitHub with, and the
 * detail says why bb isn't sharing.
 */
async function checkBuiltinGit(machine: Machine, env: CheckEnv): Promise<CheckOutput> {
  const { context } = env;
  const machineEnv = await context.machineEnvironment();
  const { status, statusMessage } = machineEnv.builtInGit;
  switch (status) {
    case "logged in":
      return pass(
        "bb shares the server's GitHub login with agents on your other machines: a token, an HTTPS credential helper, and git@github.com URLs rewritten to HTTPS.",
        { builtInGit: status },
      );
    case "overridden":
      return pass("A GH_TOKEN machine variable replaces the server's login on every machine.", { builtInGit: status });
    case "disabled":
      return fail("disabled", "Turned off in Settings → General, so agents on other machines have no GitHub access.", { builtInGit: status });
  }
  // bb shares nothing. The server's own agents are github.login's business.
  const others = env.machines.filter((candidate) => !candidate.isServer && candidate.persistent);
  if (machine.isServer) {
    return pass(
      others.length === 0
        ? "No other machines yet. Agents here use this machine's own GitHub login (above)."
        : "Agents here use this machine's own GitHub login (above). bb isn't sharing it with your other machines; see their chips.",
      { builtInGit: status },
    );
  }
  const host = env.manifest.manifest?.github.host ?? "github.com";
  const here = await agentsAuth(context, machine.id, host, []);
  if (here !== null && here.auth.state === "logged-in") {
    const source = isEnvToken(here.auth.tokenSource) ? here.auth.tokenSource : "gh login";
    return pass(`bb isn't sharing the server's login, but agents here reach GitHub as ${atLogin(here.auth.login)} with this machine's own ${source}.`, {
      builtInGit: status,
      login: here.auth.login,
    }, here.raw);
  }
  if (here !== null && here.auth.errorKind === "unreachable") return error("network", CATEGORY_TEXT.network!, here.raw);
  const server = env.machines.find((candidate) => candidate.isServer);
  const serverAgents = server === undefined ? null : await agentsAuth(context, server.id, host, []);
  const raw = [statusMessage, here?.raw ?? ""].filter(Boolean).join("\n");
  const serverLogin = serverAgents?.auth.state === "logged-in" ? serverAgents.auth.login : null;
  if (serverLogin !== null && !isShareableLogin(serverLogin)) {
    const version = await context.version().then((v) => ` ${v.currentVersion}`, () => "");
    return fail(
      "login-name",
      `bb shares nothing with ${machine.name}: bb${version} only shares a GitHub login made of letters, digits and dashes, and @${serverLogin} has an underscore (a managed account). Agents here have no GitHub access until this machine has its own login.`,
      { builtInGit: status, serverLogin },
      raw,
    );
  }
  if (serverLogin !== null) {
    return fail(
      "not-shared",
      `The server is logged in as @${serverLogin}, but bb couldn't read that login to share it, so agents on ${machine.name} have no GitHub access. Log in on this machine, or ask an agent to look at Show details.`,
      { builtInGit: status, serverLogin },
      raw,
    );
  }
  return fail("not-logged-in", "Turns on by itself once the server is logged in to GitHub.", { builtInGit: status }, raw);
}

async function checkAccess(
  spec: Extract<ItemDef["check"], { kind: "repo-access" }>,
  machine: Machine,
  env: CheckEnv,
): Promise<CheckOutput> {
  const { context } = env;
  if (!(await context.hostAllowed(spec.host))) return fail("blocked", CATEGORY_TEXT.blocked);
  const perMachine = env.manifest.manifest?.github.mode === "per-machine";
  const links: { label: string; url: string }[] = [];
  const mode = machine.isServer || perMachine ? "raw" : "as-agents";
  // gh answers first, with what agents use there: the machine's own login, or
  // on other machines the GH_TOKEN bb gives agents.
  const api = await context.gateway.call("ghApiRepo", machine.id, { host: spec.host, repo: spec.repo, mode }, { signal: context.signal });
  let raw = api.output;
  if (api.ssoUrl !== null) links.push({ label: "Authorise on GitHub", url: api.ssoUrl });
  // Without gh git may still get in (an SSH key, say): only a definite
  // answer from GitHub stops here.
  if (api.category !== "ok" && api.category !== "no-auth") {
    return { outcome: api.category === "network" ? "error" : "fail", category: api.category, detail: CATEGORY_TEXT[api.category] ?? "No access.", facts: {}, raw, links };
  }
  // Then git itself, over the transport in use.
  const probe = await context.probe(machine.id);
  const sshConfigured = probe.ssh.sshCommand !== null && probe.ssh.sshCommand.includes(probe.ssh.configPath);
  const useSsh = (machine.isServer || perMachine) && sshConfigured;
  // A scheduled check never lets git ask credential helpers (a Mac's keychain
  // can prompt), so over HTTPS gh's answer stands for git's.
  if (!useSsh && !context.interactive && api.category === "ok") {
    return {
      outcome: "pass",
      category: "ok",
      detail: "GitHub confirms agents can read it (checked with gh). Recheck also tries git's own credentials.",
      facts: { transport: "https", checkedWith: "gh" },
      raw,
      links,
    };
  }
  const url = useSsh ? `git@${spec.host}:${spec.repo}.git` : `https://${spec.host}/${spec.repo}.git`;
  const helpers = context.interactive;
  let ls = await context.gateway.call("lsRemote", machine.id, { url, mode, helpers }, { timeoutMs: 60_000, signal: context.signal });
  raw += `\n${ls.output}`;
  let overSsh = useSsh;
  // No HTTPS credentials, but the machine may have its own working SSH setup.
  if (ls.category === "no-auth" && !useSsh && mode === "raw") {
    const viaSsh = await context.gateway.call("lsRemote", machine.id, { url: `git@${spec.host}:${spec.repo}.git`, mode, helpers }, { timeoutMs: 60_000, signal: context.signal });
    raw += `\n${viaSsh.output}`;
    if (viaSsh.category === "ok" || viaSsh.category === "no-access") {
      ls = viaSsh;
      overSsh = true;
    }
  }
  if (ls.category === "no-auth" && !overSsh && !helpers) {
    return {
      outcome: "error",
      category: "needs-recheck",
      detail: "gh can't confirm access here, and a scheduled check doesn't use git's credential helpers. Press Recheck to try them.",
      facts: { transport: "https" },
      raw,
      links,
    };
  }
  if (ls.category !== "ok") {
    const detail =
      (ls.category === "no-auth"
        ? "No working credentials for GitHub. Log in to GitHub (above), or set up SSH."
        : (CATEGORY_TEXT[ls.category] ?? "git can't read it.")) + (overSsh ? withoutSshConfig(context, probe) : "");
    return { outcome: ls.category === "network" ? "error" : "fail", category: ls.category, detail, facts: { transport: overSsh ? "ssh" : "https" }, raw, links };
  }
  return { outcome: "pass", category: "ok", detail: `Agents can read it over ${overSsh ? "SSH" : "HTTPS"}.`, facts: { transport: overSsh ? "ssh" : "https" }, raw, links };
}

async function checkSsh(
  spec: ItemDef["check"],
  item: ItemDef,
  machine: Machine,
  env: CheckEnv,
): Promise<CheckOutput> {
  const { context } = env;
  const manifest = env.manifest.manifest;
  const host = manifest?.github.host ?? "github.com";
  if (!(await context.hostAllowed(host))) return fail("blocked", CATEGORY_TEXT.blocked);
  const probe = await context.probe(machine.id);
  const ssh = probe.ssh;
  const keyOk = ssh.keyExists && ssh.keyMode !== null && (ssh.keyMode & 0o077) === 0;
  const facts: Facts = {
    keyExists: ssh.keyExists,
    keyPath: ssh.keyPath,
    publicKey: ssh.publicKey,
    homeDiffers: probe.homedir !== probe.passwdHome,
  };

  // An existing setup is left alone: no bb key, $HOME is the passwd home and
  // git over SSH already reaches GitHub.
  if (!ssh.keyExists && probe.homedir === probe.passwdHome && item.id !== "ssh.signing") {
    const existing = await context.once(`ssh-existing:${machine.id}`, async () => {
      const repo = manifest?.github.access[0]?.repo ?? (host === "github.com" ? "github/gitignore" : null);
      if (repo === null) return false;
      // A click tries the user's own ssh config and agent too.
      const ls = await context.gateway.call(
        "lsRemote",
        machine.id,
        { url: `git@${host}:${repo}.git`, mode: "raw", helpers: context.interactive },
        { timeoutMs: 60_000, signal: context.signal },
      );
      return ls.category === "ok";
    });
    if (existing) return pass("Your existing SSH setup already reaches GitHub. Nothing to change.", { ...facts, existing: true });
    // The background can't see a key in an SSH agent or named in ~/.ssh/config.
    // Saying "missing" would offer safe fixes that point git's SSH at a new key
    // and break a setup that works, so wait for a click to look properly.
    if (!context.interactive && (probe.userSshConfig || probe.sshAgent)) {
      return error(
        "needs-recheck",
        "Checked without your SSH agent and ssh config, which may hold a key that already works. Recheck to look with them.",
      );
    }
  }

  switch (spec.kind) {
    case "ssh-key":
      if (!ssh.keyExists && !probe.sshDirWritable) {
        // Nothing bb can write: the command to run where the folder is managed.
        return fail(
          "read-only",
          `Managed outside bb: ${shortPath(ssh.keyPath.replace(/\/[^/]+$/, ""), probe.homedir)} is read-only, so bb can't create its key there. Create it where you manage that folder, keeping the private key out of the Nix store.`,
          { ...facts, addThere: `ssh-keygen -t ed25519 -N '' -C bb@${machine.name.replace(/[^\w.-]/g, "-")} -f '${ssh.keyPath}'` },
        );
      }
      if (!ssh.keyExists) return fail("missing", `No SSH key for bb on this machine yet.${withoutSshConfig(context, probe)}`, facts);
      if (!keyOk) return fail("bad-mode", `The key's permissions are too open (${(ssh.keyMode ?? 0).toString(8)}); ssh ignores it.`, facts);
      return pass(`${shortPath(ssh.keyPath, probe.homedir)} exists.`, facts);
    case "ssh-known-hosts": {
      if (host !== "github.com") return pass("Pinned host keys only apply to github.com.", facts);
      const missing = GITHUB_KNOWN_HOSTS.filter((line) => !ssh.knownHostsLines.includes(line));
      if (missing.length > 0 && !probe.knownHostsWritable) {
        return readOnly(shortPath(ssh.knownHostsPath, probe.homedir), GITHUB_KNOWN_HOSTS.join("\n"), facts);
      }
      if (missing.length > 0) return fail("missing", "GitHub's host keys aren't pinned yet.", facts);
      const live = await context.githubMeta();
      if (live !== null && live.length > 0 && live.some((line) => !GITHUB_KNOWN_HOSTS.includes(line))) {
        return { outcome: "update", category: "rotated", detail: "GitHub rotated its keys; update the plugin.", facts };
      }
      return pass("GitHub's published keys are pinned.", facts);
    }
    case "ssh-config": {
      const wants = [`IdentityFile ${ssh.keyPath}`, `UserKnownHostsFile ${ssh.knownHostsPath}`];
      const configOk = ssh.configText !== null && wants.every((line) => ssh.configText!.includes(line));
      const commandOk = ssh.sshCommand !== null && ssh.sshCommand.includes(ssh.configPath);
      if (!configOk && !probe.configWritable) {
        const text = sshConfigText({ host, keyPath: ssh.keyPath, knownHostsPath: ssh.knownHostsPath, include: null });
        return readOnly(shortPath(ssh.configPath, probe.homedir), text, facts);
      }
      if (!configOk) return fail("missing", "No SSH config for git yet.", facts);
      if (!commandOk && !probe.gitGlobal.writable) {
        return readOnly(shortPath(probe.gitGlobal.path, probe.homedir), `[core]\n\tsshCommand = ssh -F '${ssh.configPath}'`, facts);
      }
      if (!commandOk) return fail("missing", "git isn't using the SSH config yet (core.sshCommand).", facts);
      return pass("git uses the key and pinned host keys.", facts);
    }
    case "ssh-uploaded": {
      if (!ssh.keyExists) return fail("missing", "Create the key first.", facts);
      const result = await context.gateway.call(
        "sshTest",
        machine.id,
        { configPath: ssh.configPath, keyPath: ssh.keyPath, knownHostsPath: ssh.knownHostsPath, host, userConfig: context.interactive },
        { signal: context.signal },
      );
      if (result.category === "ok") return pass(`GitHub knows this key as ${atLogin(result.login)}.`, { ...facts, login: result.login }, result.output);
      if (result.category === "network") return error("network", CATEGORY_TEXT.network!, result.output);
      if (result.category === "host-key") return fail("host-key", "Pin GitHub's host keys first.", facts, result.output);
      const gh = await context.ghStatus(machine.id, host).catch(() => null);
      const auth = gh === null || !gh.installed ? null : classifyGhAuthStatus(gh.stdout, host, []);
      const canUpload =
        auth !== null && auth.state === "logged-in" && hasScope(auth.scopes, "write:public_key") && hasScope(auth.scopes, "read:public_key");
      return fail("not-uploaded", `GitHub doesn't know this key yet.${withoutSshConfig(context, probe)}`, { ...facts, canUpload }, result.output);
    }
    case "ssh-signing": {
      if (!ssh.keyExists) return fail("missing", "Create the key first.", facts);
      if ((probe.signing.format !== "ssh" || probe.signing.signingKey === null) && !probe.gitGlobal.writable) {
        return readOnly(
          shortPath(probe.gitGlobal.path, probe.homedir),
          `[gpg]\n\tformat = ssh\n[user]\n\tsigningkey = ${ssh.keyPath}.pub\n[commit]\n\tgpgsign = true`,
          facts,
        );
      }
      if (probe.signing.format !== "ssh" || probe.signing.signingKey === null) {
        return fail("not-configured", "git doesn't sign commits with SSH yet.", facts);
      }
      const test = await context.gateway.call("signingTest", machine.id, { keyPath: ssh.keyPath }, { signal: context.signal });
      if (test.skipped) return { outcome: "pass", category: "own-key", detail: "Commits are signed with a key of your own; the plugin doesn't test it, since your signing program could prompt.", facts, raw: test.output };
      return test.ok ? pass("A signed test commit verifies.", facts, test.output) : fail("failed", "A signed test commit didn't verify.", facts, test.output);
    }
    default:
      return error("error", "Unknown SSH check.");
  }
}

/**
 * A file bb would write is read-only (home-manager links it from the Nix
 * store, say): say so, and give the text to add where it is managed.
 */
function readOnly(file: string, addThere: string, facts: Facts): CheckOutput {
  return fail("read-only", `Managed outside bb: ${file} is read-only. Add the lines below where you manage it.`, { ...facts, readOnlyFile: file, addThere });
}

/**
 * Background ssh reads none of ~/.ssh/config, so a failure there may pass on a
 * click, which reads it.
 */
function withoutSshConfig(context: RunContext, probe: Probe): string {
  return !context.interactive && probe.userSshConfig ? " Checked without your ssh config; Recheck to use it." : "";
}

function shortPath(path: string, home: string): string {
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}
