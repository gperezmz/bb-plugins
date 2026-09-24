// Installs team skills into bb's own skill root, `<dataDir>/skills`, on the
// server machine. bb hands that root to every provider and copies it to every
// other machine, so nothing is installed per machine.
//
// Sync stages outside the skill root on the same filesystem, validates, then
// renames each folder into place. Ownership lives in plugin storage, never as
// a file inside the skill (it would ship to every machine with it).
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parseApmManifest, parseApmReference } from "../core/apm.js";
import type { Manifest, SkillSource } from "../core/manifest.js";
import type { Facts, Outcome } from "../core/model.js";
import {
  isPinnedRef,
  lineDiff,
  planSync,
  selectSkillFolders,
  summarisePlan,
  validateSkill,
  type InstalledFolder,
  type SourceSkill,
  type SyncPlan,
  type TreeEntry,
} from "../core/skills.js";
import { GitError, sparsePatterns, type Git } from "./git.js";
import type { Store } from "./store.js";

const REGISTRY_MARKER = ".bb-registry-skill.json";
const STAGING = ".team-onboarding-staging";

export interface SkillsCheck {
  outcome: Outcome;
  category: string;
  detail: string;
  facts: Facts;
  raw: string;
}

interface ResolvedSource {
  url: string;
  ref: string | null;
  paths: string[];
  exclude: string[];
}

interface Snapshot {
  commit: string;
  skills: (SourceSkill & { dir: string; valid: boolean; reason: string | null })[];
  cleanup: () => Promise<void>;
}

export interface SkillsDeps {
  dataDir: () => string;
  store: Store;
  git: Git;
  githubHost: () => string;
  registryInstall: (registrySkillId: string) => Promise<void>;
  registryRemove: (folder: string) => Promise<void>;
  log: (message: string) => void;
}

export class SkillsSync {
  /**
   * The last full check of each entry and the inputs it saw: remote commits,
   * the installed folders and who owns them. A scheduled check with the same
   * inputs reuses it rather than cloning again.
   */
  private readonly lastFull = new Map<string, { inputs: string; result: SkillsCheck }>();
  /** An apm.yml's sources at the commit they were read from. */
  private readonly apmSources = new Map<string, { commit: string; sources: ResolvedSource[] }>();

  constructor(private readonly deps: SkillsDeps) {}

  private root(): string {
    return join(this.deps.dataDir(), "skills");
  }

  // --- checks ---------------------------------------------------------------

