// Shared vocabulary: items, statuses, results and fixes.
//
// These are plain data so the server, the CLI and the UI all
// read the same shapes. Nothing here touches the network or the disk, and
// nothing imports zod, so the UI bundle can use it.

export const STATUSES = [
  "ok",
  "todo",
  "broken",
  "update",
  "needs-approval",
  "unknown",
  "skipped",
] as const;
export type Status = (typeof STATUSES)[number];

/** Checklist groups, in display order. "nice" holds every optional item. */
export const GROUPS = [
  "github",
  "ssh",
  "agents",
  "skills",
  "plugins",
  "tools",
  "env",
  "team",
] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_TITLES: Record<Group | "nice", string> = {
  github: "GitHub",
  ssh: "SSH",
  agents: "Agents",
  skills: "Skills",
  plugins: "Plugins",
  tools: "Tools",
  env: "Environment",
  team: "Team checks",
  nice: "Nice to have",
};

/**
 * What a check reports, before history turns it into a status. `fail` becomes
 * `todo` or `broken` depending on whether the item ever passed on that machine.
 */
export type Outcome = "pass" | "fail" | "update" | "needs-approval" | "error";

/** Where an item runs, resolved against the machines bb knows. */
export type Scope = "server" | "all" | string[];

/** How a check for an item works. The engine switches on `kind`. */
export type CheckSpec =
  | { kind: "bb-version" }
  | { kind: "manifest" }
  | { kind: "gh-installed" }
  | { kind: "gh-login"; host: string; scopes: string[] }
  | { kind: "builtin-git" }
  | { kind: "github-mode" }
  | { kind: "repo-access"; accessId: string; repo: string; host: string }
  | { kind: "ssh-key" }
  | { kind: "ssh-known-hosts" }
  | { kind: "ssh-config" }
  | { kind: "ssh-uploaded"; host: string }
  | { kind: "ssh-signing" }
  | { kind: "provider"; providerId: string }
  | { kind: "skills"; entryId: string }
  | { kind: "skills-orphaned"; folders: string[] }
  | { kind: "plugin"; entryId: string }
  | { kind: "marketplace"; entryId: string }
  | {
      kind: "tool";
      entryId: string;
      bin: string;
      args: string[];
      pattern: string;
      min: string | null;
    }
  | { kind: "env"; name: string }
  | { kind: "team-check"; entryId: string; command: string };

export interface ItemDef {
  /** Stable id: `github.login`, `skill:team`, `tool:gh`. Logged; never a URL. */
  id: string;
  group: Group;
  title: string;
  /** One line on why it matters. */
  why: string;
  required: boolean;
  scope: Scope;
  check: CheckSpec;
  /** A rough time estimate for the Next step card. */
  estimate: string;
  /** Commands from the team this item may run, for approval. */
  commands: TeamCommand[];
}

/** A command, tool install or plugin source from the manifest. */
export interface TeamCommand {
  /** What part of the item it is: `run`, `fix`, `install`, `source`. */
  role: "run" | "fix" | "install" | "source";
  /** The id the approval is keyed on (the item id). */
  id: string;
  text: string;
  ref: string | null;
  hash: string;
}

/**
 * Small, non-sensitive facts a check found, for the UI: a GitHub login, the
 * scopes that are missing, a public key, a version. Never URLs or raw output.
 */
export type Facts = Record<string, string | number | boolean | null | string[]>;

export interface ItemResult {
  itemId: string;
  hostId: string;
  status: Status;
  /** A short machine-readable category: `ok`, `no-auth`, `missing-scope`, … */
  category: string;
  checkedAt: string | null;
  /** One redacted, human sentence. */
  detail: string;
  facts: Facts;
}

/** Every kind of fix the plugin can offer. */
export const FIX_KINDS = [
  "device-login",
  "device-refresh",
  "gh-setup-git",
  "open-terminal",
  "ssh-keygen",
  "write-known-hosts",
  "write-ssh-config",
  "gh-ssh-key-add",
  "copy-public-key",
  "copy-text",
  "ssh-signing-setup",
  "skills-sync",
  "skills-update",
  "skills-restore",
  "skills-keep-mine",
  "skills-rename-mine",
  "skills-replace-mine",
  "skills-remove",
  "plugin-install",
  "plugin-update",
  "plugin-settings",
  "marketplace-add",
  "provider-install",
  "provider-update",
  "provider-login",
  "env-set",
  "team-fix-run",
  "team-fix-terminal",
  "tool-install",
  "switch-per-machine",
  "enable-builtin-git",
  "approve",
  "open-url",
  "check-in-terminal",
] as const;
export type FixKind = (typeof FIX_KINDS)[number];

export interface Fix {
  kind: FixKind;
  label: string;
  /** The command it runs or types, shown verbatim when it comes from the team. */
  command: string | null;
  url: string | null;
  /** Safe fixes may run in bulk ("Fix all safe items"). */
  safe: boolean;
  /** Set when approval is needed first: the approval hash. */
  approvalHash: string | null;
  /** Asks for confirmation with this text before it runs. */
  confirm: string | null;
}

export function makeFix(kind: FixKind, label: string, extra: Partial<Fix> = {}): Fix {
  return {
    kind,
    label,
    command: null,
    url: null,
    safe: false,
    approvalHash: null,
    confirm: null,
    ...extra,
  };
}
