// Turns a manifest (or no manifest) into checklist items.
//
// With no manifest the built-in core runs: bb version, gh on the server, the
// server's GitHub login, bb's built-in git and agent logins. A manifest adds
// its sections on top, in the checklist's group order.
import { teamCommand } from "./approval.js";
import type { Manifest, MachineRule } from "./manifest.js";
import type { ItemDef, Scope } from "./model.js";

export interface ItemContext {
  /** Providers bb knows, for the no-manifest core. */
  knownProviders: { id: string; displayName: string }[];
  /** Skill folders the plugin installed for entries no longer in the manifest. */
  orphanedSkills?: string[];
  /**
   * With no manifest loaded: whether a manifest file is there but can't be
   * used. Only then is the manifest an item; no file at all isn't a problem,
   * the manifest just doesn't apply.
   */
  manifestBroken?: boolean;
}

const DEFAULT_GITHUB_HOST = "github.com";

export function deriveItems(manifest: Manifest | null, context: ItemContext): ItemDef[] {
  const items: ItemDef[] = [];
  const push = (item: Omit<ItemDef, "commands"> & { commands?: ItemDef["commands"] }) =>
    items.push({ commands: [], ...item });
  const github = manifest?.github;
  const host = github?.host ?? DEFAULT_GITHUB_HOST;
  const perMachine = github?.mode === "per-machine";
  const topRule: Scope = manifest?.machines ?? "all";
  const ruleOr = (rule: MachineRule | undefined, fallback: Scope): Scope => rule ?? fallback;

  // --- GitHub -------------------------------------------------------------
  push({
    id: "github.gh-installed",
    group: "github",
    title: "GitHub CLI on the server",
    why: "bb's built-in git runs gh on the server machine to share your GitHub login.",
    required: true,
    scope: "server",
    check: { kind: "gh-installed" },
    estimate: "~2 min",
  });
  push({
    id: "github.login",
    group: "github",
    title: "Log in to GitHub",
    why: perMachine
      ? "Each machine uses its own GitHub login in per-machine mode."
      : "Agents need this to clone and push your team's repos on every machine.",
    required: true,
    scope: perMachine ? ruleOr(github?.machines, topRule) : "server",
    check: { kind: "gh-login", host, scopes: github?.scopes ?? [] },
    estimate: "~1 min",
  });
  if (perMachine) {
    push({
      id: "github.mode",
      group: "github",
      title: "Per-machine GitHub access",
      why: "Your team asks every machine to use its own GitHub login and SSH key.",
      required: true,
      scope: "server",
      check: { kind: "github-mode" },
      estimate: "~1 min",
    });
  } else {
    push({
      id: "github.builtin-git",
      group: "github",
      title: "bb's built-in git",
      why: "Gives agents on your other machines GitHub access by sharing the server's login.",
      required: true,
      // Checked on every machine: the question is whether agents there reach GitHub.
      scope: "all",
      check: { kind: "builtin-git" },
      estimate: "~1 min",
    });
  }
  for (const access of github?.access ?? []) {
    push({
      id: `github.access:${access.id}`,
      group: "github",
      title: access.title ?? `Access to ${access.id}`,
      why: "Agents need read access to this repository.",
      required: access.required ?? true,
      scope: access.machines ?? (perMachine ? ruleOr(github?.machines, topRule) : "server"),
      check: { kind: "repo-access", accessId: access.id, repo: access.repo, host },
      estimate: "~2 min",
    });
  }

  // --- SSH ----------------------------------------------------------------
  const signing = github?.signing?.required === true;
  const sshWanted =
    manifest !== null &&
    (perMachine || signing || (manifest.ssh !== undefined && manifest.ssh.enabled));
  if (manifest !== null && sshWanted) {
    const sshScope: Scope = perMachine
      ? ruleOr(manifest.ssh?.machines ?? github?.machines, topRule)
      : "server";
    const sshRequired = manifest.ssh?.required ?? true;
    const ssh = (
      id: string,
      title: string,
      why: string,
      check: ItemDef["check"],
      estimate = "~1 min",
    ) =>
      push({ id, group: "ssh", title, why, required: sshRequired, scope: sshScope, check, estimate });
    ssh("ssh.key", "SSH key", "A key for this machine, used only by bb and its agents.", {
      kind: "ssh-key",
    });
    ssh(
      "ssh.known-hosts",
      "GitHub's host keys",
      "Pins GitHub's published keys so git never trusts an impostor.",
      { kind: "ssh-known-hosts" },
    );
    ssh(
      "ssh.config",
      "SSH config for git",
      "Points git at the key and host keys with absolute paths.",
      { kind: "ssh-config" },
    );
    ssh(
      "ssh.uploaded",
      "Key added to GitHub",
      "GitHub has to know the key before git can use it.",
      { kind: "ssh-uploaded", host },
      "~2 min",
    );
    if (signing) {
      ssh(
        "ssh.signing",
        "Signed commits",
        "Your team requires signed commits.",
        { kind: "ssh-signing" },
        "~2 min",
      );
    }
  }

  // --- Agents -------------------------------------------------------------
  const providers =
    manifest === null
      ? context.knownProviders.map((provider) => ({
          id: provider.id,
          required: true,
          machines: undefined as MachineRule | undefined,
        }))
      : manifest.providers;
  for (const provider of providers) {
    const known = context.knownProviders.find((candidate) => candidate.id === provider.id);
    push({
      id: `agent:${provider.id}`,
      group: "agents",
      title: known?.displayName ?? provider.id,
      why: "Agents can't start on a machine where this isn't installed and logged in.",
      required: provider.required ?? true,
      scope: ruleOr(provider.machines, topRule),
      check: { kind: "provider", providerId: provider.id },
      estimate: "~2 min",
    });
  }

  if (manifest === null) {
    if (context.manifestBroken === true) {
      push({
        id: "core.manifest",
        group: "team",
        title: "Your team's manifest",
        why: "Lists your team's skills, tools and checks so this page can set them up.",
        required: true,
        scope: "server",
        check: { kind: "manifest" },
        estimate: "~1 min",
      });
    }
    push({
      id: "core.bb-version",
      group: "tools",
      title: "bb version",
      why: "Newer versions of bb fix bugs this checklist may run into.",
      required: false,
      scope: "server",
      check: { kind: "bb-version" },
      estimate: "~5 min",
    });
    return items;
  }

  // --- Skills -------------------------------------------------------------
  for (const skill of manifest.skills) {
    push({
      id: `skill:${skill.id}`,
      group: "skills",
      title: skill.title ?? `Team skills: ${skill.id}`,
      why: "Gives every agent on every machine your team's skills.",
      required: skill.required ?? true,
      scope: "server",
      check: { kind: "skills", entryId: skill.id },
      estimate: "~1 min",
      commands:
        skill.source === "plugin" ? [teamCommand("source", `skill:${skill.id}`, skill.install)] : [],
    });
  }

  const orphaned = context.orphanedSkills ?? [];
  if (orphaned.length > 0) {
    push({
      id: "skills.removed",
      group: "skills",
      title: "Skills your team removed",
      why: "Your team's manifest no longer lists these; they stay installed until you remove them.",
      required: true,
      scope: "server",
      check: { kind: "skills-orphaned", folders: orphaned },
      estimate: "~1 min",
    });
  }

  // --- Plugins ------------------------------------------------------------
  for (const marketplace of manifest.marketplaces) {
    push({
      id: `marketplace:${marketplace.id}`,
      group: "plugins",
      title: `Marketplace ${marketplace.id}`,
      why: "Lets bb find your team's plugins.",
      required: marketplace.required ?? true,
      scope: "server",
      check: { kind: "marketplace", entryId: marketplace.id },
      estimate: "~1 min",
      commands: [teamCommand("source", `marketplace:${marketplace.id}`, marketplace.source)],
    });
  }
  for (const plugin of manifest.plugins) {
    push({
      id: `plugin:${plugin.id}`,
      group: "plugins",
      title: plugin.title ?? plugin.id,
      why: "Your team relies on this plugin.",
      required: plugin.required ?? true,
      scope: "server",
      check: { kind: "plugin", entryId: plugin.id },
      estimate: "~2 min",
      commands: [teamCommand("source", `plugin:${plugin.id}`, plugin.install)],
    });
  }

  // --- Tools --------------------------------------------------------------
  const needsNpm =
    manifest.plugins.some((plugin) => plugin.install.startsWith("git:")) ||
    manifest.skills.some((skill) => skill.source === "plugin" && skill.install.startsWith("git:"));
  if (needsNpm && !manifest.tools.some((tool) => tool.id === "npm")) {
    push({
      id: "tool:npm",
      group: "tools",
      title: "npm on the server",
      why: "bb needs npm to install plugins from git.",
      required: true,
      scope: "server",
      check: {
        kind: "tool",
        entryId: "npm",
        bin: "npm",
        args: ["--version"],
        pattern: "(\\d+\\.\\d+(?:\\.\\d+)?)",
        min: null,
      },
      estimate: "~5 min",
    });
  }
  for (const tool of manifest.tools) {
    push({
      id: `tool:${tool.id}`,
      group: "tools",
      title: tool.title ?? tool.check.bin,
      why: tool.min === undefined ? `Your team uses ${tool.check.bin}.` : `Your team needs ${tool.check.bin} ${tool.min} or newer.`,
      required: tool.required ?? true,
      scope: ruleOr(tool.machines, topRule),
      check: {
        kind: "tool",
        entryId: tool.id,
        bin: tool.check.bin,
        args: tool.check.args,
        pattern: tool.check.pattern,
        min: tool.min ?? null,
      },
      estimate: "~5 min",
      commands: tool.install === undefined ? [] : [teamCommand("install", `tool:${tool.id}`, tool.install, null, ruleOr(tool.machines, topRule))],
    });
  }
  push({
    id: "core.bb-version",
    group: "tools",
    title: "bb version",
    why: "Newer versions of bb fix bugs this checklist may run into.",
    required: false,
    scope: "server",
    check: { kind: "bb-version" },
    estimate: "~5 min",
  });

  // --- Environment --------------------------------------------------------
  for (const env of manifest.env) {
    push({
      id: `env:${env.name}`,
      group: "env",
      title: env.name,
      why: env.note ?? "Your team's agents read this variable.",
      required: env.required ?? true,
      scope: "server",
      check: { kind: "env", name: env.name },
      estimate: "~1 min",
    });
  }

  // --- Team checks --------------------------------------------------------
  push({
    id: "core.manifest",
    group: "team",
    title: `${manifest.team.name} manifest`,
    why: "Lists your team's setup. The plugin rechecks it for changes.",
    required: true,
    scope: "server",
    check: { kind: "manifest" },
    estimate: "~1 min",
  });
  for (const check of manifest.checks) {
    const commands = [teamCommand("run", `check:${check.id}`, check.run, null, ruleOr(check.machines, topRule))];
    if (check.fix !== undefined) {
      commands.push(teamCommand("fix", `check:${check.id}`, check.fix.command, null, ruleOr(check.machines, topRule)));
    }
    push({
      id: `check:${check.id}`,
      group: "team",
      title: check.title,
      why: check.description ?? "A check your team added.",
      required: check.required ?? true,
      scope: ruleOr(check.machines, topRule),
      check: { kind: "team-check", entryId: check.id, command: check.run },
      estimate: "~2 min",
      commands,
    });
  }
  return items;
}

/** Every command in the manifest that needs approval, for the Manifest tab. */
export function allCommands(items: readonly ItemDef[]) {
  return items.flatMap((item) => item.commands.map((command) => ({ item, command })));
}
