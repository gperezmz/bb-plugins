// Which fixes an item offers on one machine, and which of them are safe.
//
// Safe fixes are idempotent, need no input and run no code the engineer has
// not approved. The complete list, also in docs/reference/team-onboarding-items.md:
//
// - `ssh-keygen`, only when no key exists;
// - writing the pinned known-hosts file;
// - writing the plugin-owned SSH config and `core.sshCommand`;
// - `gh auth setup-git`;
// - skills sync from `git`, `apm` and `registry` sources, for skills not yet
//   installed (updates are manual);
// - installing approved plugins and marketplaces.
//
// `gh ssh-key add` writes to the GitHub account, so it isn't safe. Custom
// fixes from the team are never safe.
import { makeFix, type Fix, type ItemDef, type ItemResult } from "./model.js";

export interface FixContext {
  /** Approval hashes the engineer has given. */
  approved: ReadonlySet<string>;
  /** The machine's platform from `probe`, e.g. `linux`, `darwin`. */
  platform: string | null;
  /** Whether the host entry answers on this machine. */
  hostEntry: boolean;
  isServer: boolean;
}

export const SSH_NEW_KEY_URL = "https://github.com/settings/ssh/new";
export const DEVICE_URL = "https://github.com/login/device";

/** Kinds that may be safe; `isSafe` adds the conditions. */
const SAFE_KINDS = new Set<Fix["kind"]>([
  "ssh-keygen",
  "write-known-hosts",
  "write-ssh-config",
  "gh-setup-git",
  "skills-sync",
  "plugin-install",
  "marketplace-add",
]);

/** Applies the safe-fix rules to one fix, given what the check found. */
export function isSafe(fix: Fix, item: ItemDef, result: ItemResult, context: FixContext): boolean {
  if (!SAFE_KINDS.has(fix.kind)) return false;
  if (fix.approvalHash !== null && !context.approved.has(fix.approvalHash)) return false;
  switch (fix.kind) {
    case "ssh-keygen":
      return result.facts.keyExists === false;
    case "skills-sync":
      return result.category === "not-installed" && result.facts.source !== "plugin";
    case "plugin-install":
    case "marketplace-add":
      return item.commands.every((command) => context.approved.has(command.hash));
    default:
      return true;
  }
}

function ghInstallCommand(platform: string | null): string {
  if (platform === "darwin") return "brew install gh";
  return "(command -v apt-get >/dev/null && sudo apt-get install -y gh) || (command -v dnf >/dev/null && sudo dnf install -y gh) || echo 'See https://cli.github.com for your system'";
}

/** The fixes for an item on one machine, primary first. Empty when it passes. */
export function fixesFor(item: ItemDef, result: ItemResult, context: FixContext): Fix[] {
  const fixes = computeFixes(item, result, context);
  return fixes.map((fix) => ({ ...fix, safe: isSafe(fix, item, result, context) }));
}