  /**
   * Checks an entry against its remote. With `reuse` (a scheduled check),
   * unchanged inputs since the last full check return its result without a
   * clone; the remote is still asked for its commits every time.
   */
  async check(entry: SkillSource, manifest: Manifest, signal?: AbortSignal, reuse = false): Promise<SkillsCheck> {
    if (entry.source === "registry") return this.checkRegistry(entry);
    if (entry.source === "plugin") {
      throw new Error("plugin-sourced skills are checked with the plugins");
    }
    let snapshots: Snapshot[] = [];
    try {
      const sources = await this.resolve(entry, manifest, signal, reuse);
      const owned = this.deps.store.owners();
      const mine = [...owned.values()].filter((record) => record.entryId === entry.id);
      const installed = await this.installedFolders();
      // Cheap path: every source still at the commits a full check last
      // found exactly in sync, and nothing edited or missing locally, means no
      // clone is needed. Any other remote commit, a force-push back to an
      // older one included, takes the full check.
      const remote = await Promise.all(sources.map((source) => this.remoteCommit(source, signal)));
      const state = await this.deps.store.skillSource(entry.id);
      const untouched =
        mine.length > 0 &&
        state !== null &&
        state.config === configKey(sources) &&
        Array.isArray(state.commits) &&
        state.commits.length === remote.length &&
        remote.every((commit, index) => commit !== null && commit === state.commits[index]) &&
        mine.every((record) => installed.get(record.folder)?.treeHash === record.treeHash);
      const inputs = JSON.stringify([
        configKey(sources),
        remote,
        [...installed.values()].map((folder) => [folder.folder, folder.treeHash]).sort(),
        [...owned.values()].map((record) => [record.folder, record.entryId, record.treeHash]).sort(),
      ]);
      const last = this.lastFull.get(entry.id);
      if (!untouched && reuse && last !== undefined && last.inputs === inputs) return last.result;
      if (untouched) {
        return {
          outcome: "pass",
          category: "ok",
          detail: `${mine.length} ${mine.length === 1 ? "skill" : "skills"} installed and up to date.`,
          facts: { skillCount: mine.length, source: entry.source, skills: mine.map((record) => record.folder).sort() },
          raw: "",
        };
      }
      snapshots = await Promise.all(sources.map((source) => this.snapshot(source, signal)));
      const { skills, rejected } = this.merge(snapshots);
      const plan = planSync(entry.id, skills, installed, owned);
      // A rejected skill keeps its previous version: never plan to remove it.
      plan.actions = plan.actions.filter(
        (action) => !(action.kind === "remove" && rejected.some((r) => r.folder === action.folder)),
      );
      plan.removed = plan.removed.filter((folder) => !rejected.some((r) => r.folder === folder));
      const facts: Facts = {
        source: entry.source,
        skillCount: mine.length,
        skills: skills.map((skill) => skill.folder),
        added: plan.added,
        changed: plan.changed,
        removed: plan.removed,
      };
      if (rejected.length > 0) {
        const result: SkillsCheck = {
          outcome: "fail",
          category: "invalid",
          detail: `Rejected: ${rejected.map((r) => r.reason).join("; ")}. ${mine.length > 0 ? "The previous version stays." : ""}`.trim(),
          facts,
          raw: "",
        };
        this.lastFull.set(entry.id, { inputs, result });
        return result;
      }
      const summary = summarisePlan(plan);
      if (summary.outcome === "pass") {
        await this.deps.store.setSkillSource({
          entryId: entry.id,
          config: configKey(sources),
          commits: snapshots.map((snapshot) => snapshot.commit),
          syncedAt: new Date().toISOString(),
        });
      }
      const result: SkillsCheck = { ...summary, facts, raw: "" };
      this.lastFull.set(entry.id, { inputs, result });
      return result;
    } catch (error) {
      if (error instanceof GitError) {
        const pinned = "ref" in entry && entry.ref !== undefined && /^[0-9a-f]{40}$/.test(entry.ref);
        const category = error.category === "error" && pinned ? "ref-missing" : error.category;
        return {
          outcome: category === "network" ? "error" : "fail",
          category,
          detail: skillsErrorText(category),
          facts: { source: entry.source },
          raw: error.raw,
        };
      }
      if (error instanceof SourceError) {
        return { outcome: "fail", category: error.category, detail: error.message, facts: { source: entry.source }, raw: "" };
      }
      throw error;
    } finally {
      await Promise.all(snapshots.map((snapshot) => snapshot.cleanup()));
    }
  }

  private async checkRegistry(entry: Extract<SkillSource, { source: "registry" }>): Promise<SkillsCheck> {
    const folder = entry.registrySkillId.split("/").pop()!;
    const dir = join(this.root(), folder);
    const exists = await pathExists(dir);
    if (!exists) {
      return {
        outcome: "fail",
        category: "not-installed",
        detail: "Not installed yet.",
        facts: { source: "registry", skillCount: 0 },
        raw: "",
      };
    }
    try {
      const marker = JSON.parse(await readFile(join(dir, REGISTRY_MARKER), "utf8")) as { registrySkillId?: string };
      if (marker.registrySkillId === entry.registrySkillId) {
        return { outcome: "pass", category: "ok", detail: "Installed from skills.sh.", facts: { source: "registry", skillCount: 1 }, raw: "" };
      }
    } catch {
      // No marker: a hand-made folder.
    }
    return {
      outcome: "fail",
      category: "conflict",
      detail: `A skill folder you made has the same name as a team skill: ${folder}. Nothing was overwritten.`,
      facts: { source: "registry", skillCount: 0 },
      raw: "",
    };
  }

