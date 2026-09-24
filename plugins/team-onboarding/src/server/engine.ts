// The onboarding engine: owns the manifest, the item list, results, fixes,
// device logins, setup terminals and live updates.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { pruneApprovals } from "../core/approval.js";
import { fixesFor, type FixContext } from "../core/fixes.js";
import { GITHUB_KNOWN_HOSTS } from "../core/github-keys.js";
import { allCommands, deriveItems } from "../core/items.js";
import { parseManifest, formatIssue, type Manifest } from "../core/manifest.js";
import type { Facts } from "../core/model.js";
import type { Fix, FixKind, ItemDef, ItemResult } from "../core/model.js";
import { CATEGORY_TEXT, LOGIN_NOTE_TEXT, redactSecrets, type LoginNote } from "../core/redact.js";
import {
  badgeFor,
  buildItemViews,
  doneSummary,
  homeLine,
  isLongOffline,
  nextStep,
  progress,
  resolveScope,
  resultKey,
  statusFromOutcome,
  type ItemView,
  type Machine,
} from "../core/status.js";
import { CHANGED_CHANNEL, DEVICE_CHANNEL, type DeviceLoginState, type OnboardingState, type OnboardingSummary } from "../contract/rpc.js";
import { RunContext, runCheck, type CheckOutput, type ManifestState } from "./checks.js";
import { HostGateway, pluginDataDir } from "./gateway.js";
import { createGit, defaultGitDeps } from "./git.js";
import { defaultManifestPath, readManifestFile, resolveManifestPath, watchManifestFile, writeManifestFile } from "./manifest-file.js";
import { SkillsSync } from "./skills-sync.js";
import { assertPublicUrl, InternalHostError } from "./netguard.js";
import { Store, type TrackedTerminal } from "./store.js";
import { asEngineer, inBackground } from "./interaction.js";
import { bbRefusal } from "./bb-errors.js";
import { since, snapshot, timed } from "./meter.js";

export interface Settings {
  /** An absolute path to the manifest; empty means the default place. */
  manifestFile: string;
  checkIntervalMinutes: number;
}

/** What the Settings panel and the page show about the manifest file. */
export interface ManifestFileInfo {
  path: string;
  exists: boolean;
  sha: string | null;
  mtime: string | null;
  /** Validation errors with their line, or why the file can't be read. */
  issues: string[];
}

/** Environment variable names the env form refuses: they would override bb's built-in git. */
export const REFUSED_ENV = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GIT_CONFIG_.*)$/;

const WATCH_INTERVAL_MS = 5_000;
const WATCH_LIMIT_MS = 15 * 60_000;
const DEVICE_TIMEOUT_MS = 20 * 60_000;
const CODE_LIFETIME_MS = 15 * 60_000;
const DEVICE_MARKER = "device-login";

export class FixError extends Error {}

export interface RunOptions {
  itemId?: string;
  hostId?: string;
  reloadManifest?: boolean;
  signal?: AbortSignal;
  /** The engineer asked (the page's Recheck): git may ask its credential helpers. */
  interactive?: boolean;
  /** The schedule asked: checks may reuse results whose inputs didn't change. */
  scheduled?: boolean;
}

export class Engine {
  readonly store: Store;
  readonly gateway: HostGateway;
  readonly skills: SkillsSync;
  private readonly git = createGit(defaultGitDeps(() => pluginDataDir(this.bb)));
  private manifestState: ManifestState = { status: "none", manifest: null, error: null };
  private manifestVersion: string | null = null;
  private manifestLoadedAt: string | null = null;
  /** The file the loaded manifest came from. */
  private manifestPath: string | null = null;
  private manifestFile: ManifestFileInfo | null = null;
  private manifestWatch: { stop: () => void; active: () => boolean } | null = null;
  /** A reload the watcher asked for while one was running. */
  private manifestReloading: Promise<void> | null = null;
  private manifestReloadAgain = false;
  /** The file as the last load saw it, valid or not, so an unchanged broken file reruns nothing. */
  private manifestSeen: { sha: string | null; exists: boolean; problem: string | null } | null = null;
  private items: ItemDef[] = [];
  private machines: Machine[] = [];
  private serverHostId: string | null = null;
  /** Raw output and SSO links of the last run, in memory only. */
  private readonly raw = new Map<string, { text: string; links: { label: string; url: string }[] }>();
  private readonly watches = new Map<string, NodeJS.Timeout>();
  private device: (DeviceLoginState & { abort: AbortController }) | null = null;
  private running = 0;
  private ticking = false;
  /** Work still in progress, so a dispose can wait for it before the plugin goes away. */
  private readonly inflight = new Set<Promise<unknown>>();
  /** Aborted on dispose: checks under way stop their host calls and git. */
  private readonly lifecycle = new AbortController();
  private terminalTimer: NodeJS.Timeout | null = null;
  private publishTimer: NodeJS.Timeout | null = null;
  private pendingChanged = new Set<string>();
  private disposed = false;
  private readonly hostEntryStatus = new Map<string, boolean>();

  constructor(
    private readonly bb: BbPluginApi,
    private readonly settings: () => Promise<Settings>,
  ) {
    this.store = new Store(bb);
    this.gateway = new HostGateway(bb, () => this.serverHostId, (hostId, payload) => this.onDeviceCode(hostId, payload));
    this.skills = new SkillsSync({
      dataDir: () => bb.server.experimental_dataDir,
      store: this.store,
      git: this.git,
      githubHost: () => this.manifestState.manifest?.github.host ?? "github.com",
      registryInstall: async (registrySkillId) => {
        await bb.sdk.skills.registry.install({ registrySkillId });
      },
      registryRemove: async (folder) => {
        await bb.sdk.skills.remove({ scope: "user", skillId: folder } as never);
      },
      log: (message) => bb.log.info(message),
    });
    bb.onDispose(() => this.dispose());
  }

  // --- lifecycle --------------------------------------------------------------

  /** Loads the cached manifest so the list is right before the first run. */
  async init(): Promise<void> {
    // A device login that was running when the plugin reloaded: its host call
    // is gone, so the card offers a new code.
    const interrupted = await this.bb.storage.kv.get<Pick<DeviceLoginState, "loginId" | "hostId" | "itemId" | "flow">>(DEVICE_MARKER);
    if (interrupted !== null && interrupted !== undefined) {
      await this.bb.storage.kv.delete(DEVICE_MARKER);
      this.device = {
        ...interrupted,
        state: "failed",
        code: null,
        url: null,
        expiresAt: null,
        message: "The login stopped because the plugin reloaded. Get a new code to try again.",
        abort: new AbortController(),
      };
    }
    const cached = await this.store.manifest();
    if (cached !== null) {
      const parsed = parseManifest(cached.text);
      if (parsed.ok) {
        this.manifestState = { status: "ok", manifest: parsed.manifest, error: null };
        this.manifestVersion = cached.version;
        this.manifestLoadedAt = cached.loadedAt ?? null;
        this.manifestPath = cached.path ?? null;
      }
    }
    await this.watchManifest();
    // Terminals that were running when the plugin stopped still get their recheck.
    if ((await this.store.terminals()).some((terminal) => terminal.rechecked !== true)) this.pollTerminals();
  }

  /** Where the plugin looks for the manifest on the server. */
  async manifestLocation(): Promise<string> {
    return resolveManifestPath((await this.settings()).manifestFile, this.bb.server.experimental_dataDir);
  }

