import { describe, expect, it } from "vitest";
import { approvalHash, approvalState, pruneApprovals, teamCommand } from "./approval.js";
import { fixesFor, type FixContext } from "./fixes.js";
import { deriveItems } from "./items.js";
import { parseManifest } from "./manifest.js";
import type { Facts, ItemDef, ItemResult, Status } from "./model.js";

const manifestText = [
  "schema: 1",
  "team: { name: T }",
  "github: { mode: builtin, signing: { required: true } }",
  "ssh: {}",
  "skills:",
  "  - { id: team, source: git, url: 'https://example.com/skills.git' }",
  "  - { id: reg, source: registry, registrySkillId: example-org/tdd }",
  "  - { id: pl, source: plugin, install: 'git:https://example.com/p.git' }",
  "plugins: [{ id: p, install: 'git:https://example.com/p2.git' }]",
  "marketplaces: [{ id: m, source: 'git:https://example.com/m.git' }]",
  "tools: [{ id: node, check: { bin: node }, min: '22', install: 'brew install node' }]",
  "env: [{ name: API_KEY }]",
  "checks: [{ id: vpn, title: VPN, run: 'true', fix: { kind: run, command: 'vpn up' } }]",
].join("\n");
const parsed = parseManifest(manifestText);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const items = deriveItems(parsed.manifest, { knownProviders: [] });
const find = (id: string) => items.find((i) => i.id === id)!;

function res(item: ItemDef, status: Status, category: string, facts: Facts = {}): ItemResult {
  return { itemId: item.id, hostId: "h", status, category, checkedAt: null, detail: "", facts };
}
const ctx = (approved: string[] = []): FixContext => ({ approved: new Set(approved), platform: "linux", hostEntry: true, isServer: true });
const safeKinds = (item: ItemDef, result: ItemResult, context = ctx()) =>
  fixesFor(item, result, context).filter((fix) => fix.safe).map((fix) => fix.kind);

describe("safe fixes", () => {
  it("ssh-keygen is safe only when no key exists", () => {
    const key = find("ssh.key");
    expect(safeKinds(key, res(key, "todo", "missing", { keyExists: false }))).toEqual(["ssh-keygen"]);
    expect(safeKinds(key, res(key, "todo", "bad-mode", { keyExists: true }))).toEqual([]);
  });

  it("known hosts, SSH config and gh auth setup-git are safe", () => {
    expect(safeKinds(find("ssh.known-hosts"), res(find("ssh.known-hosts"), "todo", "missing"))).toEqual(["write-known-hosts"]);
    expect(safeKinds(find("ssh.config"), res(find("ssh.config"), "todo", "missing"))).toEqual(["write-ssh-config"]);
    const login = find("github.login");
    expect(safeKinds(login, res(login, "todo", "no-git-helper"))).toEqual(["gh-setup-git"]);
  });

  it("gh ssh-key add writes to the GitHub account, so it isn't safe", () => {
    const up = find("ssh.uploaded");
    const fixes = fixesFor(up, res(up, "todo", "not-uploaded", { keyExists: true, canUpload: true }), ctx());
    expect(fixes.map((f) => f.kind)).toEqual(["gh-ssh-key-add", "copy-public-key", "open-url"]);
    expect(fixes.some((f) => f.safe)).toBe(false);
  });

  it("offers Copy key and the GitHub page when gh can't upload", () => {
    const up = find("ssh.uploaded");
    const kinds = fixesFor(up, res(up, "todo", "not-uploaded", { keyExists: true, canUpload: false }), ctx()).map((f) => f.kind);
    expect(kinds).toEqual(["copy-public-key", "open-url"]);
  });

  it("skills sync is safe for new installs from git and registry, not for updates or plugins", () => {
    const team = find("skill:team");
    expect(safeKinds(team, res(team, "todo", "not-installed", { source: "git" }))).toEqual(["skills-sync"]);
    expect(safeKinds(team, res(team, "update", "update", { source: "git" }))).toEqual([]);
    const reg = find("skill:reg");
    expect(safeKinds(reg, res(reg, "todo", "not-installed", { source: "registry" }))).toEqual(["skills-sync"]);
  });

  it("installing a plugin or marketplace is safe only once approved", () => {
    const plugin = find("plugin:p");
    const pending = fixesFor(plugin, res(plugin, "needs-approval", "needs-approval"), ctx());
    expect(pending.map((f) => f.kind)).toEqual(["approve"]);
    expect(pending[0]!.command).toBe("git:https://example.com/p2.git");
    const hash = plugin.commands[0]!.hash;
    expect(safeKinds(plugin, res(plugin, "todo", "not-installed"), ctx([hash]))).toEqual(["plugin-install"]);
    const market = find("marketplace:m");
    expect(safeKinds(market, res(market, "todo", "not-installed"), ctx([market.commands[0]!.hash]))).toEqual(["marketplace-add"]);
  });

  it("custom team fixes and tool installs are never safe", () => {
    const check = find("check:vpn");
    const approved = check.commands.map((c) => c.hash);
    const fixes = fixesFor(check, res(check, "todo", "failed", { fixKind: "run" }), ctx(approved));
    expect(fixes.map((f) => f.kind)).toEqual(["team-fix-run"]);
    expect(fixes[0]!.safe).toBe(false);
    const node = find("tool:node");
    const tool = fixesFor(node, res(node, "todo", "too-old"), ctx(node.commands.map((c) => c.hash)));
    expect(tool.map((f) => f.kind)).toEqual(["tool-install"]);
    expect(tool[0]!.safe).toBe(false);
  });

  it("an unapproved tool install asks for approval first", () => {
    const node = find("tool:node");
    const fixes = fixesFor(node, res(node, "todo", "not-installed"), ctx());
    expect(fixes[0]).toMatchObject({ kind: "approve", command: "brew install node" });
  });

  it("switching to per-machine GitHub needs confirmation", () => {
    const perMachine = parseManifest("schema: 1\nteam: { name: T }\ngithub: { mode: per-machine }\n");
    if (!perMachine.ok) throw new Error("fixture");
    const mode = deriveItems(perMachine.manifest, { knownProviders: [] }).find((i) => i.id === "github.mode")!;
    const [fix] = fixesFor(mode, res(mode, "todo", "builtin"), ctx());
    expect(fix!.kind).toBe("switch-per-machine");
    expect(fix!.confirm).toContain("server-wide");
  });

  it("a GH_TOKEN login points at the machine variable, not a login", () => {
    const login = find("github.login");
    const fixes = fixesFor(login, res(login, "broken", "env-token"), ctx());
    expect(fixes[0]!.command).toBe("bb machine env unset GH_TOKEN");
  });

  it("a missing scope offers the refresh flow", () => {
    const login = find("github.login");
    expect(fixesFor(login, res(login, "broken", "missing-scope"), ctx())[0]!.kind).toBe("device-refresh");
  });

  it("offers Check in terminal when the host entry is missing", () => {
    const node = find("tool:node");
    const fixes = fixesFor(node, res(node, "unknown", "no-host-entry"), { ...ctx(), hostEntry: false });
    expect(fixes.map((f) => f.kind)).toEqual(["check-in-terminal"]);
  });

  it("offers nothing for ok, skipped and offline", () => {
    const node = find("tool:node");
    expect(fixesFor(node, res(node, "ok", "ok"), ctx())).toEqual([]);
    expect(fixesFor(node, res(node, "skipped", "out-of-scope"), ctx())).toEqual([]);
    expect(fixesFor(node, res(node, "unknown", "offline"), ctx())).toEqual([]);
  });
});