  /** Added, changed and removed skills, with each changed SKILL.md diffed. */
  async diff(entry: SkillSource, manifest: Manifest, signal?: AbortSignal) {
    if (entry.source === "registry" || entry.source === "plugin") {
      return { added: [], changed: [], removed: [], diffs: [] as { folder: string; diff: string }[] };
    }
    const snapshots = await Promise.all((await this.resolve(entry, manifest, signal)).map((source) => this.snapshot(source, signal)));
    try {
      const { skills } = this.merge(snapshots);
      const installed = await this.installedFolders();
      const plan = planSync(entry.id, skills, installed, this.deps.store.owners());
      const diffs = [];
      for (const folder of plan.changed) {
        const before = installed.get(folder)?.skillMd ?? "";
        const after = skills.find((skill) => skill.folder === folder)?.skillMd ?? "";
        diffs.push({ folder, diff: lineDiff(before, after) });
      }
      return { added: plan.added, changed: plan.changed, removed: plan.removed, diffs };
    } finally {
      await Promise.all(snapshots.map((snapshot) => snapshot.cleanup()));
    }
  }

  // --- actions --------------------------------------------------------------

  /**
   * Applies a sync action for one entry.
   * - `install`: skills not installed yet (the safe fix).
   * - `update`: changed skills from a tracked ref.
   * - `restore`: replace locally edited skills with the team version.
   * - `remove`: remove owned skills gone from the source.
   * - `replace-mine`: replace hand-made folders with the team version.
   */
  async apply(
    entry: SkillSource,
    manifest: Manifest,
    action: "install" | "update" | "restore" | "remove" | "replace-mine",
    signal?: AbortSignal,
  ): Promise<string> {
    if (entry.source === "registry") return this.applyRegistry(entry, action);
    if (entry.source === "plugin") throw new Error("plugin-sourced skills install as plugins");
    const snapshots = await Promise.all((await this.resolve(entry, manifest, signal)).map((source) => this.snapshot(source, signal)));
    try {
      const { skills, rejected } = this.merge(snapshots);
      const installed = await this.installedFolders();
      const owned = this.deps.store.owners();
      const plan = planSync(entry.id, skills, installed, owned);
      const wanted = new Set<string>(
        plan.actions
          .filter((a) =>
            action === "install"
              ? a.kind === "install" || a.kind === "missing"
              : action === "update"
                ? a.kind === "update" || a.kind === "install" || a.kind === "missing"
                : action === "restore"
                  ? a.kind === "edited"
                  : action === "replace-mine"
                    ? a.kind === "conflict"
                    : a.kind === "remove",
          )
          .map((a) => a.folder),
      );
      if (action === "remove") {
        for (const folder of wanted) await this.removeOwned(folder);
        return `Removed ${wanted.size} ${wanted.size === 1 ? "skill" : "skills"}.`;
      }
      let count = 0;
      for (const skill of skills) {
        if (!wanted.has(skill.folder) || rejected.some((r) => r.folder === skill.folder)) continue;
        await this.installOne(entry.id, skill, snapshots.find((s) => s.skills.includes(skill))!.commit, action === "replace-mine");
        count += 1;
      }
      // The recheck after this fix records the in-sync commits, if it is.
      const notes = rejected.length > 0 ? ` Rejected: ${rejected.map((r) => r.reason).join("; ")}.` : "";
      const verb = action === "install" ? "Installed" : action === "restore" ? "Restored" : action === "replace-mine" ? "Replaced" : "Updated";
      return `${verb} ${count} ${count === 1 ? "skill" : "skills"}.${notes}`;
    } finally {
      await Promise.all(snapshots.map((snapshot) => snapshot.cleanup()));
    }
  }

  /** Keep my edits: the plugin disowns the folders it no longer matches. */
  async keepMine(entry: SkillSource): Promise<string> {
    const installed = await this.installedFolders();
    let count = 0;
    for (const record of this.deps.store.owners().values()) {
      if (record.entryId !== entry.id) continue;
      if (installed.get(record.folder)?.treeHash !== record.treeHash) {
        this.deps.store.disown(record.folder);
        count += 1;
      }
    }
    return `Kept your edits to ${count} ${count === 1 ? "skill" : "skills"}; the team version no longer updates them.`;
  }