function computeFixes(item: ItemDef, result: ItemResult, context: FixContext): Fix[] {
  // Agents already act through a GH_TOKEN: saving gh's own login is an extra.
  if (result.status === "ok" && item.check.kind === "gh-login" && result.category === "agents-token" && result.facts.storedLogin === null) {
    return [makeFix("device-login", "Also save a gh login on this machine")];
  }
  if (result.status === "ok" || result.status === "skipped") return [];
  if (result.category === "offline") return [];
  // A background check that couldn't see enough: only a Recheck, never a write.
  if (result.category === "needs-recheck") return [];
  if (!context.hostEntry && result.category === "no-host-entry") {
    return [makeFix("check-in-terminal", "Check in terminal")];
  }
  const pending = item.commands.filter((command) => !context.approved.has(command.hash));
  const approvals = pending.map((command) =>
    makeFix("approve", "Review and approve", {
      command: command.text,
      approvalHash: command.hash,
    }),
  );
  const check = item.check;
  const facts = result.facts;
  // A file managed outside bb: only something to copy, never a write.
  if (result.category === "read-only") {
    return typeof facts.addThere === "string" ? [makeFix("copy-text", "Copy what to add", { command: facts.addThere })] : [];
  }
  switch (check.kind) {
    case "gh-installed":
      return [
        makeFix("open-terminal", "Install gh", { command: ghInstallCommand(context.platform) }),
        makeFix("open-url", "Install instructions", { url: "https://cli.github.com" }),
      ];
    case "gh-login": {
      if (result.category === "env-token") {
        return [
          makeFix("open-terminal", "Remove the GH_TOKEN variable", {
            command: "bb machine env unset GH_TOKEN",
          }),
        ];
      }
      // A login can't change a token from the environment; the detail says
      // where to change it.
      if (result.category === "env-token-invalid" || result.category === "env-token-scope") return [];
      if (result.category === "no-git-helper") {
        return [makeFix("gh-setup-git", "Set up git to use gh")];
      }
      if (result.category === "missing-scope") {
        return [makeFix("device-refresh", "Add the missing permission")];
      }
      if (result.category === "not-installed") {
        return [makeFix("open-url", "Install gh first", { url: "https://cli.github.com" })];
      }
      return [
        makeFix(
          "device-login",
          result.status === "broken" ? "Log in again" : "Log in with GitHub",
        ),
      ];
    }
    case "builtin-git":
      if (result.category === "login-name" || result.category === "not-shared") {
        return [makeFix("device-login", "Log in on this machine")];
      }
      if (result.category === "disabled") {
        return [
          makeFix("enable-builtin-git", "Turn on built-in git", {
            confirm:
              "Turns bb's built-in git back on for every machine: agents there will use the server's GitHub login.",
          }),
        ];
      }
      return [];
    case "github-mode":
      return [
        makeFix("switch-per-machine", "Switch to per-machine GitHub", {
          confirm:
            "This is a server-wide setting. bb stops sharing the server's GitHub login, credential helper, SSH-to-HTTPS rewrite and commit identity with your other machines. Agents on those machines have no GitHub access until each machine's own login is done.",
        }),
      ];
    case "repo-access":
      return [];
    case "ssh-key":
      if (facts.keyExists === true) {
        return [
          makeFix("open-terminal", "Fix the key's permissions", {
            command: typeof facts.keyPath === "string" ? `chmod 600 '${facts.keyPath}'` : null,
          }),
        ];
      }
      return [makeFix("ssh-keygen", "Create a key")];
    case "ssh-known-hosts":
      if (result.category === "rotated") {
        return [makeFix("open-url", "Check for plugin updates", { url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints" })];
      }
      return [makeFix("write-known-hosts", "Pin GitHub's host keys")];
    case "ssh-config":
      return [makeFix("write-ssh-config", "Write the SSH config")];
    case "ssh-uploaded": {
      if (facts.keyExists === false) return [];
      const out: Fix[] = [];
      if (facts.canUpload === true) out.push(makeFix("gh-ssh-key-add", "Add the key with gh"));
      out.push(makeFix("copy-public-key", "Copy key"));
      out.push(makeFix("open-url", "Open GitHub → New SSH key", { url: SSH_NEW_KEY_URL }));
      return out;
    }
    case "ssh-signing":
      return [makeFix("ssh-signing-setup", "Set up signing")];
    case "provider": {
      if (result.category === "not_installed" && facts.canInstall === true) {
        return [makeFix("provider-install", "Install")];
      }
      if (result.category === "unsupported_version" && facts.canUpdate === true) {
        return [makeFix("provider-update", "Update")];
      }
      if (result.category === "unauthenticated" || result.category === "expired") {
        if (typeof facts.loginCommand === "string") {
          return [makeFix("provider-login", "Log in", { command: facts.loginCommand })];
        }
        return [];
      }
      return [];
    }
    case "skills": {
      if (result.status === "needs-approval") return approvals;
      if (facts.source === "plugin") {
        // A bb plugin that bundles skills installs and updates as a plugin.
        if (pending.length > 0) return approvals;
        if (result.category === "update") return [makeFix("plugin-update", "Update")];
        return result.category === "not-installed" ? [makeFix("plugin-install", "Install")] : [];
      }
      switch (result.category) {
        case "not-installed":
          return [makeFix("skills-sync", "Install skills")];
        case "update":
          return [
            makeFix("skills-update", "Update", {
              confirm:
                facts.source === "registry"
                  ? "skills.sh has no versions: this removes the skill and installs it again."
                  : "Threads in progress keep the old version until their current work ends.",
            }),
            ...(Array.isArray(facts.removed) && facts.removed.length > 0
              ? [
                  makeFix("skills-remove", "Remove skills no longer listed", {
                    confirm: "Threads in progress keep it until they finish.",
                  }),
                ]
              : []),
          ];
        case "edited":
          return [
            makeFix("skills-keep-mine", "Keep my edits"),
            makeFix("skills-restore", "Restore team version", {
              confirm: "Your local edits to these skills will be replaced.",
            }),
          ];
        case "conflict":
          return [
            makeFix("skills-rename-mine", "Rename mine"),
            makeFix("skills-replace-mine", "Replace with team version", {
              confirm: "Your own skill folder with this name will be deleted.",
            }),
          ];
        default:
          return [];
      }
    }
    case "plugin":
      if (pending.length > 0) return approvals;
      if (result.category === "update") return [makeFix("plugin-update", "Update")];
      if (result.category === "settings") return [makeFix("plugin-settings", "Apply team settings")];
      return [makeFix("plugin-install", "Install")];
    case "marketplace":
      if (pending.length > 0) return approvals;
      return [makeFix("marketplace-add", "Add marketplace")];
    case "tool": {
      const out: Fix[] = [];
      const install = item.commands.find((command) => command.role === "install");
      if (install !== undefined) {
        if (!context.approved.has(install.hash)) out.push(...approvals);
        else out.push(makeFix("tool-install", "Install", { command: install.text, approvalHash: install.hash }));
      }
      if (typeof facts.hint === "string") out.push(makeFix("open-url", "How to install", { url: facts.hint }));
      return out;
    }
    case "env":
      return [makeFix("env-set", "Set value")];
    case "team-check": {
      if (result.status === "needs-approval") return approvals;
      const fix = item.commands.find((command) => command.role === "fix");
      if (fix === undefined) return [];
      if (!context.approved.has(fix.hash)) return approvals;
      const kind = facts.fixKind === "terminal" ? "team-fix-terminal" : "team-fix-run";
      return [makeFix(kind, "Fix", { command: fix.text, approvalHash: fix.hash })];
    }
    case "bb-version":
      return typeof facts.upgradeCommand === "string"
        ? [makeFix("open-terminal", "Update bb", { command: facts.upgradeCommand })]
        : [];
    case "manifest":
      return [];
    case "skills-orphaned":
      return [
        makeFix("skills-remove", "Remove them", {
          confirm: `Removes ${check.folders.join(", ")} from every machine. Threads in progress keep them until they finish.`,
        }),
      ];
  }
}
