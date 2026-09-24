// Skills sync planning: validation against bb's rules, ownership, drift and
// the diff an engineer reviews before **Update**.
//
// Everything here is pure. The server walks the source checkout and the skill
// root, then hands the facts to these functions.
import { parse as parseYaml } from "yaml";

/** bb's per-skill limits, the ones remote machines enforce. */
export const SKILL_LIMITS = { files: 1000, bytes: 10 * 1024 * 1024, depth: 24 } as const;

/** bb's skill name rule: lowercase words joined by hyphens, at most 64. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillFrontmatter {
  name: string | null;
  description: string | null;
}

export function parseFrontmatter(text: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null) return { name: null, description: null };
  try {
    const data = parseYaml(match[1] ?? "") as Record<string, unknown> | null;
    return {
      name: typeof data?.name === "string" ? data.name : null,
      description: typeof data?.description === "string" ? data.description : null,
    };
  } catch {
    return { name: null, description: null };
  }
}

/** One entry of a skill folder, as the server's walk found it. */
export interface TreeEntry {
  /** Path relative to the skill folder, `/`-separated. */
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  /** For symlinks: whether the resolved target stays inside the source checkout. */
  targetInsideSource?: boolean;
}

export type SkillValidation = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Checks a candidate skill folder. Symlinks whose target stays inside the
 * source are allowed (the sync copies their content); any other symlink
 * rejects the skill and names the file.
 */
export function validateSkill(
  folder: string,
  entries: readonly TreeEntry[],
  skillMd: string | null,
): SkillValidation {
  if (skillMd === null) return { ok: false, reason: `${folder}: no SKILL.md` };
  const { name, description } = parseFrontmatter(skillMd);
  if (name === null) return { ok: false, reason: `${folder}/SKILL.md: no name in the frontmatter` };
  if (name !== folder) {
    return {
      ok: false,
      reason: `${folder}/SKILL.md: name "${name}" differs from the folder "${folder}"`,
    };
  }
  if (!SKILL_NAME.test(name) || name.length > 64) {
    return {
      ok: false,
      reason: `${folder}: "${name}" isn't a valid skill name (lowercase words joined by hyphens, at most 64)`,
    };
  }
  if (description === null || description.trim() === "" || description.length > 1024) {
    return {
      ok: false,
      reason: `${folder}/SKILL.md: needs a description of 1 to 1024 characters`,
    };
  }
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    if (entry.type === "symlink" && entry.targetInsideSource !== true) {
      return { ok: false, reason: `${folder}/${entry.path}: a symlink that points outside the source` };
    }
    if (entry.path.split("/").length > SKILL_LIMITS.depth) {
      return { ok: false, reason: `${folder}/${entry.path}: nested deeper than ${SKILL_LIMITS.depth}` };
    }
    if (entry.type !== "dir") {
      files += 1;
      bytes += entry.size;
    }
  }
  if (files > SKILL_LIMITS.files) {
    return { ok: false, reason: `${folder}: ${files} files, more than bb's ${SKILL_LIMITS.files}` };
  }
  if (bytes > SKILL_LIMITS.bytes) {
    return { ok: false, reason: `${folder}: ${(bytes / 1048576).toFixed(1)} MiB, more than bb's 10 MiB` };
  }
  return { ok: true, name };
}

/** Converts a `paths`/`exclude` glob to a regex: `*` is one segment, `**` any. */
export function globToRegExp(glob: string): RegExp {
  const trimmed = glob.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") return /^$/;
  let source = "";
  const parts = trimmed.split("/");
  parts.forEach((part, index) => {
    if (part === "**") {
      source += index === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
      return;
    }
    source += part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    if (index < parts.length - 1) source += "/";
  });
  return new RegExp(`^${source}$`);
}

/** Folders in the source that the manifest selects. */
export function selectSkillFolders(
  candidates: readonly string[],
  paths: readonly string[],
  exclude: readonly string[],
): string[] {
  const include = paths.map(globToRegExp);
  const skip = exclude.map(globToRegExp);
  return candidates
    .filter((dir) => include.some((re) => re.test(dir)) && !skip.some((re) => re.test(dir)))
    .sort();
}

/** What the plugin records per skill folder it installed. Kept in plugin storage. */
export interface Ownership {
  folder: string;
  entryId: string;
  sourceCommit: string;
  /** Git tree id of the folder at `sourceCommit`. */
  gitTree: string;
  /** Hash of the installed files, to notice local edits. */
  treeHash: string;
}

/** A skill as the source has it at one commit. */
export interface SourceSkill {
  folder: string;
  gitTree: string;
  skillMd: string;
}

/** A folder under the skill root, as found on disk. */
export interface InstalledFolder {
  folder: string;
  treeHash: string;
  skillMd: string | null;
}

export type SkillAction =
  | { kind: "install"; folder: string }
  | { kind: "update"; folder: string }
  | { kind: "unchanged"; folder: string }
  | { kind: "edited"; folder: string }
  | { kind: "conflict"; folder: string }
  | { kind: "owned-elsewhere"; folder: string; entryId: string }
  | { kind: "remove"; folder: string }
  | { kind: "missing"; folder: string };

export interface SyncPlan {
  actions: SkillAction[];
  /** Diff for the update sheet. */
  added: string[];
  changed: string[];
  removed: string[];
}