  /** Rename mine: moves a hand-made folder aside as `<name>-mine`, then installs. */
  async renameMine(entry: SkillSource, manifest: Manifest, signal?: AbortSignal): Promise<string> {
    if (entry.source === "plugin") throw new Error("not a folder source");
    const owned = this.deps.store.owners();
    const installed = await this.installedFolders();
    const folders =
      entry.source === "registry"
        ? [entry.registrySkillId.split("/").pop()!]
        : (await this.check(entry, manifest, signal)).facts.skills;
    const renamed: string[] = [];
    for (const folder of Array.isArray(folders) ? folders : []) {
      if (!installed.has(folder) || owned.has(folder)) continue;
      let target = `${folder}-mine`;
      for (let n = 2; await pathExists(join(this.root(), target)); n += 1) target = `${folder}-mine-${n}`;
      await rename(join(this.root(), folder), join(this.root(), target));
      // bb requires the SKILL.md name to match the folder.
      await rewriteSkillName(join(this.root(), target, "SKILL.md"), target);
      renamed.push(`${folder} → ${target}`);
    }
    const installedNow = await this.apply(entry, manifest, "install", signal);
    return `Renamed ${renamed.join(", ")}. ${installedNow}`;
  }

  private async applyRegistry(
    entry: Extract<SkillSource, { source: "registry" }>,
    action: string,
  ): Promise<string> {
    const folder = entry.registrySkillId.split("/").pop()!;
    if (action === "update" || action === "replace-mine") {
      await this.deps.registryRemove(folder);
    }
    await this.deps.registryInstall(entry.registrySkillId);
    return action === "update" ? "Reinstalled from skills.sh." : "Installed from skills.sh.";
  }

  // --- sources ----------------------------------------------------------------

  private async resolve(entry: SkillSource, manifest: Manifest, signal?: AbortSignal, reuse = false): Promise<ResolvedSource[]> {
    if (entry.source === "git") {
      return [{ url: entry.url, ref: entry.ref, paths: entry.paths, exclude: entry.exclude }];
    }
    if (entry.source !== "apm") return [];
    const host = manifest.github.host;
    if (entry.package !== undefined) {
      const ref = parseApmReference(entry.package, host);
      if (ref === null) throw new SourceError("invalid", "The apm package reference isn't owner/repo[/path][#ref].");
      return [{ url: ref.url, ref: ref.ref, paths: ref.paths, exclude: [] }];
    }
    // The same apm.yml at the same commit lists the same sources: a
    // scheduled check asks for the commit and clones only when it moved.
    const key = JSON.stringify([entry.url, entry.ref ?? null, entry.path, host]);
    const known = this.apmSources.get(key);
    if (reuse && known !== undefined && (await this.deps.git.lsRemote(entry.url!, entry.ref ?? null, signal)) === known.commit) {
      return known.sources;
    }
    const checkout = await this.deps.git.sparseClone(entry.url!, entry.ref ?? null, [`/${entry.path}`], signal);
    try {
      const text = await readFile(join(checkout.dir, entry.path), "utf8").catch(() => {
        throw new SourceError("invalid", `No ${entry.path} in that repository.`);
      });
      const parsed = parseApmManifest(text, host);
      if (!parsed.ok) throw new SourceError("invalid", parsed.error);
      const sources = parsed.sources.map((source) => ({ url: source.url, ref: source.ref, paths: source.paths, exclude: [] }));
      this.apmSources.set(key, { commit: checkout.commit, sources });
      return sources;
    } finally {
      await checkout.cleanup();
    }
  }

  private async remoteCommit(source: ResolvedSource, signal?: AbortSignal): Promise<string | null> {
    const commit = await this.deps.git.lsRemote(source.url, source.ref, signal);
    if (commit === null && source.ref !== null) {
      const tags = await this.deps.git.remoteTags(source.url, signal);
      if (isPinnedRef(source.ref, tags)) {
        throw new GitError("ref-missing", "pinned ref missing", "");
      }
      throw new GitError("ref-missing", "ref missing", "");
    }
    return commit;
  }