  /** Reloads the manifest soon after its file changes (the schedule reads it too). */
  async watchManifest(): Promise<void> {
    this.manifestWatch?.stop();
    const path = await this.manifestLocation();
    // The default folder is the plugin's own: make it, so the watch works
    // before the first install. A custom path's folder is the admin's.
    const fallback = defaultManifestPath(this.bb.server.experimental_dataDir);
    if (path === fallback) await mkdir(dirname(fallback), { recursive: true, mode: 0o755 }).catch(() => {});
    this.manifestWatch = watchManifestFile(path, () => {
      if (!this.disposed) void this.reloadIfManifestChanged().catch(() => {});
    });
  }

  /**
   * Runs the checks again only when the manifest file really changed (its
   * sha256, or whether it exists), one run at a time: a touch, or a burst of
   * events, doesn't rerun every check, team commands included.
   */
  async reloadIfManifestChanged(): Promise<void> {
    if (this.manifestReloading !== null) {
      this.manifestReloadAgain = true;
      return this.manifestReloading;
    }
    this.manifestReloading = (async () => {
      do {
        this.manifestReloadAgain = false;
        const file = await readManifestFile(await this.manifestLocation());
        const seen = this.manifestSeen;
        const changed = seen === null || file.sha !== seen.sha || file.exists !== seen.exists || file.problem !== seen.problem;
        if (changed && !this.disposed) await this.run({});
      } while (this.manifestReloadAgain && !this.disposed);
    })().finally(() => {
      this.manifestReloading = null;
    });
    return this.manifestReloading;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Stops timers, a running login and checks under way, then waits (up to 5 s) for them to end. */
  private async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.watches.values()) clearInterval(timer);
    this.watches.clear();
    if (this.terminalTimer !== null) clearInterval(this.terminalTimer);
    if (this.publishTimer !== null) clearTimeout(this.publishTimer);
    this.device?.abort.abort();
    this.manifestWatch?.stop();
    this.lifecycle.abort();
    const settled = Promise.allSettled([...this.inflight]);
    await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 5_000).unref?.())]);
  }

  // --- machines and items -----------------------------------------------------

  async refreshMachines(): Promise<Machine[]> {
    const [hosts, config, forgotten] = await Promise.all([
      this.bb.sdk.hosts.list(),
      this.bb.sdk.system.config(),
      this.store.forgotten(),
    ]);
    this.serverHostId = config.primaryHostId;
    const hidden = new Set(forgotten);
    this.machines = hosts
      .filter((host) => !hidden.has(host.id))
      .filter((host) => host.lifecycle.phase !== "destroyed" && host.lifecycle.phase !== "removing")
      .map((host) => ({
        id: host.id,
        name: host.name,
        isServer: host.id === config.primaryHostId,
        online: host.status === "connected",
        persistent: host.type === "persistent",
        lastSeenAt: host.lastSeenAt === null ? null : new Date(host.lastSeenAt).toISOString(),
      }))
      .sort((a, b) => Number(b.isServer) - Number(a.isServer) || a.name.localeCompare(b.name));
    return this.machines;
  }

  private async refreshItems(serverProviders?: ReturnType<RunContext["providerStates"]>): Promise<ItemDef[]> {
    const manifest = this.manifestState.manifest;
    let knownProviders: { id: string; displayName: string }[] = [];
    try {
      const serverId = this.serverHostId;
      const states = await (serverProviders ?? timed("items:providers", this.bb.sdk.system.providerStates(serverId === null ? {} : { hostId: serverId })));
      knownProviders = states.providers
        .filter((provider) => manifest !== null || provider.status !== "not_installed")
        .map((provider) => ({ id: provider.providerId, displayName: provider.displayName }));
    } catch {
      knownProviders = [];
    }
    const liveEntries = new Set((manifest?.skills ?? []).map((skill) => skill.id));
    await this.skills.forgetVanished(liveEntries);
    const orphanedSkills = manifest === null ? [] : await this.skills.orphanedFolders(liveEntries);
    // No manifest file isn't a problem; one that can't be used is.
    const manifestBroken = this.manifestState.status === "error";
    this.items = deriveItems(manifest, { knownProviders, orphanedSkills, manifestBroken });
    return this.items;
  }

  // --- manifest ----------------------------------------------------------------

  /**
   * Reads the manifest file and loads it when it changed (or always when
   * `force`). A missing file leaves the built-in core; an invalid one keeps
   * the last good manifest from the same file and shows why.
   */
  async loadManifest(force = false): Promise<void> {
    const path = await this.manifestLocation();
    const file = await readManifestFile(path);
    this.manifestSeen = { sha: file.sha, exists: file.exists, problem: file.problem };
    this.manifestFile = { path, exists: file.exists, sha: file.sha, mtime: file.mtime, issues: file.problem === null ? [] : [file.problem] };
    // Another file is another manifest: nothing of the old one counts.
    if (this.manifestPath !== null && this.manifestPath !== path) {
      this.manifestState = { status: "none", manifest: null, error: null };
      this.manifestVersion = null;
      this.manifestPath = null;
      await this.store.setManifest(null);
    }
    if (!file.exists) {
      this.manifestState = { status: "none", manifest: null, error: null };
      this.manifestVersion = null;
      this.manifestPath = null;
      await this.store.setManifest(null);
      return;
    }
    if (file.text === null) {
      this.manifestState = { status: "error", manifest: this.manifestState.manifest, error: file.problem };
      return;
    }
    if (!force && this.manifestState.status === "ok" && file.sha === this.manifestVersion) return;
    const parsed = parseManifest(file.text);
    if (!parsed.ok) {
      const issues = parsed.issues.map((issue) => redactSecrets(formatIssue(issue)));
      this.manifestFile.issues = issues.slice(0, 20);
      this.manifestState = { status: "error", manifest: this.manifestState.manifest, error: issues.slice(0, 3).join("; ") };
      this.bb.log.warn(`manifest invalid (${parsed.issues.length} issues)`);
      return;
    }
    this.manifestState = { status: "ok", manifest: parsed.manifest, error: null };
    this.manifestVersion = file.sha;
    this.manifestLoadedAt = new Date().toISOString();
    this.manifestPath = path;
    await this.store.setManifest({ path, text: file.text, version: file.sha!, loadedAt: this.manifestLoadedAt });
    // Approvals of commands no longer in the manifest lapse; a changed command
    // has a new hash, so it needs approval again.
    const items = deriveItems(parsed.manifest, { knownProviders: [] });
    this.store.replaceApprovals(pruneApprovals(this.store.approvals(), allCommands(items).map(({ command }) => command)));
    this.bb.log.info(`manifest loaded (${file.sha!.slice(0, 12)})`);
  }

  /** The manifest file as the Settings panel shows it, read now. */
  async manifestFileInfo(): Promise<ManifestFileInfo> {
    await this.loadManifest();
    const path = await this.manifestLocation();
    return this.manifestFile ?? { path, exists: false, sha: null, mtime: null, issues: [] };
  }

  /**
   * Validates a manifest and writes it to the configured place atomically.
   * An invalid one is refused and the file on disk stays as it was.
   */
  async installManifest(text: string): Promise<{ path: string; sha: string; teamName: string; itemCount: number }> {
    const parsed = parseManifest(text);
    if (!parsed.ok) {
      throw new FixError(`The manifest has problems; nothing was written.\n${parsed.issues.map((issue) => redactSecrets(formatIssue(issue))).join("\n")}`);
    }
    const path = await this.manifestLocation();
    await writeManifestFile(path, text);
    await this.run({}).catch(() => {});
    const written = await readManifestFile(path);
    return {
      path,
      sha: written.sha ?? "",
      teamName: parsed.manifest.team.name,
      itemCount: deriveItems(parsed.manifest, { knownProviders: [] }).length,
    };
  }

  // --- checks ----------------------------------------------------------------

  /** Runs checks. With no arguments, everything (and the manifest first). */
  async run(options: RunOptions = {}): Promise<void> {
    if (this.disposed) return;
    return this.track(options.interactive === true ? asEngineer(() => this.runChecks(options)) : this.runChecks(options));
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    void work.then(
      () => this.inflight.delete(work),
      () => this.inflight.delete(work),
    );
    return work;
  }

  private async runChecks(options: RunOptions): Promise<void> {
    this.running += 1;
    this.publish(["*"]);
    const started = performance.now();
    const before = snapshot();
    const wall = new Map<string, number>();
    try {
      if (options.reloadManifest !== false && options.itemId === undefined) await this.loadManifest();
      await this.refreshMachines();
      const signal = options.signal === undefined ? this.lifecycle.signal : AbortSignal.any([options.signal, this.lifecycle.signal]);
      const context = new RunContext(this.bb, this.gateway, signal, options.interactive === true, options.scheduled === true);
      // The server's agents come from the same answer its provider checks use.
      await this.refreshItems(this.serverHostId === null ? undefined : context.providerStates(this.serverHostId));
      const approved = this.store.approvedHashes();
      const targets = this.items.filter((item) => options.itemId === undefined || item.id === options.itemId);
      const now = Date.now();
      const jobs: Promise<void>[] = [];
      for (const item of targets) {
        for (const machine of resolveScope(item.scope, this.machines)) {
          if (options.hostId !== undefined && machine.id !== options.hostId) continue;
          if (!machine.online || isLongOffline(machine, now)) continue;
          jobs.push(
            this.checkOne(item, machine, context, approved).finally(() => {
              wall.set(machine.name, Math.max(wall.get(machine.name) ?? 0, Math.round(performance.now() - started)));
            }),
          );
        }
      }
      await Promise.all(jobs);
      if (options.itemId === undefined) {
        const live = new Set(this.items.flatMap((item) => this.machines.map((machine) => resultKey(item.id, machine.id))));
        this.store.pruneResults(live);
      }
      const meta = await this.store.meta();
      await this.store.setMeta({
        lastRunAt: options.itemId === undefined && options.hostId === undefined ? new Date().toISOString() : meta.lastRunAt,
        lastCheckAt: new Date().toISOString(),
      });
    } finally {
      this.running -= 1;
      this.publish(["*"]);
      this.logRun(options, started, before, wall);
    }
  }

  /**
   * One log line per run of every item: what it asked each machine and bb,
   * and how long it took. Runs of one item (a watched row polls every few
   * seconds) aren't logged.
   */
  private logRun(options: RunOptions, started: number, before: ReturnType<typeof snapshot>, wall: Map<string, number>): void {
    if (options.itemId !== undefined || this.disposed) return;
    const cost = since(before);
    const name = (hostId: string) => this.machines.find((machine) => machine.id === hostId)?.name ?? hostId;
    const hosts = Object.fromEntries(Object.entries(cost.hosts).map(([hostId, value]) => [name(hostId), { ...value, wallMs: wall.get(name(hostId)) ?? null }]));
    const scope = options.hostId === undefined ? "all" : name(options.hostId);
    const trigger = options.interactive === true ? " (engineer)" : options.scheduled === true ? " (schedule)" : "";
    try {
      this.bb.log.info(`run ${scope}${trigger}: ${Math.round(performance.now() - started)} ms ${JSON.stringify({ hosts, counts: cost.counts })}`);
    } catch {
      // The plugin is going away.
    }
  }

  private async checkOne(item: ItemDef, machine: Machine, context: RunContext, approved: ReadonlySet<string>): Promise<void> {
    const output: CheckOutput = await runCheck(item, machine, {
      context,
      manifest: this.manifestState,
      skills: this.skills,
      approved,
      machines: this.machines,
    });
    // The core core runs without a manifest: an agent not installed on a
    // machine is simply not in scope there.
    const skipped = this.manifestState.manifest === null && item.check.kind === "provider" && output.category === "not_installed";
    this.hostEntryStatus.set(machine.id, this.gateway.hasEntry(machine.id));
    const key = resultKey(item.id, machine.id);
    const previous = this.store.allResults().get(key);
    const result: ItemResult = {
      itemId: item.id,
      hostId: machine.id,
      // A manifest file that can't be used is broken from the start: it is there and wrong.
      status: skipped
        ? "skipped"
        : item.id === "core.manifest" && output.outcome === "fail"
          ? "broken"
          : statusFromOutcome(output.outcome, this.store.everPassed(key)),
      category: output.category,
      checkedAt: new Date().toISOString(),
      // Results hold categories and fixed sentences; anything that came from
      // a program is masked before it is stored or shown.
      detail: redactSecrets(output.detail),
      facts: redactFacts(output.facts),
    };
    this.store.putResult(key, result);
    this.remember(key, { text: output.raw ?? "", links: output.links ?? [] });
    if (previous === undefined || previous.status !== result.status || previous.detail !== result.detail) {
      this.publish([item.id]);
    }
    if (result.status === "ok") this.stopWatch(item.id, machine.id);
  }

  // --- views -------------------------------------------------------------------

  private views(): ItemView[] {
    return buildItemViews(this.items, this.machines, this.store.allResults(), Date.now());
  }

  private fixContext(machine: Machine, approved: ReadonlySet<string>, platform: string | null): FixContext {
    return { approved, platform, hostEntry: this.gateway.hasEntry(machine.id), isServer: machine.isServer };
  }

  private fixesForView(view: ItemView, approved: ReadonlySet<string>): { hostId: string; fixes: Fix[] }[] {
    return view.results
      .filter((result) => result.status !== "skipped")
      .map((result) => {
        const machine = this.machines.find((candidate) => candidate.id === result.hostId)!;
        const platform = typeof result.facts.platform === "string" ? result.facts.platform : null;
        return { hostId: result.hostId, fixes: fixesFor(view.item, result, this.fixContext(machine, approved, platform)) };
      })
      .filter((entry) => entry.fixes.length > 0);
  }

  async state(): Promise<OnboardingState> {
    if (this.machines.length === 0) await this.refreshMachines().catch(() => []);
    if (this.items.length === 0) await this.refreshItems();
    const approved = this.store.approvedHashes();
    const views = this.views();
    const meta = await this.store.meta();
    const now = Date.now();
    const next = nextStep(views);
    const manifest = this.manifestState.manifest;
    const serverLogin = this.store.allResults().get(resultKey("github.login", this.serverHostId ?? ""))?.facts.login;
    const safeFixes = views.flatMap((view) =>
      this.fixesForView(view, approved).flatMap(({ hostId, fixes }) =>
        fixes
          .filter((fix) => fix.safe)
          .map((fix) => ({
            itemId: view.item.id,
            hostId,
            kind: fix.kind,
            label: fix.label,
            title: view.item.title,
            machine: this.machines.find((machine) => machine.id === hostId)?.name ?? hostId,
          })),
      ),
    );
    return {
      manifest: {
        status: this.manifestState.status,
        teamName: manifest?.team.name ?? null,
        version: this.manifestVersion,
        loadedAt: this.manifestLoadedAt,
        error: this.manifestState.error,
        path: await this.manifestLocation(),
        githubMode: manifest?.github.mode ?? "builtin",
        docsUrl: manifest?.team.docsUrl ?? null,
      },
      machines: this.machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        isServer: machine.isServer,
        online: machine.online,
        lastSeenAt: machine.lastSeenAt,
        hostEntry: this.gateway.hasEntry(machine.id),
        longOffline: isLongOffline(machine, now),
      })),
      items: views.map((view) => ({
        id: view.item.id,
        group: view.item.group,
        title: view.item.title,
        why: view.item.why,
        required: view.item.required,
        estimate: view.item.estimate,
        status: view.status,
        results: view.results,
        fixes: this.fixesForView(view, approved),
        commands: view.item.commands.map((command) => ({
          role: command.role,
          text: command.text,
          ref: command.ref,
          hash: command.hash,
          approved: approved.has(command.hash),
        })),
      })),
      badge: badgeFor(views),
      progress: progress(views),
      nextStep:
        next === null
          ? null
          : {
              itemId: next.item.id,
              hostId: next.results.find((result) => result.status === "todo" || result.status === "broken")?.hostId ?? null,
            },
      homeLine: homeLine(views, meta.lastCheckAt, now),
      doneSummary: doneSummary(views, this.machines),
      lastCheckAt: meta.lastCheckAt,
      running: this.running > 0,
      account: { login: typeof serverLogin === "string" ? serverLogin : null },
      deviceLogin: this.deviceState(),
      safeFixes,
      terminals: await this.terminalStates(),
      watching: [...this.watches.keys()],
    };
  }

  async summary(): Promise<OnboardingSummary> {
    if (this.items.length === 0) {
      await this.refreshMachines().catch(() => []);
      await this.refreshItems();
    }
    const views = this.views();
    const badge = badgeFor(views);
    const meta = await this.store.meta();
    return {
      badge,
      homeLine: homeLine(views, meta.lastCheckAt, Date.now()),
      hasBlocking: badge.kind === "count",
      hasUpdates: badge.kind === "dot",
      lastCheckAt: meta.lastCheckAt,
    };
  }

  /** Keeps a check's raw output for "Show details", with secrets masked. */
  private remember(key: string, entry: { text: string; links: { label: string; url: string }[] }): void {
    this.raw.set(key, { text: redactSecrets(entry.text), links: entry.links });
  }

  details(itemId: string, hostId: string) {
    const own = this.raw.get(resultKey(itemId, hostId));
    // The manifest item's own check has no output; its load error does.
    const entry = itemId === "core.manifest" && (own === undefined || own.text === "") ? (this.raw.get("manifest") ?? own) : own;
    return { text: entry?.text === undefined || entry.text === "" ? null : redactSecrets(entry.text), links: entry?.links ?? [] };
  }

  manifestView() {
    const manifest = this.manifestState.manifest;
    const approved = this.store.approvedHashes();
    const sections = manifest === null ? [] : manifestSections(manifest);
    return {
      sections,
      commands: allCommands(this.items).map(({ item, command }) => ({
        role: command.role,
        text: command.text,
        ref: command.ref,
        hash: command.hash,
        approved: approved.has(command.hash),
        itemId: item.id,
        itemTitle: item.title,
      })),
      version: this.manifestVersion,
    };
  }

  async cachedManifestText(): Promise<string | null> {
    return (await this.store.manifest())?.text ?? null;
  }

  // --- approvals (UI only) --------------------------------------------------------

  approve(hash: string): boolean {
    const found = allCommands(this.items).find(({ command }) => command.hash === hash);
    if (found === undefined) return false;
    this.store.approve({
      hash,
      itemId: found.item.id,
      role: found.command.role,
      // The command text stays in the cached manifest only: a plugin source
      // or command may carry a URL, which plugin storage never holds.
      text: "",
      approvedAt: new Date().toISOString(),
    });
    this.bb.log.info(`approved ${found.item.id} (${found.command.role})`);
    void this.run({ itemId: found.item.id }).catch(() => {});
    return true;
  }

  async revoke(hash: string): Promise<void> {
    const found = allCommands(this.items).find(({ command }) => command.hash === hash);
    this.store.revoke(hash);
    this.bb.log.info("approval revoked");
    // Recheck so the item shows "needs approval" again right away.
    if (found !== undefined) await this.run({ itemId: found.item.id }).catch(() => {});
    this.publish(["*"]);
  }

  // --- fixes --------------------------------------------------------------------------

  /** Finds the fix of `kind` offered for an item on a machine, as the UI would see it. */
  private offeredFix(itemId: string, hostId: string, kind: FixKind): { item: ItemDef; machine: Machine; fix: Fix; result: ItemResult } {
    const view = this.views().find((candidate) => candidate.item.id === itemId);
    if (view === undefined) throw new FixError("No such item.");
    const machine = this.machines.find((candidate) => candidate.id === hostId);
    if (machine === undefined) throw new FixError("No such machine.");
    if (!machine.online) throw new FixError(`${machine.name} is offline.`);
    const result = view.results.find((candidate) => candidate.hostId === hostId);
    if (result === undefined) throw new FixError("Not checked on that machine.");
    const offered = this.fixesForView(view, this.store.approvedHashes()).find((entry) => entry.hostId === hostId)?.fixes ?? [];
    const fix = offered.find((candidate) => candidate.kind === kind);
    if (fix === undefined) throw new FixError("That fix isn't offered for this item right now. Recheck and try again.");
    return { item: view.item, machine, fix, result };
  }

  /** Whether a fix kind is safe for this item on this machine right now. */
  isSafeNow(itemId: string, hostId: string, kind: FixKind): boolean {
    try {
      return this.offeredFix(itemId, hostId, kind).fix.safe;
    } catch {
      return false;
    }
  }

  async runFix(input: {
    itemId: string;
    hostId: string;
    kind: FixKind;
    confirmed?: boolean;
    cols?: number;
    rows?: number;
    safeOnly?: boolean;
  }): Promise<{ ok: boolean; message: string | null; terminal: { terminalId: string; hostId: string } | null; loginId: string | null }> {
    const { item, machine, fix, result } = this.offeredFix(input.itemId, input.hostId, input.kind);
    if (input.safeOnly === true && !fix.safe) throw new FixError("Only safe fixes can run here.");
    if (fix.confirm !== null && input.confirmed !== true) throw new FixError(`Needs confirmation: ${fix.confirm}`);
    if (fix.approvalHash !== null && !this.store.approvedHashes().has(fix.approvalHash)) {
      throw new FixError("Approve the command in the Onboarding page first.");
    }
    this.bb.log.info(`fix ${fix.kind} for ${item.id} on ${machine.id}`);
    const done = (message: string | null) => ({ ok: true, message, terminal: null, loginId: null });
    // A target managed elsewhere (a read-only file home-manager links from the
    // Nix store, say) isn't fought with; the item shows what to add there.
    const managedOutside = (file: string) => ({
      ok: false,
      message: `Managed outside bb: ${file} is read-only. The item shows what to add there.`,
      terminal: null,
      loginId: null,
    });
    const manifest = this.manifestState.manifest;
    const host = manifest?.github.host ?? "github.com";
    // Fixes that reach the GitHub host check it resolves to a public address.
    const usesHost = ["device-login", "device-refresh", "gh-setup-git", "gh-ssh-key-add", "ssh-signing-setup", "write-ssh-config"];
    if (usesHost.includes(fix.kind)) {
      await assertPublicUrl(`https://${host}/`).catch((error) => {
        if (error instanceof InternalHostError) throw new FixError(error.message);
        throw error;
      });
    }
    const probe = () => this.gateway.probe(machine.id);
    const recheck = async (ids: string[] = [item.id]) => {
      // Only a fix from the page (not the CLI or RPC, which run
      // safe fixes only) lets git ask credential helpers on the recheck.
      for (const id of ids) await this.run({ itemId: id, hostId: machine.id, interactive: input.safeOnly !== true });
    };
    switch (fix.kind) {
      case "device-login":
      case "device-refresh": {
        const scopes =
          fix.kind === "device-refresh"
            ? (Array.isArray(result.facts.missingScopes) ? result.facts.missingScopes : [])
            : (manifest?.github.scopes ?? []);
        const loginId = this.startDeviceLogin(machine, item.id, fix.kind === "device-login" ? "login" : "refresh", scopes);
        return { ok: true, message: null, terminal: null, loginId };
      }
      case "gh-setup-git": {
        const out = await this.gateway.call("ghSetupGit", machine.id, { host });
        this.remember(resultKey(item.id, machine.id), { text: out.output, links: [] });
        await recheck();
        const message = out.skipped
          ? "git already uses gh for HTTPS; nothing to change."
          : out.credentialReady
            ? "git now uses gh for HTTPS."
            : "gh auth setup-git failed. Show details has gh's output.";
        return { ok: out.credentialReady, message, terminal: null, loginId: null };
      }
      case "ssh-keygen": {
        const p = await probe();
        const comment = `bb@${machine.name.replace(/[^\w.-]/g, "-")}`;
        const out = await this.gateway.call("sshKeygen", machine.id, { keyPath: p.ssh.keyPath, comment });
        await recheck(["ssh.key", "ssh.uploaded"]);
        if (out.readOnlyFile !== null) return managedOutside(out.readOnlyFile);
        return done(out.created ? "Created a key." : "A key already exists; left it alone.");
      }
      case "write-known-hosts": {
        const p = await probe();
        const out = await this.gateway.call("writeKnownHosts", machine.id, { path: p.ssh.knownHostsPath, lines: [...GITHUB_KNOWN_HOSTS] });
        await recheck(["ssh.known-hosts"]);
        if (out.readOnlyFile !== null) return managedOutside(out.readOnlyFile);
        return done("Pinned GitHub's host keys.");
      }
      case "write-ssh-config": {
        const p = await probe();
        const out = await this.gateway.call("writeSshConfig", machine.id, {
          configPath: p.ssh.configPath,
          keyPath: p.ssh.keyPath,
          knownHostsPath: p.ssh.knownHostsPath,
          host,
        });
        const set = out.readOnlyFile === null ? await this.gateway.call("gitConfig", machine.id, { op: "set", key: "core.sshCommand", value: out.sshCommand }) : null;
        await recheck(["ssh.config", "ssh.uploaded"]);
        const readOnlyFile = out.readOnlyFile ?? set?.readOnlyFile ?? null;
        if (readOnlyFile !== null) return managedOutside(readOnlyFile);
        return done("git now uses the plugin's SSH config.");
      }
      case "gh-ssh-key-add": {
        const p = await probe();
        const out = await this.gateway.call("ghSshKeyAdd", machine.id, {
          host,
          publicKeyPath: `${p.ssh.keyPath}.pub`,
          title: `bb ${machine.name}`.replace(/[^\w .@-]/g, "-").slice(0, 100),
          type: "authentication",
        });
        this.remember(resultKey(item.id, machine.id), { text: out.output, links: [] });
        await recheck(["ssh.uploaded"]);
        return { ok: out.ok, message: out.ok ? "Added the key to GitHub." : "gh couldn't add the key. Copy it and add it on GitHub instead.", terminal: null, loginId: null };
      }
      case "ssh-signing-setup": {
        const p = await probe();
        const format = await this.gateway.call("gitConfig", machine.id, { op: "set", key: "gpg.format", value: "ssh" });
        if (format.readOnlyFile !== null) {
          await recheck(["ssh.signing"]);
          return managedOutside(format.readOnlyFile);
        }
        await this.gateway.call("gitConfig", machine.id, { op: "set", key: "user.signingkey", value: `${p.ssh.keyPath}.pub` });
        await this.gateway.call("gitConfig", machine.id, { op: "set", key: "commit.gpgsign", value: "true" });
        const upload = await this.gateway.call("ghSshKeyAdd", machine.id, {
          host,
          publicKeyPath: `${p.ssh.keyPath}.pub`,
          title: `bb ${machine.name} signing`.replace(/[^\w .@-]/g, "-").slice(0, 100),
          type: "signing",
        });
        await recheck(["ssh.signing"]);
        return done(upload.ok ? "Commits are signed, and GitHub knows the signing key." : "Commits are signed. Add the key on GitHub as a signing key to get Verified.");
      }
      case "skills-sync":
      case "skills-update":
      case "skills-restore":
      case "skills-remove":
      case "skills-replace-mine":
      case "skills-keep-mine":
      case "skills-rename-mine": {
        if (item.check.kind === "skills-orphaned") {
          for (const folder of item.check.folders) await this.skills.removeFolder(folder);
          await this.run({});
          return done(`Removed ${item.check.folders.length} ${item.check.folders.length === 1 ? "skill" : "skills"}.`);
        }
        const entry = manifest?.skills.find((skill) => `skill:${skill.id}` === item.id);
        if (entry === undefined || manifest === null) throw new FixError("Not in the manifest.");
        let message: string;
        if (fix.kind === "skills-keep-mine") message = await this.skills.keepMine(entry);
        else if (fix.kind === "skills-rename-mine") message = await this.skills.renameMine(entry, manifest);
        else {
          const action = ({
            "skills-sync": "install",
            "skills-update": "update",
            "skills-restore": "restore",
            "skills-remove": "remove",
            "skills-replace-mine": "replace-mine",
          } as const)[fix.kind];
          message = await this.skills.apply(entry, manifest, action);
        }
        if (fix.kind === "skills-update") message += " Running threads pick this up when their current work ends.";
        await recheck();
        return done(message);
      }
      case "plugin-install": {
        const source = item.commands.find((command) => command.role === "source")!.text;
        const pluginEntry = manifest?.plugins.find((plugin) => `plugin:${plugin.id}` === item.id);
        await this.installPlugin(source);
        if (pluginEntry?.settings !== undefined) await this.applyPluginSettings(pluginEntry.id, pluginEntry.settings);
        await recheck();
        return done("Installed.");
      }
      case "plugin-update": {
        const pluginId = item.id.replace(/^(plugin|skill):/, "");
        await this.bb.sdk.plugins.applyUpdate({ pluginId });
        await recheck();
        return done("Updated.");
      }
      case "plugin-settings": {
        const pluginEntry = manifest?.plugins.find((plugin) => `plugin:${plugin.id}` === item.id);
        if (pluginEntry?.settings !== undefined) await this.applyPluginSettings(pluginEntry.id, pluginEntry.settings);
        await recheck();
        return done("Applied your team's settings.");
      }
      case "marketplace-add": {
        const source = item.commands.find((command) => command.role === "source")!.text;
        await this.bb.sdk.plugins.marketplaces.add({ source });
        await recheck();
        return done("Added.");
      }
      case "provider-install":
      case "provider-update": {
        const provider = item.id.replace(/^agent:/, "");
        await this.bb.sdk.hosts.installProviderCli({
          hostId: machine.id,
          provider,
          actionKind: fix.kind === "provider-install" ? "install" : "update",
        } as never);
        await recheck();
        return done(fix.kind === "provider-install" ? "Installed." : "Updated.");
      }
      case "provider-login":
      case "open-terminal": {
        // bb's own commands run at once.
        const terminal = await this.createTerminal(machine.id, item.id, `${fix.label} · ${item.title}`, { mode: "command", command: fix.command! }, input);
        return { ok: true, message: null, terminal, loginId: null };
      }
      case "tool-install":
      case "team-fix-terminal": {
        // Commands from the manifest are typed, not entered: pressing Enter is
        // the engineer's own act.
        const terminal = await this.createTerminal(machine.id, item.id, `${fix.label} · ${item.title}`, { mode: "typed", command: fix.command! }, input);
        return { ok: true, message: null, terminal, loginId: null };
      }
      case "team-fix-run": {
        const out = await this.gateway.call("runCheck", machine.id, { command: fix.command!, timeoutMs: 300_000 }, { timeoutMs: 310_000 });
        this.remember(resultKey(item.id, machine.id), { text: out.output, links: [] });
        await recheck();
        return { ok: out.exitCode === 0, message: out.exitCode === 0 ? "The fix ran." : `The fix failed (exit ${out.exitCode}).`, terminal: null, loginId: null };
      }
      case "switch-per-machine":
      case "enable-builtin-git": {
        const config = await this.bb.sdk.system.config();
        const next = { ...config.generalSettings, machineGitCredentialsEnabled: fix.kind === "enable-builtin-git" };
        await this.bb.sdk.system.updateGeneralSettings(next as never);
        await this.run({});
        return done(fix.kind === "enable-builtin-git" ? "Built-in git is on." : "Switched to per-machine GitHub.");
      }
      case "check-in-terminal": {
        const command = checkCommand(item);
        if (command === null) throw new FixError("This check can't run in a terminal.");
        const terminal = await this.createTerminal(machine.id, item.id, `Check: ${item.title}`, { mode: "command", command }, input);
        return { ok: true, message: null, terminal, loginId: null };
      }
      default:
        throw new FixError("That fix runs in the page.");
    }
  }

  private async installPlugin(source: string): Promise<void> {
    const catalog = /^([a-z0-9-]+)@([a-z0-9-]+)$/.exec(source);
    if (catalog !== null) {
      await this.bb.sdk.plugins.catalog.install({ entryId: catalog[1]!, marketplace: catalog[2]! });
      return;
    }
    await this.bb.sdk.plugins.install({ source });
  }

  /** Applies non-secret settings. Secret settings are never set from a manifest. */
  private async applyPluginSettings(pluginId: string, values: Record<string, string | number | boolean>): Promise<void> {
    const current = (await this.bb.sdk.plugins.getSettings({ pluginId })) as unknown as {
      descriptors?: Record<string, { secret?: boolean }>;
      fields?: { key: string; secret?: boolean }[];
    };
    const secret = new Set<string>([
      ...Object.entries(current.descriptors ?? {}).filter(([, d]) => d.secret === true).map(([key]) => key),
      ...(current.fields ?? []).filter((field) => field.secret === true).map((field) => field.key),
    ]);
    const safe = Object.fromEntries(Object.entries(values).filter(([key]) => !secret.has(key)));
    if (Object.keys(safe).length > 0) await this.bb.sdk.plugins.updateSettings({ pluginId, values: safe });
  }

  async setEnv(name: string, value: string): Promise<void> {
    if (REFUSED_ENV.test(name)) {
      throw new FixError(`${name} would override bb's built-in git on every machine. Set up GitHub in the GitHub group instead.`);
    }
    const listed = this.manifestState.manifest?.env.some((env) => env.name === name) ?? false;
    if (!listed) throw new FixError("Only variables your team's manifest lists can be set here.");
    const note = this.manifestState.manifest?.env.find((env) => env.name === name)?.note;
    await this.bb.sdk.system.setMachineEnvironmentVariable({ name, value, ...(note === undefined ? {} : { note }) } as never);
    this.bb.log.info(`env set: ${name}`);
    await this.run({ itemId: `env:${name}` });
  }

  /** Runs every safe fix, optionally on one machine. */
  async fixAllSafe(options: { hostId?: string; dryRun: boolean }) {
    const state = await this.state();
    const planned = state.safeFixes.filter((fix) => options.hostId === undefined || fix.hostId === options.hostId);
    const results: { itemId: string; hostId: string; ok: boolean; message: string | null }[] = [];
    if (options.dryRun) return { planned, results };
    for (const fix of planned) {
      try {
        const out = await this.runFix({ itemId: fix.itemId, hostId: fix.hostId, kind: fix.kind, safeOnly: true });
        results.push({ itemId: fix.itemId, hostId: fix.hostId, ok: out.ok, message: out.message });
      } catch (error) {
        results.push({ itemId: fix.itemId, hostId: fix.hostId, ok: false, message: redactSecrets(error instanceof Error ? error.message : String(error)) });
      }
    }
    return { planned, results };
  }

  // --- device login ----------------------------------------------------------------

  private deviceState(): DeviceLoginState | null {
    if (this.device === null) return null;
    const { abort: _abort, ...state } = this.device;
    return state;
  }

  private startDeviceLogin(machine: Machine, itemId: string, flow: "login" | "refresh", scopes: string[]): string {
    this.device?.abort.abort();
    const loginId = randomUUID();
    const abort = new AbortController();
    this.device = {
      loginId,
      hostId: machine.id,
      itemId,
      flow,
      state: "starting",
      code: null,
      url: null,
      expiresAt: null,
      message: null,
      abort,
    };
    this.publish([itemId]);
    const host = this.manifestState.manifest?.github.host ?? "github.com";
    // The login outlives the click that started it: its rechecks are background work.
    void this.track(inBackground(() => (async () => {
      await this.bb.storage.kv.set(DEVICE_MARKER, { loginId, hostId: machine.id, itemId, flow }).catch(() => {});
      try {
        const out = await this.gateway.call(
          "startDeviceLogin",
          machine.id,
          { loginId, host, scopes, flow },
          { timeoutMs: DEVICE_TIMEOUT_MS, signal: abort.signal },
        );
        if (this.device?.loginId !== loginId) return;
        this.remember(resultKey(itemId, machine.id), { text: out.output, links: [] });
        if (!out.ok) {
          this.device.state = this.device.expiresAt !== null && Date.parse(this.device.expiresAt) < Date.now() ? "expired" : "failed";
          this.device.message = "The login didn't finish. Get a new code to try again.";
        } else {
          // Recheck first, so the message can compare the new login with
          // the account agents act as.
          if (!this.disposed) await this.run({ itemId: "github.login", hostId: machine.id }).catch(() => {});
          if (this.device?.loginId !== loginId) return;
          this.device.state = "done";
          this.device.message = this.loginMessage(machine, out);
        }
      } catch (error) {
        if (this.device?.loginId !== loginId) return;
        this.device.state = abort.signal.aborted ? "cancelled" : "failed";
        this.device.message = abort.signal.aborted ? "Cancelled." : "The login stopped (the plugin may have reloaded). Get a new code to try again.";
      } finally {
        this.stopWatch(itemId, machine.id);
        this.publish([itemId]);
        if (!this.disposed) {
          await this.bb.storage.kv.delete(DEVICE_MARKER).catch(() => {});
          await this.run({ itemId, hostId: machine.id }).catch(() => {});
          await this.run({ itemId: "github.builtin-git" }).catch(() => {});
        }
      }
    })()));
    return loginId;
  }

  /** What a finished device login says: the account, gh's note, and who agents act as. */
  private loginMessage(machine: Machine, out: { login: string | null; setupGit: boolean; note: LoginNote | null }): string {
    const parts = [out.login === null ? `Logged in on ${machine.name}.` : `Logged in on ${machine.name} as @${out.login}.`];
    if (out.note !== null) parts.push(LOGIN_NOTE_TEXT[out.note]);
    parts.push(out.setupGit ? "git uses it for HTTPS." : "git doesn't use it for HTTPS yet; the item shows how.");
    const agents = this.store.allResults().get(resultKey("github.login", machine.id))?.facts;
    if (agents?.tokenSource !== undefined && typeof agents.tokenSource === "string" && agents.tokenSource.endsWith("_TOKEN") && typeof agents.login === "string") {
      parts.push(
        agents.login === out.login
          ? `Agents use ${agents.tokenSource}, the same account, while it is set.`
          : `Agents still act as @${agents.login}: ${agents.tokenSource} takes precedence while it is set.`,
      );
    }
    return parts.join(" ");
  }

  private onDeviceCode(hostId: string, payload: { loginId: string; code: string; url: string }): void {
    if (this.device === null || this.device.loginId !== payload.loginId || this.device.hostId !== hostId) return;
    // The code travels apart from the login's result and can arrive after it.
    if (this.device.state !== "starting") return;
    this.device.state = "code";
    this.device.code = payload.code;
    this.device.url = payload.url;
    this.device.expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
    // The device code is the one thing realtime carries besides invalidations.
    this.bb.realtime.publish(DEVICE_CHANNEL, {
      loginId: payload.loginId,
      code: payload.code,
      url: payload.url,
      expiresAt: this.device.expiresAt,
    });
    this.watch(this.device.itemId, hostId);
    this.publish([this.device.itemId]);
  }

  cancelDeviceLogin(loginId: string): boolean {
    if (this.device?.loginId !== loginId) return false;
    this.device.abort.abort();
    return true;
  }

  // --- watching an item while a page or code is open ----------------------------------

  watch(itemId: string, hostId: string): void {
    const key = resultKey(itemId, hostId);
    if (this.watches.has(key)) return;
    const started = Date.now();
    // Polling started by a click is still background work.
    const timer = inBackground(() => setInterval(() => {
      if (this.disposed || Date.now() - started > WATCH_LIMIT_MS) {
        this.stopWatch(itemId, hostId);
        return;
      }
      void this.run({ itemId, hostId }).catch(() => {});
    }, WATCH_INTERVAL_MS));
    timer.unref?.();
    this.watches.set(key, timer);
    this.publish([itemId]);
  }

  private stopWatch(itemId: string, hostId: string): void {
    const key = resultKey(itemId, hostId);
    const timer = this.watches.get(key);
    if (timer === undefined) return;
    clearInterval(timer);
    this.watches.delete(key);
  }

  // --- setup terminals ----------------------------------------------------------------

  async createTerminal(
    hostId: string,
    itemId: string | null,
    title: string,
    start: { mode: "command"; command: string } | { mode: "typed"; command: string },
    size: { cols?: number; rows?: number } = {},
  ): Promise<{ terminalId: string; hostId: string }> {
    const session = await this.bb.sdk.terminals.create({
      cols: size.cols ?? 100,
      rows: size.rows ?? 30,
      scope: { kind: "host_path", hostId, cwd: null },
      title: title.slice(0, 80),
      start: start.mode === "command" ? { mode: "command", command: start.command } : { mode: "shell" },
    });
    if (start.mode === "typed") {
      // Typed but not entered.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await this.bb.sdk.terminals.input({ terminalId: session.id, dataBase64: Buffer.from(start.command, "utf8").toString("base64") });
    }
    const tracked = await this.store.terminals();
    tracked.push({ terminalId: session.id, hostId, itemId, title, command: start.command, createdAt: new Date().toISOString() });
    await this.store.setTerminals(tracked);
    this.pollTerminals();
    this.publish(["terminals"]);
    return { terminalId: session.id, hostId };
  }

  async closeTerminal(terminalId: string): Promise<void> {
    const tracked = await this.store.terminals();
    if (!tracked.some((terminal) => terminal.terminalId === terminalId)) throw new FixError("Not a setup terminal.");
    await this.bb.sdk.terminals.close({ terminalId, mode: "force" } as never).catch(() => {});
    await this.store.setTerminals(tracked.filter((terminal) => terminal.terminalId !== terminalId));
    this.publish(["terminals"]);
  }

  private async terminalStates() {
    const tracked = await this.store.terminals();
    const out = [];
    for (const terminal of tracked) {
      const session = await this.sessionStatus(terminal.terminalId);
      out.push({
        terminalId: terminal.terminalId,
        hostId: terminal.hostId,
        itemId: terminal.itemId,
        title: terminal.title,
        command: terminal.command ?? null,
        status: session.status,
        exitCode: session.exitCode,
      });
    }
    return out;
  }

  /** Rechecks an item when the terminal that serves it exits. */
  private pollTerminals(): void {
    if (this.terminalTimer !== null || this.disposed) return;
    let polling = false;
    this.terminalTimer = inBackground(() => setInterval(() => {
      // One poll at a time: a slow recheck must not start another.
      if (polling) return;
      polling = true;
      void this.pollTerminalsOnce()
        .then(async (waiting) => {
          // A terminal a fix opened while this poll ran isn't in its list:
          // read the list again before stopping.
          const unmarked = (await this.store.terminals()).some((terminal) => terminal.rechecked !== true);
          if (waiting === 0 && !unmarked && this.terminalTimer !== null) {
            clearInterval(this.terminalTimer);
            this.terminalTimer = null;
          }
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 3_000));
    this.terminalTimer.unref?.();
  }

  /** Rechecks the item of each terminal that ended; returns how many still run or are unknown. */
  private async pollTerminalsOnce(): Promise<number> {
    let waiting = 0;
    for (const terminal of await this.store.terminals()) {
      if (terminal.rechecked === true) continue;
      const status = await this.sessionStatus(terminal.terminalId);
      // Running, or bb didn't answer: ask again next time.
      if (status.status !== "exited" && status.status !== "gone") {
        waiting += 1;
        continue;
      }
      // Marked in storage before the recheck starts, so it runs once whatever
      // happens meanwhile (a quick command, a reload, a slow check).
      const latest = await this.store.terminals();
      await this.store.setTerminals(latest.map((entry) => (entry.terminalId === terminal.terminalId ? { ...entry, rechecked: true } : entry)));
      this.publish(["terminals"]);
      if (terminal.itemId === null) continue;
      if (terminal.title.startsWith("Check: ") && status.exitCode !== null) {
        this.recordTerminalCheck(terminal.itemId, terminal.hostId, status.exitCode);
      } else {
        await this.run({ itemId: terminal.itemId, hostId: terminal.hostId }).catch(() => {});
      }
    }
    return waiting;
  }

  /**
   * A terminal's status from bb. `gone` only when bb says it no longer
   * exists; any other failure is `unknown`, not an end.
   */
  private async sessionStatus(terminalId: string): Promise<{ status: string; exitCode: number | null }> {
    try {
      const session = await this.bb.sdk.terminals.get({ terminalId });
      return { status: session.status, exitCode: session.exitCode ?? null };
    } catch (error) {
      return { status: bbRefusal(error)?.status === 404 ? "gone" : "unknown", exitCode: null };
    }
  }

  /** "Check in terminal": the exit code is the result. */
  private recordTerminalCheck(itemId: string, hostId: string, exitCode: number): void {
    const key = resultKey(itemId, hostId);
    const outcome = exitCode === 0 ? "pass" : "fail";
    this.store.putResult(key, {
      itemId,
      hostId,
      status: statusFromOutcome(outcome, this.store.everPassed(key)),
      category: exitCode === 0 ? "ok" : "failed",
      checkedAt: new Date().toISOString(),
      detail: exitCode === 0 ? "Passed in the terminal." : `Failed in the terminal (exit ${exitCode}).`,
      facts: {},
    });
    this.publish([itemId]);
  }

  // --- forgetting machines ----------------------------------------------------------------

  async forgetMachine(hostId: string): Promise<void> {
    const machine = this.machines.find((candidate) => candidate.id === hostId);
    if (machine === undefined || !isLongOffline(machine, Date.now())) {
      throw new FixError("Only machines offline for over a week can be forgotten.");
    }
    await this.store.setForgotten([...(await this.store.forgotten()), hostId]);
    await this.refreshMachines();
    this.publish(["*"]);
  }

  // --- realtime ----------------------------------------------------------------------------

  /** Publishes invalidations, coalesced. Never details or raw output. */
  publish(changed: string[]): void {
    for (const id of changed) this.pendingChanged.add(id);
    if (this.publishTimer !== null || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      const ids = [...this.pendingChanged];
      this.pendingChanged.clear();
      try {
        this.bb.realtime.publish(CHANGED_CHANNEL, { changed: ids });
      } catch {
        // Disposed.
      }
    }, 150);
    this.publishTimer.unref?.();
  }

  /**
   * Scheduled tick: runs every check when the check interval has passed,
   * and otherwise only looks at the manifest file. One tick at a time: a
   * tick that fires while the last one still runs does nothing.
   */
  async tick(): Promise<void> {
    if (this.ticking) {
      this.bb.log.info("tick skipped: the last one is still running");
      return;
    }
    this.ticking = true;
    try {
      await this.tickOnce();
    } finally {
      this.ticking = false;
    }
  }

  private async tickOnce(): Promise<void> {
    const { checkIntervalMinutes } = await this.settings();
    const meta = await this.store.meta();
    const due = meta.lastRunAt === null || Date.now() - Date.parse(meta.lastRunAt) >= checkIntervalMinutes * 60_000;
    if (due) {
      await this.run({ scheduled: true });
      return;
    }
    // Between due runs, a changed manifest file still counts every tick, in
    // case the watcher couldn't be set up (a folder that didn't exist yet).
    if (this.manifestWatch?.active() !== true) await this.watchManifest().catch(() => {});
    await this.reloadIfManifestChanged();
  }

  get currentManifest(): Manifest | null {
    return this.manifestState.manifest;
  }

  get currentItems(): readonly ItemDef[] {
    return this.items;
  }

  get currentMachines(): readonly Machine[] {
    return this.machines;
  }

  categoryText(category: string): string {
    return CATEGORY_TEXT[category] ?? category;
  }
}

function redactFacts(facts: Facts): Facts {
  return Object.fromEntries(
    Object.entries(facts).map(([key, value]) => [
      key,
      typeof value === "string" && key !== "publicKey" ? redactSecrets(value) : Array.isArray(value) ? value.map((entry) => redactSecrets(entry)) : value,
    ]),
  );
}

/** The command "Check in terminal" runs for items that have one. */
function checkCommand(item: ItemDef): string | null {
  const spec = item.check;
  if (spec.kind === "team-check") return spec.command;
  if (spec.kind === "tool") return `${spec.bin} ${spec.args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")}`;
  return null;
}

function manifestSections(manifest: Manifest) {
  const sections: { title: string; entries: { id: string; title: string; detail: string }[] }[] = [];
  sections.push({
    title: "GitHub",
    entries: [
      { id: "mode", title: "Mode", detail: manifest.github.mode === "builtin" ? "builtin: the server's login serves every machine" : "per-machine: every machine logs in itself" },
      ...(manifest.github.scopes.length > 0 ? [{ id: "scopes", title: "Scopes", detail: manifest.github.scopes.join(", ") }] : []),
      ...manifest.github.access.map((access) => ({ id: access.id, title: access.title ?? access.id, detail: access.repo })),
    ],
  });
  if (manifest.providers.length > 0) {
    sections.push({ title: "Agents", entries: manifest.providers.map((p) => ({ id: p.id, title: p.id, detail: p.required === false ? "optional" : "required" })) });
  }
  if (manifest.skills.length > 0) {
    sections.push({
      title: "Skills",
      entries: manifest.skills.map((skill) => ({
        id: skill.id,
        title: skill.title ?? skill.id,
        detail:
          skill.source === "git"
            ? `git · ${skill.ref} · ${skill.paths.join(", ")}`
            : skill.source === "apm"
              ? `apm · ${skill.package ?? skill.path}`
              : skill.source === "registry"
                ? `skills.sh · ${skill.registrySkillId}`
                : `plugin · ${skill.install}`,
      })),
    });
  }
  if (manifest.plugins.length + manifest.marketplaces.length > 0) {
    sections.push({
      title: "Plugins",
      entries: [
        ...manifest.marketplaces.map((m) => ({ id: m.id, title: `Marketplace ${m.id}`, detail: m.source })),
        ...manifest.plugins.map((p) => ({ id: p.id, title: p.title ?? p.id, detail: p.install })),
      ],
    });
  }
  if (manifest.tools.length > 0) {
    sections.push({
      title: "Tools",
      entries: manifest.tools.map((tool) => ({ id: tool.id, title: tool.title ?? tool.check.bin, detail: tool.min === undefined ? tool.check.bin : `${tool.check.bin} ≥ ${tool.min}` })),
    });
  }
  if (manifest.env.length > 0) {
    sections.push({ title: "Environment", entries: manifest.env.map((env) => ({ id: env.name, title: env.name, detail: env.note ?? "" })) });
  }
  if (manifest.checks.length > 0) {
    sections.push({ title: "Team checks", entries: manifest.checks.map((c) => ({ id: c.id, title: c.title, detail: c.description ?? "" })) });
  }
  return sections;
}