describe("approvals", () => {
  it("hashes id, text and ref, so a changed command needs approval again", () => {
    const a = approvalHash({ id: "check:vpn#run", text: "curl a", ref: null });
    expect(a).toBe(approvalHash({ id: "check:vpn#run", text: "curl a", ref: null }));
    expect(a).not.toBe(approvalHash({ id: "check:vpn#run", text: "curl b", ref: null }));
    expect(a).not.toBe(approvalHash({ id: "check:vpn#run", text: "curl a", ref: "v2" }));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  // Acceptance 9: a changed team check command needs approval again.
  it("keeps unchanged approvals and drops approvals of changed commands", () => {
    const before = teamCommand("run", "check:vpn", "curl -sf https://a");
    const after = teamCommand("run", "check:vpn", "curl -sf https://b");
    const records = [{ hash: before.hash, itemId: "check:vpn", role: "run" as const, text: before.text, approvedAt: "" }];
    expect(pruneApprovals(records, [after])).toEqual([]);
    expect(pruneApprovals(records, [before])).toHaveLength(1);
    expect(approvalState([after], new Set([before.hash])).pending).toEqual([after]);
  });

  it("gives each part of an item its own approval", () => {
    const check = find("check:vpn");
    expect(check.commands.map((c) => c.role)).toEqual(["run", "fix"]);
    expect(new Set(check.commands.map((c) => c.hash)).size).toBe(2);
  });
});

describe("GitHub on real setups", () => {
  it("offers gh's own login as an extra only while agents act through a GH_TOKEN and nothing is stored", () => {
    const login = find("github.login");
    const extra = fixesFor(login, res(login, "ok", "agents-token", { storedLogin: null }), ctx());
    expect(extra.map((fix) => [fix.kind, fix.safe])).toEqual([["device-login", false]]);
    expect(fixesFor(login, res(login, "ok", "agents-token", { storedLogin: "octo" }), ctx())).toEqual([]);
    expect(fixesFor(login, res(login, "ok", "ok"), ctx())).toEqual([]);
  });

  it("gives a read-only target something to copy, and nothing that writes", () => {
    const config = find("ssh.config");
    const fixes = fixesFor(config, res(config, "todo", "read-only", { addThere: "[core]\n\tsshCommand = ssh -F '/h/.ssh/bb_config'" }), ctx());
    expect(fixes.map((fix) => [fix.kind, fix.command, fix.safe])).toEqual([["copy-text", "[core]\n\tsshCommand = ssh -F '/h/.ssh/bb_config'", false]]);
  });
});

describe("review follow-ups", () => {
  it("offers no login for a GH_TOKEN a login can't change", () => {
    const login = find("github.login");
    expect(fixesFor(login, res(login, "todo", "env-token-invalid"), ctx())).toEqual([]);
    expect(fixesFor(login, res(login, "todo", "env-token-scope"), ctx())).toEqual([]);
  });

  it("never offers a write, safe or not, for a read-only target", () => {
    const key = find("ssh.key");
    expect(fixesFor(key, res(key, "todo", "read-only", { keyExists: false }), ctx())).toEqual([]);
    const withCommand = fixesFor(key, res(key, "todo", "read-only", { keyExists: false, addThere: "ssh-keygen -t ed25519 -f '/h/.ssh/bb_ed25519'" }), ctx());
    expect(withCommand.map((fix) => [fix.kind, fix.safe])).toEqual([["copy-text", false]]);
    const hosts = find("ssh.known-hosts");
    expect(safeKinds(hosts, res(hosts, "todo", "read-only", { addThere: "github.com ssh-ed25519 AAAA" }))).toEqual([]);
  });
});