  private async snapshot(source: ResolvedSource, signal?: AbortSignal): Promise<Snapshot> {
    const checkout = await this.deps.git.sparseClone(source.url, source.ref, sparsePatterns(source.paths), signal);
    try {
      const root = await realpath(checkout.dir);
      const candidates = await findSkillDirs(root);
      const selected = selectSkillFolders(candidates, source.paths, source.exclude);
      const skills: Snapshot["skills"] = [];
      for (const rel of selected) {
        const dir = join(root, rel);
        const folder = rel === "" ? basename(source.url).replace(/\.git$/, "") : basename(rel);
        const entries = await walk(dir, root);
        const skillMd = await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null);
        const validation = validateSkill(folder, entries, skillMd);
        const gitTree = (await this.deps.git.treeId(root, checkout.commit, rel === "" ? "" : rel)) ?? "";
        skills.push({
          folder,
          dir,
          gitTree,
          skillMd: skillMd ?? "",
          valid: validation.ok,
          reason: validation.ok ? null : validation.reason,
        });
      }
      return { commit: checkout.commit, skills, cleanup: checkout.cleanup };
    } catch (error) {
      await checkout.cleanup();
      throw error;
    }
  }

  private merge(snapshots: Snapshot[]) {
    const skills: Snapshot["skills"] = [];
    const rejected: { folder: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      for (const skill of snapshot.skills) {
        if (seen.has(skill.folder)) {
          rejected.push({ folder: skill.folder, reason: `${skill.folder}: listed twice in this entry` });
          continue;
        }
        seen.add(skill.folder);
        if (!skill.valid) rejected.push({ folder: skill.folder, reason: skill.reason ?? skill.folder });
        skills.push(skill);
      }
    }
    return { skills, rejected };
  }

  // --- the skill root -----------------------------------------------------------

  async installedFolders(): Promise<Map<string, InstalledFolder>> {
    const out = new Map<string, InstalledFolder>();
    let names: string[] = [];
    try {
      names = await readdir(this.root());
    } catch {
      return out;
    }
    for (const name of names) {
      const dir = join(this.root(), name);
      const info = await lstat(dir).catch(() => null);
      if (info === null || !info.isDirectory()) continue;
      out.set(name, {
        folder: name,
        treeHash: await treeHash(dir),
        skillMd: await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null),
      });
    }
    return out;
  }

  private async installOne(entryId: string, skill: Snapshot["skills"][number], commit: string, replaceUnowned: boolean) {
    const dataDir = this.deps.dataDir();
    const staging = join(dataDir, STAGING, randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      const staged = join(staging, skill.folder);
      await copySkill(skill.dir, staged, await realpath(skill.dir));
      // Revalidate what will actually land.
      const entries = await walk(staged, staged);
      const validation = validateSkill(skill.folder, entries, await readFile(join(staged, "SKILL.md"), "utf8").catch(() => null));
      if (!validation.ok) throw new Error(validation.reason);
      const hash = await treeHash(staged);
      await mkdir(this.root(), { recursive: true });
      const target = join(this.root(), skill.folder);
      const owned = this.deps.store.owners().get(skill.folder);
      if (await pathExists(target)) {
        if (owned === undefined && !replaceUnowned) throw new Error(`${skill.folder} exists and isn't ours`);
        await rename(target, join(staging, `${skill.folder}.previous`));
      }
      await rename(staged, target);
      this.deps.store.own({ folder: skill.folder, entryId, sourceCommit: commit, gitTree: skill.gitTree, treeHash: hash });
      this.deps.log(`skill installed: ${skill.folder}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
      await removeIfEmpty(join(dataDir, STAGING));
    }
  }

  private async removeOwned(folder: string) {
    const target = join(this.root(), folder);
    const staging = join(this.deps.dataDir(), STAGING, randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      if (await pathExists(target)) await rename(target, join(staging, folder));
      this.deps.store.disown(folder);
    } finally {
      await rm(staging, { recursive: true, force: true });
      await removeIfEmpty(join(this.deps.dataDir(), STAGING));
    }
  }

  /**
   * Drops ownership records of folders that are gone from the skill root and
   * no longer listed in the manifest: there is nothing left to remove.
   */
  async forgetVanished(liveEntryIds: ReadonlySet<string>): Promise<void> {
    for (const record of this.deps.store.owners().values()) {
      if (liveEntryIds.has(record.entryId)) continue;
      if (!(await pathExists(join(this.root(), record.folder)))) this.deps.store.disown(record.folder);
    }
    // Sync records of entries that are gone and own nothing any more.
    const owning = new Set([...this.deps.store.owners().values()].map((record) => record.entryId));
    for (const entryId of await this.deps.store.skillSourceIds()) {
      if (!liveEntryIds.has(entryId) && !owning.has(entryId)) await this.deps.store.deleteSkillSource(entryId);
    }
  }

  /** Removes one folder this plugin owns. Never touches others. */
  async removeFolder(folder: string): Promise<void> {
    if (!this.deps.store.owners().has(folder)) throw new Error(`${folder} isn't a skill this plugin installed`);
    await this.removeOwned(folder);
  }

  /** Removes every folder this plugin owns for entries no longer in the manifest. */
  async orphanedFolders(liveEntryIds: ReadonlySet<string>): Promise<string[]> {
    return [...this.deps.store.owners().values()]
      .filter((record) => !liveEntryIds.has(record.entryId))
      .map((record) => record.folder);
  }
}

function configKey(sources: readonly ResolvedSource[]): string {
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex").slice(0, 16);
}

class SourceError extends Error {
  constructor(readonly category: string, message: string) {
    super(message);
  }
}

function skillsErrorText(category: string): string {
  switch (category) {
    case "ref-missing":
      return "The pinned version can't be fetched. Installed skills stay as they are.";
    case "no-auth":
      return "The server's git credentials can't read the skills repository. Log in to GitHub first.";
    case "no-access":
      return "GitHub says the skills repository doesn't exist. It says the same when you can't read it.";
    case "network":
      return "Couldn't reach the skills repository.";
    case "blocked":
      return "The skills source is on this machine or a private network address, which the plugin doesn't fetch from.";
    default:
      return "Couldn't fetch the skills.";
  }
}

/** Leaves no empty staging folder behind in the data directory. */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    if ((await readdir(dir)).length === 0) await rmdir(dir);
  } catch {
    // Already gone, or in use by a concurrent sync.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every directory under `root` holding a SKILL.md, relative, `/`-separated. */
async function findSkillDirs(root: string, depth = 8): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string, level: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === "SKILL.md")) {
      out.push(toPosix(relative(root, dir)));
    }
    if (level >= depth) return;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git") await visit(join(dir, entry.name), level + 1);
    }
  };
  await visit(root, 0);
  return out;
}