/**
 * Compares the source with the skill root and what this entry owns.
 *
 * - A folder the plugin doesn't own is never touched (`conflict`).
 * - An owned folder whose files changed is `edited`: the engineer chooses.
 * - An owned folder whose source tree changed is `update`.
 * - An owned folder gone from the source is `remove`, after confirmation.
 */
export function planSync(
  entryId: string,
  source: readonly SourceSkill[],
  installed: ReadonlyMap<string, InstalledFolder>,
  owned: ReadonlyMap<string, Ownership>,
): SyncPlan {
  const actions: SkillAction[] = [];
  const plan: SyncPlan = { actions, added: [], changed: [], removed: [] };
  const sourceFolders = new Set(source.map((skill) => skill.folder));
  for (const skill of source) {
    const onDisk = installed.get(skill.folder);
    const record = owned.get(skill.folder);
    if (record !== undefined && record.entryId !== entryId) {
      actions.push({ kind: "owned-elsewhere", folder: skill.folder, entryId: record.entryId });
      continue;
    }
    if (onDisk === undefined) {
      if (record !== undefined) {
        actions.push({ kind: "missing", folder: skill.folder });
      } else {
        actions.push({ kind: "install", folder: skill.folder });
        plan.added.push(skill.folder);
      }
      continue;
    }
    if (record === undefined) {
      actions.push({ kind: "conflict", folder: skill.folder });
      continue;
    }
    if (onDisk.treeHash !== record.treeHash) {
      actions.push({ kind: "edited", folder: skill.folder });
      continue;
    }
    if (skill.gitTree !== record.gitTree) {
      actions.push({ kind: "update", folder: skill.folder });
      plan.changed.push(skill.folder);
      continue;
    }
    actions.push({ kind: "unchanged", folder: skill.folder });
  }
  for (const record of owned.values()) {
    if (record.entryId !== entryId || sourceFolders.has(record.folder)) continue;
    actions.push({ kind: "remove", folder: record.folder });
    plan.removed.push(record.folder);
  }
  return plan;
}

/** The skills entry's check outcome, from its plan. */
export function summarisePlan(plan: SyncPlan): {
  outcome: "pass" | "fail" | "update";
  category: string;
  detail: string;
} {
  const count = (kind: SkillAction["kind"]) =>
    plan.actions.filter((action) => action.kind === kind).map((action) => action.folder);
  const conflicts = count("conflict");
  const elsewhere = count("owned-elsewhere");
  if (conflicts.length > 0) {
    return {
      outcome: "fail",
      category: "conflict",
      detail: `A skill folder you made has the same name as a team skill: ${conflicts.join(", ")}. Nothing was overwritten.`,
    };
  }
  if (elsewhere.length > 0) {
    return {
      outcome: "fail",
      category: "conflict",
      detail: `Another manifest entry already installs ${elsewhere.join(", ")}.`,
    };
  }
  // Nothing of this entry installed yet: a first install, which is safe.
  const owned = plan.actions.filter((action) => ["update", "unchanged", "edited", "missing", "remove"].includes(action.kind));
  const installs = count("install");
  if (owned.length === 0 && installs.length > 0) {
    return {
      outcome: "fail",
      category: "not-installed",
      detail: `${installs.length} ${installs.length === 1 ? "skill" : "skills"} to install.`,
    };
  }
  const edited = count("edited");
  if (edited.length > 0) {
    return {
      outcome: "update",
      category: "edited",
      detail: `Edited locally: ${edited.join(", ")}.`,
    };
  }
  const missing = count("missing");
  if (missing.length > 0) {
    return {
      outcome: "fail",
      category: "not-installed",
      detail: `Deleted from the skill folder: ${missing.join(", ")}.`,
    };
  }
  if (plan.added.length > 0 || plan.changed.length > 0 || plan.removed.length > 0) {
    const parts: string[] = [];
    if (plan.added.length > 0) parts.push(`added: ${plan.added.join(", ")}`);
    if (plan.changed.length > 0) parts.push(`changed: ${plan.changed.join(", ")}`);
    if (plan.removed.length > 0) parts.push(`removed: ${plan.removed.join(", ")}`);
    return { outcome: "update", category: "update", detail: `Update available (${parts.join("; ")}).` };
  }
  return { outcome: "pass", category: "ok", detail: "Installed and up to date." };
}

/** Whether a ref looks pinned (tag or SHA) rather than a tracked branch. */
export function isPinnedRef(ref: string, remoteTags: readonly string[]): boolean {
  if (/^[0-9a-f]{40}$/.test(ref)) return true;
  if (ref.startsWith("refs/tags/")) return true;
  return remoteTags.includes(ref);
}

/** A compact line diff for `SKILL.md`, in unified style with no hunks header. */
export function lineDiff(before: string, after: string, context = 2): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return "(too large to diff)";
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: { tag: " " | "-" | "+"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", line: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ tag: "-", line: a[i]! });
      i += 1;
    } else {
      ops.push({ tag: "+", line: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ tag: "-", line: a[i++]! });
  while (j < m) ops.push({ tag: "+", line: b[j++]! });
  const keep = new Set<number>();
  ops.forEach((op, index) => {
    if (op.tag === " ") return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) {
      keep.add(k);
    }
  });
  const out: string[] = [];
  let last = -1;
  [...keep].sort((x, y) => x - y).forEach((index) => {
    if (last !== -1 && index > last + 1) out.push("…");
    out.push(`${ops[index]!.tag} ${ops[index]!.line}`);
    last = index;
  });
  return out.join("\n");
}
