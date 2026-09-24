// What a manifest must not be able to do.
import { describe, expect, it } from "vitest";
import { isAllowedSourceUrl } from "./netguard.js";
import { hostContract } from "../contract/host.js";
import { deriveItems } from "./items.js";
import { parseManifest } from "./manifest.js";
import { isVersionProbe } from "./probes.js";

const parse = (...lines: string[]) => parseManifest(["schema: 1", "team: { name: T }", ...lines].join("\n"));
const messages = (result: ReturnType<typeof parse>) => (result.ok ? "" : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" | "));

describe("tool checks run version probes only", () => {
  it.each([
    ["sh", ["-c", "touch /tmp/pwned"]],
    ["node", ["-e", "require('child_process')"]],
    ["sh", ["--version", "-c", "x"]],
    ["git", ["-c", "core.pager=sh"]],
    ["npx", ["version"]],
    ["npx", ["--version"]],
    ["env", []],
    ["env", ["--version"]],
    ["git", ["version"]],
    ["gh", []],
    ["pytest", ["-v"]],
    ["Sudo", ["-V"]],
    ["NPX", ["--version"]],
    ["ENV", ["--version"]],
    ["systemd-run", ["--version"]],
    ["pkexec", ["--version"]],
    ["sudo", ["-version"]],
    ["gh", ["-version"]],
  ])("rejects %s %j", (bin, args) => {
    const result = parse(`tools: [{ id: x, check: { bin: ${bin}, args: ${JSON.stringify(args)} } }]`);
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain("tools[0].check.args: a tool check runs a version flag only");
  });

  it("accepts version flags, and version subcommands for tools that use them", () => {
    for (const [bin, args] of [["gh", ["--version"]], ["python3", ["-V"]], ["java", ["-version"]], ["Java", ["-version"]], ["kubectl", ["version", "--client"]], ["go", ["version"]]] as const) {
      expect(parse(`tools: [{ id: x, check: { bin: ${bin}, args: ${JSON.stringify(args)} } }]`).ok).toBe(true);
    }
    expect(parse("tools: [{ id: x, check: { bin: gh } }]").ok).toBe(true);
    expect(isVersionProbe("sh", ["-c", "x"])).toBe(false);
  });

  it("rejects non-probe args at the host contract too", () => {
    const input = hostContract.toolVersion.input["~standard"].validate({ bin: "sh", args: ["-c", "id"], pattern: "(.*)" });
    expect("issues" in input && input.issues !== undefined).toBe(true);
  });
});

describe("links the page opens", () => {
  it("accepts https only for hint and docsUrl", () => {
    expect(messages(parse("tools: [{ id: x, check: { bin: x }, hint: 'javascript:alert(1)' }]"))).toContain("use an https:// link");
    expect(messages(parse("tools: [{ id: x, check: { bin: x }, hint: 'http://example.com' }]"))).toContain("use an https:// link");
    expect(parse("team: { name: T, docsUrl: 'data:text/html,x' }").ok).toBe(false);
    expect(parse("tools: [{ id: x, check: { bin: x }, hint: 'https://example.com/install' }]").ok).toBe(true);
  });
});

describe("other manifest limits", () => {
  it("keeps typed commands to one line", () => {
    expect(messages(parse('tools: [{ id: x, check: { bin: x }, install: "echo hi\\nid" }]'))).toContain("must be one line");
    expect(messages(parse('checks: [{ id: c, title: C, run: "true", fix: { kind: terminal, command: "a\\rb" } }]'))).toContain("must be one line");
  });

  it("keeps skills sources off internal hosts", () => {
    expect(parse("skills: [{ id: a, source: git, url: 'https://127.0.0.1:47811/x.git' }]").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: git, url: 'ssh://git@127.1/x.git' }]").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: apm, url: 'git@10.0.0.1:x/y.git' }]").ok).toBe(false);
    expect(parse("github: { host: 127.0.0.1 }").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: git, url: 'file:///srv/skills.git' }]").ok).toBe(true);
  });

  it("keeps the apm path inside the repository", () => {
    expect(parse("skills: [{ id: a, source: apm, url: 'https://example.com/r.git', path: '../../etc/passwd' }]").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: apm, url: 'https://example.com/r.git', path: '/etc/passwd' }]").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: apm, url: 'https://example.com/r.git', path: 'team/apm.yml' }]").ok).toBe(true);
  });

  it("requires a skill-name last segment for registry ids", () => {
    expect(parse("skills: [{ id: a, source: registry, registrySkillId: 'a/..' }]").ok).toBe(false);
    expect(parse("skills: [{ id: a, source: registry, registrySkillId: 'example-org/tdd' }]").ok).toBe(true);
  });

  it("asks for approval again when a check's machines widen", () => {
    const hash = (machines: string) => {
      const result = parse(`checks: [{ id: c, title: C, run: "true", machines: ${machines} }]`);
      if (!result.ok) throw new Error("fixture");
      return deriveItems(result.manifest, { knownProviders: [] }).find((item) => item.id === "check:c")!.commands[0]!.hash;
    };
    expect(hash("server")).not.toBe(hash("all"));
    expect(hash("server")).toBe(hash("server"));
  });
});

// Skills sources are the only URLs the plugin still reaches; the manifest is a
// file on the server.
describe("skills source URLs", () => {
  it.each([
    "http://example.com/setup.git",
    "https://127.0.0.1:8443/x.git",
    "https://localhost/x.git",
    "https://10.1.2.3/team/setup.git",
    "https://192.168.1.10/x.git",
    "https://169.254.169.254/latest/meta-data",
    "ssh://git@172.20.0.1/team/setup.git",
    "git@127.0.0.1:team/setup.git",
    "https://[::1]/x.git",
    "ftp://example.com/x.git",
  ])("refuses %s", (url) => {
    expect(isAllowedSourceUrl(url)).toBe(false);
  });

  it("accepts team hosts and local repositories", () => {
    expect(isAllowedSourceUrl("https://git.example.com/team/setup.git")).toBe(true);
    expect(isAllowedSourceUrl("file:///srv/repos/setup.git")).toBe(true);
    expect(isAllowedSourceUrl("git@github.com:example-org/skills.git")).toBe(true);
  });
});

describe("server-machine fallback", () => {
  it("checks host operation input like the daemon does", async () => {
    const { HostGateway } = await import("../server/gateway.js");
    const bb = {
      hosts: { experimental_client: () => ({ call: async () => { throw new Error("no host entry"); }, experimental_onSignal: () => () => {}, experimental_onWorkerExit: () => () => {} }) },
      onDispose: () => {},
      log: { warn: () => {} },
    } as never;
    const gateway = new HostGateway(bb, () => "server", () => {});
    await gateway.probe("server").catch(() => {});
    await expect(gateway.call("toolVersion", "server", { bin: "Sudo", args: ["-V"], pattern: "(.*)" })).rejects.toThrow(/invalid toolVersion input/);
  });
});