/** Entries of a skill folder. Symlinks note whether they stay inside `sourceRoot`. */
async function walk(dir: string, sourceRoot: string): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  const visit = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      const rel = toPosix(relative(dir, full));
      if (entry.isSymbolicLink()) {
        let inside = false;
        try {
          const target = await realpath(full);
          inside = target === sourceRoot || target.startsWith(sourceRoot + sep);
        } catch {
          inside = false;
        }
        const info = inside ? await stat(full) : null;
        out.push({ path: rel, type: "symlink", size: info?.isFile() ? info.size : 0, targetInsideSource: inside });
      } else if (entry.isDirectory()) {
        out.push({ path: rel, type: "dir", size: 0 });
        await visit(full);
      } else if (entry.isFile()) {
        out.push({ path: rel, type: "file", size: (await stat(full)).size });
      }
    }
  };
  await visit(dir);
  return out;
}

/** Copies a skill, dereferencing symlinks (validation already kept them inside the source). */
async function copySkill(from: string, to: string, _root: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => basename(source) !== ".git",
  });
}

/** sha256 over sorted `(path, content hash)` pairs, ignoring bb's registry marker. */
export async function treeHash(dir: string): Promise<string> {
  const files: [string, string][] = [];
  const visit = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = toPosix(relative(dir, full));
      if (rel === REGISTRY_MARKER) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isSymbolicLink()) files.push([rel, `link:${await readlink(full)}`]);
      else if (entry.isFile()) {
        files.push([rel, createHash("sha256").update(await readFile(full)).digest("hex")]);
      }
    }
  };
  await visit(dir);
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash("sha256");
  for (const [path, digest] of files) hash.update(`${path}\0${digest}\n`);
  return hash.digest("hex");
}

async function rewriteSkillName(skillMd: string, name: string): Promise<void> {
  try {
    const text = await readFile(skillMd, "utf8");
    await writeFile(skillMd, text.replace(/^(---\r?\n[\s\S]*?^name:\s*).*$/m, `$1${name}`));
  } catch {
    // No SKILL.md: bb already ignores the folder.
  }
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}
