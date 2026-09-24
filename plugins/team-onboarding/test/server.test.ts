// Server behaviour against a fake bb: the acceptance scenarios that can run
// without GitHub, a real remote machine or a browser.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OnboardingState } from "../src/contract/rpc.js";
import plugin from "../server.js";
import { since, snapshot } from "../src/server/meter.js";
import { boot, makeWorld, REMOTE, repos, SERVER, skillMd, until, type World } from "./fixture.js";

let world: World;
afterEach(() => world?.cleanup());

type Harness = Awaited<ReturnType<typeof boot>>["harness"];

const state = (harness: Harness) => harness.behavior.callRpc("state", null) as Promise<OnboardingState>;
const check = (harness: Harness, itemId?: string) => harness.behavior.runCli(itemId === undefined ? ["check"] : ["check", itemId]);
const item = (s: OnboardingState, id: string) => {
  const found = s.items.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no item ${id}; have ${s.items.map((i) => i.id).join(", ")}`);
  return found;
};
const on = (s: OnboardingState, id: string, hostId: string) => item(s, id).results.find((r) => r.hostId === hostId)!;
/** The headers a browser sets on a same-origin fetch from the bb page. */
const BROWSER = { "content-type": "application/json", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
/** An action from the Onboarding page; throws with the route's message when it fails. */
async function act(harness: Harness, body: Record<string, unknown>, headers: Record<string, string> = BROWSER) {
  const response = await harness.behavior.fetchHttp("POST", "/actions", { headers, body: JSON.stringify(body) });
  const out = (await response.json()) as { ok: boolean; message: string | null; terminal?: { hostId: string; terminalId: string } | null; loginId?: string };
  if (response.status !== 200) throw new Error(`${response.status} ${out.message}`);
  return out;
}
const approve = (harness: Harness, hash: string) => act(harness, { action: "approve", hash });
const fix = (harness: Harness, itemId: string, hostId: string, kind: string, confirmed = false) =>
  act(harness, { action: "runFix", itemId, hostId, kind, confirmed });

/** Where the plugin reads the manifest by default: `<bb data dir>/team-onboarding/onboarding.yaml`. */
const manifestFile = (world: World) => join(world.dataDir, "team-onboarding", "onboarding.yaml");

function manifestText(lines: string[]): string {
  return ["schema: 1", "team: { name: Example Platform }", ...lines].join("\n");
}

/** Provisions the manifest file, as an admin or a bootstrap script would. */
function writeManifest(world: World, lines: string[]) {
  mkdirSync(join(world.dataDir, "team-onboarding"), { recursive: true });
  writeFileSync(manifestFile(world), manifestText(lines));
}

function skillsSource(world: World, skills: Record<string, string>) {
  const { skills: repo } = repos(world);
  for (const [name, body] of Object.entries(skills)) repo.write(`skills/${name}/SKILL.md`, body);
  repo.commit();
}

/** Every table of the plugin's database and every kv value but the cached manifest. */
async function everythingStored(bb: Awaited<ReturnType<typeof boot>>["bb"]): Promise<string> {
  const db = bb.storage.database();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const rows = tables.map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all());
  const keys = (await bb.storage.kv.list()).filter((key) => key !== "manifest");
  const kv = await Promise.all(keys.map(async (key) => [key, await bb.storage.kv.get(key)]));
  return JSON.stringify({ rows, kv });
}


describe("no manifest yet", () => {
  // Acceptance 1: the built-in core, grey rows, and where the file goes.
  it("runs the built-in core and says where the manifest goes; rows are grey todo", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    expect(harness.inspection.needsConfigurationMessages).toEqual([]);
    await check(harness);
    const s = await state(harness);
    expect(s.manifest).toMatchObject({ status: "none", path: manifestFile(world) });
    expect(s.items.map((i) => i.id)).toEqual([
      "github.gh-installed",
      "github.login",
      "github.builtin-git",
      "agent:claude-code",
      "core.bb-version",
    ]);
    expect(item(s, "github.gh-installed").status).toBe("ok");
    expect(item(s, "github.login").status).toBe("todo");
    expect(s.items.some((i) => i.status === "broken")).toBe(false);
    // No manifest isn't a step: it doesn't count.
    expect(s.badge).toEqual({ kind: "count", count: 2 });
    expect(s.nextStep?.itemId).toBe("github.login");
    expect(await harness.behavior.callRpc("manifestFile", null)).toEqual({ path: manifestFile(world), exists: false, sha: null, mtime: null, issues: [] });
    const where = await harness.behavior.runCli(["manifest", "path"]);
    expect(where.stdout).toBe(`${manifestFile(world)} (not there yet)`);
  });
});

describe("no manifest at all", () => {
  // No manifest doesn't apply rather than fails: the built-in checks alone
  // can be all set, with no badge and no nag on the home page.
  it("is all set when the built-in checks pass", async () => {
    world = makeWorld();
    world.builtInGit = "logged in";
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "github.login", SERVER, "device-login");
    await until(async () => (await state(harness)).deviceLogin?.state === "done");
    await check(harness);
    const s = await state(harness);
    expect(s.items.some((i) => i.id === "core.manifest" || i.group === "team")).toBe(false);
    expect(s.progress.done).toBe(s.progress.total);
    expect(s.badge).toEqual({ kind: "done" });
    expect(s.nextStep).toBeNull();
    expect(s.homeLine).toMatch(/^All set/);
    const summary = (await harness.behavior.callRpc("summary", null)) as { hasBlocking: boolean; hasUpdates: boolean; homeLine: string };
    expect(summary).toMatchObject({ hasBlocking: false, hasUpdates: false });
    expect(summary.homeLine).toMatch(/^All set/);
  });
});

describe("a manifest arriving later", () => {
  it("adds its items when the file appears, with no Recheck", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    await check(harness);
    expect((await state(harness)).items.some((i) => i.group === "team")).toBe(false);
    // The plugin made its folder, so it is watching before the first install.
    writeManifest(world, ["checks: [{ id: vpn, title: VPN, run: 'true', machines: server }]"]);
    const s = await until(async () => {
      const next = await state(harness);
      return next.items.some((i) => i.id === "check:vpn") ? next : null;
    });
    expect(s.manifest).toMatchObject({ status: "ok", teamName: "Example Platform" });
    expect(s.items.some((i) => i.id === "core.manifest")).toBe(true);
  });

  it("says in the CLI when the manifest file can't be used", async () => {
    world = makeWorld();
    mkdirSync(join(world.dataDir, "team-onboarding"), { recursive: true });
    writeFileSync(manifestFile(world), "schema: 1\nteam: {}\n");
    const { harness } = await boot(world);
    await check(harness);
    const out = await harness.behavior.runCli(["status"]);
    expect(out.stdout.split("\n")[0]).toMatch(/^Manifest file can't be used · /);
    expect(out.stdout).toContain("core.manifest");
    // With a last good manifest, the header says the list is from it.
    writeManifest(world, []);
    await check(harness);
    writeFileSync(manifestFile(world), "schema: 1\nteam: {}\n");
    await check(harness);
    const again = await harness.behavior.runCli(["status"]);
    expect(again.stdout.split("\n")[0]).toMatch(/^Example Platform \(manifest file can't be used; showing the last good one\) · /);
  });
});

describe("the manifest file", () => {
  it("loads a valid file and reports its hash", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(s.manifest).toMatchObject({ status: "ok", teamName: "Example Platform", path: manifestFile(world) });
    const info = (await harness.behavior.callRpc("manifestFile", null)) as { exists: boolean; sha: string; issues: string[] };
    expect(info).toMatchObject({ exists: true, issues: [] });
    expect(info.sha).toBe(createHash("sha256").update(readFileSync(manifestFile(world))).digest("hex"));
    expect(s.manifest.version).toBe(info.sha);
  });

  it("shows validation errors with their line, and keeps the last good manifest", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const { harness } = await boot(world);
    await check(harness);
    writeFileSync(manifestFile(world), manifestText(["tools:", "  - { id: node, check: 'node --version' }"]));
    await check(harness);
    const s = await state(harness);
    expect(s.manifest).toMatchObject({ status: "error", teamName: "Example Platform" });
    expect(s.items.some((i) => i.id === "tool:node")).toBe(true);
    const info = (await harness.behavior.callRpc("manifestFile", null)) as { issues: string[] };
    expect(info.issues[0]).toMatch(/^line 4: /);
  });

  it("starts with an invalid file as an error, not a list", async () => {
    world = makeWorld();
    mkdirSync(join(world.dataDir, "team-onboarding"), { recursive: true });
    writeFileSync(manifestFile(world), "schema: 1\nteam: {}\n");
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(s.manifest).toMatchObject({ status: "error", teamName: null });
    // A file that is there and can't be used is a real problem.
    expect(on(s, "core.manifest", SERVER)).toMatchObject({ category: "invalid", status: "broken" });
    expect(s.nextStep?.itemId).toBe("github.login");
    expect(s.badge).toMatchObject({ kind: "count" });
  });

  it("reloads by itself when the file changes, and asks again for a changed command", async () => {
    world = makeWorld();
    writeManifest(world, ["checks: [{ id: vpn, title: VPN, run: 'true', machines: server }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const first = item(await state(harness), "check:vpn").commands[0]!;
    await approve(harness, first.hash);
    // No Recheck: the plugin watches the file.
    writeManifest(world, ["checks: [{ id: vpn, title: VPN, run: 'exit 0', machines: server }]"]);
    const changed = await until(async () => {
      const s = await state(harness);
      const command = s.items.find((i) => i.id === "check:vpn")?.commands[0];
      return command !== undefined && command.hash !== first.hash ? command : null;
    });
    expect(changed.approved).toBe(false);
    expect(changed.text).toBe("exit 0");
  });

  it("reads a custom path, but only a file called onboarding.yaml", async () => {
    world = makeWorld();
    const custom = join(world.root, "provisioned", "onboarding.yaml");
    mkdirSync(join(world.root, "provisioned"));
    writeFileSync(custom, manifestText(["tools: [{ id: git, check: { bin: git } }]"]));
    const { harness } = await boot(world, { manifestFile: custom });
    await check(harness);
    expect((await state(harness)).manifest).toMatchObject({ status: "ok", path: custom });
    for (const bad of ["relative/onboarding.yaml", "/etc/passwd", `${world.root}/secrets.yml`, `${world.root}/../x/onboarding.yaml`, `${world.root}/onboarding.yaml/`]) {
      await expect(harness.behavior.setSettings({ manifestFile: bad })).rejects.toThrow();
    }
  });

  // The name rule holds through symlinks: one named onboarding.yaml that
  // points at another file is refused, and nothing of that file shows.
  it("follows a symlink only to another onboarding.yaml", async () => {
    world = makeWorld();
    const secret = join(world.root, "secrets.yml");
    writeFileSync(secret, "sk_leak_value: 12345\n");
    mkdirSync(join(world.dataDir, "team-onboarding"), { recursive: true });
    symlinkSync(secret, manifestFile(world));
    const { harness } = await boot(world);
    await check(harness);
    const info = (await harness.behavior.callRpc("manifestFile", null)) as { issues: string[]; sha: string | null };
    expect(info.issues[0]).toContain("symlink to a file that isn't called onboarding.yaml");
    expect(info.sha).toBeNull();
    expect(JSON.stringify(await state(harness))).not.toContain("sk_leak_value");
    rmSync(manifestFile(world));
    const real = join(world.root, "managed", "onboarding.yaml");
    mkdirSync(join(world.root, "managed"));
    writeFileSync(real, manifestText([]));
    symlinkSync(real, manifestFile(world));
    await check(harness);
    expect((await state(harness)).manifest.status).toBe("ok");
  });

  it("reruns the checks only when the file's content changes", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const probes = () => world.hostCalls.filter((call) => call.method === "toolVersion").length;
    const before = probes();
    utimesSync(manifestFile(world), new Date(), new Date());
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(probes()).toBe(before);
    writeManifest(world, ["tools: [{ id: git, check: { bin: git } }]"]);
    await until(async () => (await state(harness)).items.some((i) => i.id === "tool:git"));
  });

  it("reruns nothing on a touch or a tick while the file stays invalid", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const { harness } = await boot(world);
    await check(harness);
    writeFileSync(manifestFile(world), "schema: 1\nteam: [unclosed\n");
    await until(async () => (await state(harness)).manifest.status === "error");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const probes = () => world.hostCalls.filter((call) => call.method === "toolVersion").length;
    const before = probes();
    utimesSync(manifestFile(world), new Date(), new Date());
    await new Promise((resolve) => setTimeout(resolve, 900));
    await harness.behavior.runSchedule("checks");
    expect(probes()).toBe(before);
  });

  it("refuses a hard link, which would sidestep the name rule too", async () => {
    world = makeWorld();
    const secret = join(world.root, "secrets.yml");
    writeFileSync(secret, "sk_leak_value: 12345\n");
    mkdirSync(join(world.dataDir, "team-onboarding"), { recursive: true });
    linkSync(secret, manifestFile(world));
    const { harness } = await boot(world);
    await check(harness);
    const info = (await harness.behavior.callRpc("manifestFile", null)) as { issues: string[]; sha: string | null };
    expect(info.issues[0]).toContain("other hard links");
    expect(info.sha).toBeNull();
    expect(JSON.stringify(await state(harness))).not.toContain("sk_leak_value");
  });

  it("notices a new file on a scheduled tick when there was no folder to watch", async () => {
    world = makeWorld();
    const custom = join(world.root, "later", "onboarding.yaml");
    const { harness } = await boot(world, { manifestFile: custom });
    await check(harness);
    expect((await state(harness)).manifest.status).toBe("none");
    mkdirSync(join(world.root, "later"));
    writeFileSync(custom, manifestText([]));
    await harness.behavior.runSchedule("checks");
    expect((await state(harness)).manifest).toMatchObject({ status: "ok", path: custom });
  });

  it("installs through a custom path's symlinked folder, and never through a symlinked file", async () => {
    world = makeWorld();
    const realDir = join(world.root, "real-dir");
    mkdirSync(realDir);
    symlinkSync(realDir, join(world.root, "linked-dir"));
    const custom = join(world.root, "linked-dir", "onboarding.yaml");
    const { harness } = await boot(world, { manifestFile: custom });
    const source = join(world.root, "incoming.yaml");
    writeFileSync(source, manifestText([]));
    expect((await harness.behavior.runCli(["manifest", "install", source, "--machine", "server"])).exitCode).toBe(0);
    expect(existsSync(join(realDir, "onboarding.yaml"))).toBe(true);
    rmSync(join(realDir, "onboarding.yaml"));
    const victim = join(world.root, "victim.txt");
    writeFileSync(victim, "keep me\n");
    symlinkSync(victim, join(realDir, "onboarding.yaml"));
    const refused = await harness.behavior.runCli(["manifest", "install", source, "--machine", "server"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("symlink");
    expect(readFileSync(victim, "utf8")).toBe("keep me\n");
  });

  it("installs a manifest atomically, and leaves the old file when the new one is invalid", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    await check(harness);
    const source = join(world.root, "incoming.yaml");
    writeFileSync(source, manifestText(["tools: [{ id: node, check: { bin: node } }]"]));
    const out = await harness.behavior.runCli(["manifest", "install", source, "--machine", "server"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`Installed Example Platform`);
    expect(out.stdout).toContain(manifestFile(world));
    expect(statSync(manifestFile(world)).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(world.dataDir, "team-onboarding"))).toEqual(["onboarding.yaml"]);
    const installed = readFileSync(manifestFile(world), "utf8");
    expect((await state(harness)).manifest).toMatchObject({ status: "ok", teamName: "Example Platform" });
    writeFileSync(source, manifestText(["tools: [{ id: node, check: 'node --version' }]"]));
    const refused = await harness.behavior.runCli(["manifest", "install", source, "--machine", "server"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("nothing was written");
    expect(readFileSync(manifestFile(world), "utf8")).toBe(installed);
    expect(readdirSync(join(world.dataDir, "team-onboarding"))).toEqual(["onboarding.yaml"]);
  });

  it("never fetches a manifest over the network", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      const { harness } = await boot(world);
      await check(harness);
      await harness.behavior.callRpc("manifestFile", null);
      expect((await state(harness)).manifest.status).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
    // GitHub's published SSH keys are the only thing the plugin fetches itself.
    expect(calls.filter((url) => url !== "https://api.github.com/meta")).toEqual([]);
    expect(world.hostCalls.filter((call) => call.method === "lsRemote")).toEqual([]);
    for (const file of ["../src/server/engine.ts", "../server.ts"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).not.toMatch(/manifest-fetch|manifestUrl|githubToken/);
    }
  });

  it("prints team commands redacted in the CLI", async () => {
    world = makeWorld();
    writeManifest(world, ["checks: [{ id: leaky, title: Leaky, run: 'echo GH_TOKEN=fakesecret123 https://u:pw@example.com/x', machines: server }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const out = await harness.behavior.runCli(["fix", "check:leaky", "--machine", "server"]);
    expect(out.stdout).toContain("manual: Review and approve");
    expect(out.stdout).not.toContain("fakesecret123");
    expect(out.stdout).not.toContain("u:pw@");
  });

  it("forgets vanished skills and the cached manifest when the file is removed", async () => {
    world = makeWorld();
    skillsSource(world, { alpha: skillMd("alpha") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    const { bb, harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:team", SERVER, "skills-sync");
    rmSync(join(world.dataDir, "skills", "alpha"), { recursive: true });
    rmSync(manifestFile(world));
    await check(harness);
    const db = bb.storage.database();
    expect((db.prepare("SELECT count(*) AS c FROM skill_owners").get() as { c: number }).c).toBe(0);
    expect(await bb.storage.kv.get("manifest")).toBeUndefined();
    expect((await bb.storage.kv.list()).filter((key) => key.startsWith("skill-source:"))).toEqual([]);
    const s = await state(harness);
    expect(s.manifest.status).toBe("none");
    // Back to not applying: no manifest item, no team group.
    expect(s.items.some((i) => i.id === "core.manifest" || i.group === "team" || i.group === "skills")).toBe(false);
  });
});

describe("an internal github.host", () => {
  it("is never connected to", async () => {
    const { lookup } = await import("node:dns/promises");
    const { hostname } = await import("node:os");
    const { isInternalHost } = await import("../src/core/netguard.js");
    const name = hostname();
    const addresses = await lookup(name, { all: true }).catch(() => []);
    if (addresses.length === 0 || !addresses.some((entry) => isInternalHost(entry.address))) return; // needs a locally resolving name
    world = makeWorld();
    writeManifest(world, [`github: { host: ${name}, access: [{ id: r, repo: a/b }] }`, "ssh: {}"]);
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "github.access:r", SERVER).category).toBe("blocked");
    expect(on(s, "ssh.uploaded", SERVER).category).toBe("blocked");
    expect(world.hostCalls.filter((call) => ["sshTest", "lsRemote", "ghApiRepo"].includes(call.method))).toEqual([]);
  });
});

describe("tool output", () => {
  it("keeps only a version number, whatever the pattern captures", async () => {
    world = makeWorld();
    writeManifest(world, ['tools: [{ id: node, check: { bin: node, args: ["--version"], pattern: "(.*)" } }]']);
    const { bb, harness } = await boot(world);
    await check(harness);
    const result = on(await state(harness), "tool:node", SERVER);
    expect(result.detail).toMatch(/^node \d+\.\d+\.\d+\.$/);
    expect(result.facts.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.stringify(bb.storage.database().prepare("SELECT json FROM results").all())).not.toContain("node v");
  });
});

describe("GitHub login", () => {
  // Acceptance 2: the device code reaches the UI and the item turns green
  // without Recheck; gh auth setup-git ran.
  it("shows a one-time code and turns green by itself", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    await check(harness);
    const out = (await fix(harness, "github.login", SERVER, "device-login")) as { loginId: string };
    expect(out.loginId).toMatch(/[0-9a-f-]{36}/);
    const device = await until(async () =>
      harness.inspection.realtimeSignals.find((signal) => signal.channel === "team-onboarding.device"),
    );
    expect(device.payload).toMatchObject({ code: "WXYZ-1234", url: "https://github.com/login/device" });
    const done = await until(async () => {
      const s = await state(harness);
      return item(s, "github.login").status === "ok" ? s : null;
    });
    expect(on(done, "github.login", SERVER).facts.login).toBe("octo");
    expect(done.account.login).toBe("octo");
    expect(readFileSync(join(world.homes[SERVER]!, ".gitconfig"), "utf8")).toContain("auth git-credential");
    const log = readFileSync(join(world.root, "gh.log"), "utf8");
    expect(log).toContain("--insecure-storage");
  });
});

describe("GitHub on real setups", () => {
  const deviceDone = (harness: Harness) =>
    until(async () => {
      const s = await state(harness);
      return s.deviceLogin?.state === "done" || s.deviceLogin?.state === "failed" ? s : null;
    });

  // gh saved the token, then exited 1 on a read-only config.yml.
  it("reports a saved login as done, with gh's complaint as a note", async () => {
    world = makeWorld();
    writeFileSync(join(world.root, "login-save-exit1"), "");
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "github.login", SERVER, "device-login");
    const s = await deviceDone(harness);
    expect(s.deviceLogin).toMatchObject({ state: "done" });
    expect(s.deviceLogin!.message).toContain("as @octo");
    expect(s.deviceLogin!.message).toContain("gh couldn't save its settings file");
    expect(item(s, "github.login").status).toBe("ok");
    // The code travels apart from the login's result; a late one changes nothing.
    await harness.behavior.experimental_emitHostSignal(SERVER, "deviceCode", { loginId: s.deviceLogin!.loginId, code: "LATE-CODE", url: "https://github.com/login/device" });
    expect((await state(harness)).deviceLogin).toMatchObject({ state: "done", code: "WXYZ-1234" });
  });

  it("is done when agents get a working GH_TOKEN, and offers gh's own login as an extra", async () => {
    world = makeWorld();
    world.agentsEnv[SERVER] = { GH_TOKEN: "tok-token-user" };
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    const result = on(s, "github.login", SERVER);
    expect(result).toMatchObject({ status: "ok", category: "agents-token" });
    expect(result.detail).toBe("Agents use a token from GH_TOKEN (@token-user).");
    expect(s.account.login).toBe("token-user");
    const extra = item(s, "github.login").fixes.find((entry) => entry.hostId === SERVER)!.fixes;
    expect(extra.map((f) => [f.kind, f.label, f.safe])).toEqual([["device-login", "Also save a gh login on this machine", false]]);
    // Saving a login for a different account says who agents still act as.
    await fix(harness, "github.login", SERVER, "device-login");
    s = await deviceDone(harness);
    expect(s.deviceLogin!.message).toContain("as @octo");
    expect(s.deviceLogin!.message).toContain("Agents still act as @token-user: GH_TOKEN takes precedence while it is set.");
    expect(on(s, "github.login", SERVER).detail).toContain("different account, @octo");
    expect(item(s, "github.login").fixes).toEqual([]);
  });

  it("fails on a GH_TOKEN GitHub rejects, and without one asks for a login", async () => {
    world = makeWorld();
    world.agentsEnv[SERVER] = { GH_TOKEN: "bad" };
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "github.login", SERVER)).toMatchObject({ status: "todo", category: "env-token-invalid" });
    expect(item(s, "github.login").fixes).toEqual([]);
    // GitHub unreachable is not a rejected token.
    world.agentsEnv[SERVER] = { GH_TOKEN: "unreachable" };
    await check(harness, "github.login");
    s = await state(harness);
    expect(on(s, "github.login", SERVER)).toMatchObject({ status: "unknown", category: "network" });
    delete world.agentsEnv[SERVER];
    await check(harness, "github.login");
    expect(on(await state(harness), "github.login", SERVER)).toMatchObject({ status: "todo", category: "not-logged-in" });
  });

  // bb 0.43.4 shares nothing when the server's login has an underscore.
  it("says why bb's built-in git shares nothing, and offers a login on that machine", async () => {
    world = makeWorld();
    world.agentsEnv[SERVER] = { GH_TOKEN: "tok-name_emu" };
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "github.builtin-git", SERVER).status).toBe("ok");
    const remote = on(s, "github.builtin-git", REMOTE);
    expect(remote).toMatchObject({ status: "todo", category: "login-name" });
    expect(remote.detail).toContain("@name_emu has an underscore");
    expect(item(s, "github.builtin-git").fixes).toEqual([
      { hostId: REMOTE, fixes: [expect.objectContaining({ kind: "device-login", label: "Log in on this machine" })] },
    ]);
    // A token the remote's agents get counts.
    world.agentsEnv[REMOTE] = { GH_TOKEN: "tok-remote-user" };
    await check(harness, "github.builtin-git");
    s = await state(harness);
    expect(on(s, "github.builtin-git", REMOTE)).toMatchObject({ status: "ok" });
    expect(on(s, "github.builtin-git", REMOTE).detail).toContain("as @remote-user with this machine's own GH_TOKEN.");
    // bb sharing the login is enough everywhere.
    world.builtInGit = "logged in";
    delete world.agentsEnv[REMOTE];
    await check(harness, "github.builtin-git");
    expect(item(await state(harness), "github.builtin-git").status).toBe("ok");
  });

  it("logs a remote in when bb can't share the server's login", async () => {
    world = makeWorld();
    world.agentsEnv[SERVER] = { GH_TOKEN: "tok-name_emu" };
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "github.builtin-git", REMOTE, "device-login");
    const s = await deviceDone(harness);
    expect(s.deviceLogin).toMatchObject({ state: "done", hostId: REMOTE });
    expect(s.deviceLogin!.message).toContain("Logged in on laptop as @octo.");
    const after = await until(async () => {
      const next = await state(harness);
      return on(next, "github.builtin-git", REMOTE).status === "ok" ? next : null;
    });
    expect(on(after, "github.builtin-git", REMOTE).detail).toContain("as @octo with this machine's own gh login.");
  });

  // home-manager: the global git config is a read-only link into the store.
  it("shows what to add to a read-only git config instead of failing", async () => {
    world = makeWorld();
    writeManifest(world, ["ssh: {}"]);
    const home = world.homes[SERVER]!;
    const store = join(world.root, "nix-store");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "gitconfig"), "[user]\n\tname = Someone\n");
    chmodSync(join(store, "gitconfig"), 0o444);
    mkdirSync(join(home, ".config", "git"), { recursive: true });
    symlinkSync(join(store, "gitconfig"), join(home, ".config", "git", "config"));
    const { harness } = await boot(world);
    await check(harness);
    const out = await fix(harness, "ssh.config", SERVER, "write-ssh-config");
    expect(out).toMatchObject({ ok: false });
    expect(out.message).toBe(`Managed outside bb: ${join(home, ".config", "git", "config")} is read-only. The item shows what to add there.`);
    const s = await state(harness);
    const result = on(s, "ssh.config", SERVER);
    expect(result).toMatchObject({ category: "read-only" });
    expect(result.detail).toBe("Managed outside bb: ~/.config/git/config is read-only. Add the lines below where you manage it.");
    expect(result.facts.addThere).toBe(`[core]\n\tsshCommand = ssh -F '${join(home, ".ssh", "bb_config")}'`);
    expect(item(s, "ssh.config").fixes[0]!.fixes.map((f) => f.kind)).toEqual(["copy-text"]);
    expect(readFileSync(join(store, "gitconfig"), "utf8")).toBe("[user]\n\tname = Someone\n");
  });
});

describe("repository access without keychain prompts", () => {
  it("takes gh's answer on a schedule and lets git ask its helpers only on Recheck", async () => {
    world = makeWorld();
    writeFileSync(join(world.root, "api-ok"), "");
    writeManifest(world, ["github:", "  access:", "    - { id: platform, repo: example-org/private-repo, machines: all }"]);
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    for (const host of [SERVER, REMOTE]) {
      expect(on(s, "github.access:platform", host)).toMatchObject({ status: "ok", facts: { checkedWith: "gh" } });
    }
    const lsCalls = () => world.hostCalls.filter((call) => call.method === "lsRemote" && JSON.stringify(call.input).includes("private-repo"));
    expect(lsCalls()).toEqual([]);
    // gh on other machines answers with what agents get there.
    expect(world.hostCalls.find((call) => call.method === "ghApiRepo" && call.hostId === REMOTE)?.input).toMatchObject({ mode: "as-agents" });
    // RPC (which agents reach with `bb plugin rpc call`) is as cautious as the schedule.
    await harness.behavior.callRpc("recheck", { itemId: "github.access:platform", hostId: SERVER });
    await until(async () => world.hostCalls.filter((call) => call.method === "ghApiRepo").length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lsCalls()).toEqual([]);
    // The page's Recheck, through the browser-only route, lets git use its helpers.
    await act(harness, { action: "recheck", itemId: "github.access:platform", hostId: SERVER });
    await until(async () => lsCalls().length > 0);
    expect(lsCalls()[0]!.input).toMatchObject({ helpers: true, mode: "raw" });
    await expect(act(harness, { action: "recheck", itemId: "github.access:platform", hostId: SERVER }, { "content-type": "application/json" })).rejects.toThrow(/^403/);
    // Without gh's confirmation a scheduled run doesn't guess.
    rmSync(join(world.root, "api-ok"));
    world.hostCalls.length = 0;
    await check(harness, "github.access:platform");
    s = await state(harness);
    expect(on(s, "github.access:platform", SERVER).category).toBe("no-access");
  });
});

describe("checks without the user's ssh config", () => {
  it("says a background result didn't read ~/.ssh/config, and a Recheck does", async () => {
    world = makeWorld();
    writeManifest(world, ["ssh: {}"]);
    mkdirSync(join(world.root, `passwd-${SERVER}`, ".ssh"), { recursive: true });
    writeFileSync(join(world.root, `passwd-${SERVER}`, ".ssh", "config"), "Host *\n  IdentitiesOnly no\n");
    const { harness } = await boot(world);
    await check(harness);
    expect(on(await state(harness), "ssh.key", SERVER).detail).toBe("No SSH key for bb on this machine yet. Checked without your ssh config; Recheck to use it.");
    await act(harness, { action: "recheck", itemId: "ssh.key", hostId: SERVER });
    const clicked = await until(async () => {
      const s = await state(harness);
      return on(s, "ssh.key", SERVER).detail.includes("Recheck to use it") ? null : s;
    });
    expect(on(clicked, "ssh.key", SERVER).detail).toBe("No SSH key for bb on this machine yet.");
  });
});

describe("an existing SSH setup the background can't see", () => {
  // The key sits in an SSH agent: the background check (no agent, no
  // ~/.ssh/config) fails, and safe fixes must not rewire git's SSH.
  it("waits for a Recheck instead of offering safe fixes that replace it", async () => {
    world = makeWorld();
    writeManifest(world, ["ssh: {}"]);
    world.sameHome.add(SERVER);
    const fakeSsh = join(world.root, "fake-ssh");
    mkdirSync(fakeSsh);
    writeFileSync(join(fakeSsh, "ssh"), "#!/bin/sh\necho 'git@github.com: Permission denied (publickey).' >&2\nexit 255\n");
    chmodSync(join(fakeSsh, "ssh"), 0o755);
    world.agentsEnv[SERVER] = { PATH: `${fakeSsh}:${world.bin}:${process.env.PATH ?? ""}`, SSH_AUTH_SOCK: join(world.root, "agent.sock") };
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    for (const id of ["ssh.key", "ssh.known-hosts", "ssh.config"]) {
      expect(on(s, id, SERVER)).toMatchObject({ status: "unknown", category: "needs-recheck" });
      expect(item(s, id).fixes).toEqual([]);
    }
    await harness.behavior.runCli(["apply", "--safe", "--machine", "server"]);
    const home = world.homes[SERVER]!;
    expect(existsSync(join(home, ".ssh", "bb_ed25519"))).toBe(false);
    expect(existsSync(join(home, ".ssh", "bb_config"))).toBe(false);
    expect(existsSync(join(home, ".gitconfig"))).toBe(false);
    // A click looks with the agent; here it still fails, so the fixes come back.
    await act(harness, { action: "recheck", itemId: "ssh.key", hostId: SERVER });
    const clicked = await until(async () => {
      const next = await state(harness);
      return on(next, "ssh.key", SERVER).category === "missing" ? next : null;
    });
    expect(item(clicked, "ssh.key").fixes[0]!.fixes.map((f) => f.kind)).toEqual(["ssh-keygen"]);
    const calls = world.hostCalls.filter((call) => call.method === "lsRemote");
    expect(calls.some((call) => (call.input as { helpers?: boolean }).helpers === true)).toBe(true);
  });
});

describe("read-only SSH folder", () => {
  it("offers only something to copy for the key and known hosts, and nothing safe", async () => {
    world = makeWorld();
    writeManifest(world, ["ssh: {}"]);
    const ssh = join(world.homes[SERVER]!, ".ssh");
    mkdirSync(ssh, { recursive: true });
    // A known-hosts file managed elsewhere, holding only one of GitHub's keys.
    writeFileSync(join(ssh, "bb_known_hosts"), "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n");
    chmodSync(join(ssh, "bb_known_hosts"), 0o444);
    chmodSync(ssh, 0o555);
    try {
      const { harness } = await boot(world);
      await check(harness);
      const s = await state(harness);
      const key = on(s, "ssh.key", SERVER);
      expect(key).toMatchObject({ category: "read-only" });
      expect(key.facts.addThere).toBe(`ssh-keygen -t ed25519 -N '' -C bb@server -f '${join(ssh, "bb_ed25519")}'`);
      expect(on(s, "ssh.known-hosts", SERVER)).toMatchObject({ category: "read-only" });
      for (const id of ["ssh.key", "ssh.known-hosts"]) {
        expect(item(s, id).fixes[0]!.fixes.map((f) => [f.kind, f.safe])).toEqual([["copy-text", false]]);
      }
      expect(s.safeFixes.filter((f) => f.itemId.startsWith("ssh."))).toEqual([]);
    } finally {
      chmodSync(ssh, 0o755);
    }
  });
});

describe("bb's own refusals", () => {
  it("says what bb refused, masked, instead of a generic failure", async () => {
    world = makeWorld();
    writeManifest(world, ["env: [{ name: TRACKER_API_KEY }]"]);
    const { harness } = await boot(world);
    await check(harness);
    world.setEnvError = Object.assign(new Error("Required ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"), { name: "BbHttpError", status: 400, code: "invalid_request" });
    const response = await harness.behavior.fetchHttp("POST", "/actions", { headers: BROWSER, body: JSON.stringify({ action: "setEnv", name: "TRACKER_API_KEY", value: "x" }) });
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(response.status).toBe(502);
    expect(body.message).toMatch(/^bb refused the action: bb answered 400 invalid_request \(Required .+\)\.$/);
    expect(body.message).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789AB");
    const log = JSON.stringify(harness.inspection.logEntries);
    expect(log).toContain("action setEnv failed: BbHttpError 400 invalid_request");
    expect(log).not.toContain("Required");
  });
});

describe("skills from git", () => {
  // Acceptance 5 (git source): install, no file inside the skill, drift with
  // a diff, Update back to green.
  it("installs into <dataDir>/skills, detects a new commit and updates", async () => {
    world = makeWorld();
    skillsSource(world, { "code-review": skillMd("code-review"), deploy: skillMd("deploy") });
    writeManifest(world, [
      "skills:",
      `  - { id: team, source: git, url: '${world.skillsRepo}', ref: main, paths: ['skills/*'] }`,
    ]);
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(s.manifest.status).toBe("ok");
    expect(on(s, "skill:team", SERVER)).toMatchObject({ status: "todo", category: "not-installed" });
    expect(s.safeFixes.map((f) => f.kind)).toContain("skills-sync");

    const plan = (await harness.behavior.callRpc("fixAllSafe", { dryRun: true })) as { planned: { itemId: string }[] };
    expect(plan.planned.map((p) => p.itemId)).toContain("skill:team");
    await harness.behavior.callRpc("fixAllSafe", { dryRun: false });
    const root = join(world.dataDir, "skills");
    expect(readdirSync(root).sort()).toEqual(["code-review", "deploy"]);
    expect(readdirSync(join(root, "deploy"))).toEqual(["SKILL.md"]);
    expect(readdirSync(world.dataDir)).not.toContain(".team-onboarding-staging");
    s = await state(harness);
    expect(item(s, "skill:team").status).toBe("ok");

    // A new commit on the tracked branch turns it amber with the change list.
    const { skills } = repos(world);
    skills.write("skills/deploy/SKILL.md", skillMd("deploy", "\nNew step.\n"));
    skills.write("skills/triage/SKILL.md", skillMd("triage"));
    skills.commit();
    await check(harness, "skill:team");
    s = await state(harness);
    expect(on(s, "skill:team", SERVER)).toMatchObject({ status: "update" });
    expect(on(s, "skill:team", SERVER).facts).toMatchObject({ changed: ["deploy"], added: ["triage"] });
    const diff = (await harness.behavior.callRpc("skillsDiff", { itemId: "skill:team" })) as { diffs: { folder: string; diff: string }[] };
    expect(diff.diffs[0]!.diff).toContain("+ New step.");
    await fix(harness, "skill:team", SERVER, "skills-update", true);
    s = await state(harness);
    expect(item(s, "skill:team").status).toBe("ok");
    expect(readdirSync(root).sort()).toEqual(["code-review", "deploy", "triage"]);

    // Removed upstream: shown as an update, removed only after confirmation.
    skills.remove("skills/code-review");
    skills.commit();
    await check(harness, "skill:team");
    s = await state(harness);
    expect(on(s, "skill:team", SERVER).detail).toContain("removed: code-review");
    await expect(fix(harness, "skill:team", SERVER, "skills-remove")).rejects.toThrow(/confirmation/);
    await fix(harness, "skill:team", SERVER, "skills-remove", true);
    expect(readdirSync(root).sort()).toEqual(["deploy", "triage"]);
  });

  // Acceptance 6: a hand-made folder with the same name.
  it("fails on a hand-made folder, overwrites nothing, and offers both fixes", async () => {
    world = makeWorld();
    skillsSource(world, { deploy: skillMd("deploy") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    mkdirSync(join(world.dataDir, "skills", "deploy"), { recursive: true });
    writeFileSync(join(world.dataDir, "skills", "deploy", "SKILL.md"), skillMd("deploy", "mine"));
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "skill:team", SERVER).category).toBe("conflict");
    expect(item(s, "skill:team").fixes[0]!.fixes.map((f) => f.kind)).toEqual(["skills-rename-mine", "skills-replace-mine"]);
    expect(s.safeFixes.some((f) => f.itemId === "skill:team")).toBe(false);
    expect(readFileSync(join(world.dataDir, "skills", "deploy", "SKILL.md"), "utf8")).toContain("mine");
    await fix(harness, "skill:team", SERVER, "skills-rename-mine");
    expect(readdirSync(join(world.dataDir, "skills")).sort()).toEqual(["deploy", "deploy-mine"]);
    expect(readFileSync(join(world.dataDir, "skills", "deploy-mine", "SKILL.md"), "utf8")).toContain("name: deploy-mine");
  });

  // Acceptances 7 and 16: bad skills are rejected with the reason; the
  // previous version stays.
  it("rejects a symlink outside the source and a name mismatch, keeping the previous version", async () => {
    world = makeWorld();
    skillsSource(world, { deploy: skillMd("deploy") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:team", SERVER, "skills-sync");
    const { skills } = repos(world);
    skills.link("skills/deploy/secrets", "/etc/hostname");
    skills.write("skills/review/SKILL.md", skillMd("code-review"));
    skills.commit();
    await check(harness, "skill:team");
    const s = await state(harness);
    const detail = on(s, "skill:team", SERVER).detail;
    expect(detail).toContain("deploy/secrets: a symlink that points outside the source");
    expect(detail).toContain('review/SKILL.md: name "code-review" differs from the folder "review"');
    expect(detail).toContain("The previous version stays.");
    expect(existsSync(join(world.dataDir, "skills", "deploy", "SKILL.md"))).toBe(true);
    expect(existsSync(join(world.dataDir, "skills", "deploy", "secrets"))).toBe(false);
  });

  // A force-push back to an older commit must not hide drift.
  it("reports drift after a force-push to an older commit", async () => {
    world = makeWorld();
    skillsSource(world, { alpha: skillMd("alpha"), beta: skillMd("beta") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    const { skills } = repos(world);
    const commitA = execFileSync("git", ["--git-dir", skills.bare, "rev-parse", "main"], { encoding: "utf8" }).trim();
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:team", SERVER, "skills-sync");
    skills.write("skills/alpha/SKILL.md", skillMd("alpha", "B only.\n"));
    skills.write("skills/zeta/SKILL.md", skillMd("zeta"));
    skills.commit();
    await check(harness, "skill:team");
    await fix(harness, "skill:team", SERVER, "skills-update", true);
    expect(item(await state(harness), "skill:team").status).toBe("ok");
    // Force-push main back to A.
    execFileSync("git", ["--git-dir", skills.bare, "update-ref", "refs/heads/main", commitA]);
    await check(harness, "skill:team");
    const s = await state(harness);
    expect(on(s, "skill:team", SERVER).status).toBe("update");
    expect(on(s, "skill:team", SERVER).facts).toMatchObject({ changed: ["alpha"], removed: ["zeta"] });
  });

  // Skills of an entry removed from the manifest get an item.
  it("offers to remove skills whose entry left the manifest", async () => {
    world = makeWorld();
    skillsSource(world, { alpha: skillMd("alpha") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:team", SERVER, "skills-sync");
    mkdirSync(join(world.dataDir, "skills", "mine"), { recursive: true });
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "skills.removed", SERVER)).toMatchObject({ status: "update", detail: "No longer in your team's manifest: alpha." });
    await expect(fix(harness, "skills.removed", SERVER, "skills-remove")).rejects.toThrow(/confirmation/);
    await fix(harness, "skills.removed", SERVER, "skills-remove", true);
    expect(readdirSync(join(world.dataDir, "skills"))).toEqual(["mine"]);
    expect((await state(harness)).items.some((i) => i.id === "skills.removed")).toBe(false);
  });

  it("notices a local edit and offers Keep my edits or Restore", async () => {
    world = makeWorld();
    skillsSource(world, { deploy: skillMd("deploy") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}' }`]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:team", SERVER, "skills-sync");
    writeFileSync(join(world.dataDir, "skills", "deploy", "SKILL.md"), skillMd("deploy", "edited"));
    await check(harness, "skill:team");
    let s = await state(harness);
    expect(on(s, "skill:team", SERVER)).toMatchObject({ status: "update", category: "edited" });
    await fix(harness, "skill:team", SERVER, "skills-restore", true);
    s = await state(harness);
    expect(item(s, "skill:team").status).toBe("ok");
    expect(readFileSync(join(world.dataDir, "skills", "deploy", "SKILL.md"), "utf8")).not.toContain("edited");
  });

  it("reads an apm.yml and installs its packages through git", async () => {
    world = makeWorld();
    const { skills } = repos(world);
    skills.write("packages/eng/.apm/skills/tdd/SKILL.md", skillMd("tdd"));
    skills.write("apm.yml", `name: t\ndependencies:\n  apm:\n    - git: ${world.skillsRepo}\n      path: packages/eng\n`);
    skills.commit();
    writeManifest(world, ["skills:", `  - { id: apm, source: apm, url: '${world.skillsRepo}', path: apm.yml }`]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "skill:apm", SERVER, "skills-sync");
    expect(readdirSync(join(world.dataDir, "skills"))).toEqual(["tdd"]);
    expect(lstatSync(join(world.dataDir, "skills", "tdd")).isDirectory()).toBe(true);
  });
});

describe("the schedule", () => {
  type Bb = Awaited<ReturnType<typeof boot>>["bb"];
  /** Makes the next tick due, as if the check interval had passed. */
  const due = (bb: Bb) => bb.storage.kv.set("meta", { lastRunAt: null, lastCheckAt: null });
  const tick = (harness: Harness) => harness.behavior.runSchedule("checks");
  const idle = (harness: Harness) => until(async () => !(await state(harness)).running);

  it("asks no machine anything between due runs", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node } }]"]);
    const { bb, harness } = await boot(world);
    await check(harness);
    await idle(harness);
    world.hostCalls.length = 0;
    const providers = world.providerCalls;
    await tick(harness);
    expect(world.hostCalls).toEqual([]);
    expect(world.providerCalls).toBe(providers);
    await due(bb);
    await tick(harness);
    expect(world.hostCalls.filter((call) => call.method === "toolVersion")).toHaveLength(2);
  });

  it("starts nothing while the last tick still runs", async () => {
    world = makeWorld();
    const { bb, harness } = await boot(world);
    await check(harness);
    await idle(harness);
    await due(bb);
    world.hostCalls.length = 0;
    world.providerDelayMs = 1_000;
    const first = tick(harness);
    await until(async () => world.hostCalls.some((call) => call.method === "probe"));
    await tick(harness);
    await first;
    expect(world.hostCalls.filter((call) => call.method === "probe")).toHaveLength(1);
  });

  it("asks the server's agents once per run", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    await check(harness);
    await idle(harness);
    const providers = world.providerCalls;
    await check(harness);
    // One answer per machine: the item list and the server's checks share it.
    expect(world.providerCalls - providers).toBe(2);
  });

  it("reuses an unchanged skills result on a schedule, and a check clones again", async () => {
    world = makeWorld();
    skillsSource(world, { deploy: skillMd("deploy") });
    writeManifest(world, ["skills:", `  - { id: team, source: git, url: '${world.skillsRepo}', ref: main, paths: ['skills/*'] }`]);
    const { bb, harness } = await boot(world);
    await check(harness);
    await idle(harness);
    const gitRuns = async (work: () => Promise<unknown>) => {
      const before = snapshot();
      await work();
      return since(before).counts["spawn:server"] ?? 0;
    };
    // Not installed yet: the schedule asks the remote for its commit and
    // clones nothing while that commit stays.
    await due(bb);
    expect(await gitRuns(() => tick(harness))).toBe(1);
    expect(on(await state(harness), "skill:team", SERVER)).toMatchObject({ status: "todo", category: "not-installed" });
    // A new commit is looked at in full on the next tick.
    const { skills } = repos(world);
    skills.write("skills/triage/SKILL.md", skillMd("triage"));
    skills.commit();
    await due(bb);
    expect(await gitRuns(() => tick(harness))).toBeGreaterThan(1);
    expect(on(await state(harness), "skill:team", SERVER).facts).toMatchObject({ added: ["deploy", "triage"] });
    // A check from the CLI always looks in full.
    expect(await gitRuns(() => check(harness))).toBeGreaterThan(1);
  });
});

describe("team checks and approvals", () => {
  // Acceptances 9 and 17.
  it("runs a team check only after approval, and asks again when the command changes", async () => {
    world = makeWorld();
    writeManifest(world, ["checks:", "  - { id: vpn, title: VPN, run: 'exit 0', machines: server }"]);
    const { bb, harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "check:vpn", SERVER).status).toBe("needs-approval");
    expect(world.hostCalls.some((call) => call.method === "runCheck")).toBe(false);
    const command = item(s, "check:vpn").commands[0]!;
    expect(command.text).toBe("exit 0");
    await approve(harness, command.hash);
    await until(async () => (on(await state(harness), "check:vpn", SERVER).status === "ok" ? true : null));
    expect(world.hostCalls.filter((call) => call.method === "runCheck")).toHaveLength(1);

    writeManifest(world, ["checks:", "  - { id: vpn, title: VPN, run: 'exit 1', machines: server }"]);
    await bb.storage.kv.set("meta", { lastRunAt: null, lastCheckAt: null });
    await harness.behavior.runSchedule("checks");
    s = await state(harness);
    expect(on(s, "check:vpn", SERVER).status).toBe("needs-approval");
    expect(world.hostCalls.filter((call) => call.method === "runCheck")).toHaveLength(1);
  });

  // Acceptance 21 (the CLI can't approve and runs only safe fixes; no agent tools).
  it("gives the CLI no way to approve, runs only safe fixes, and registers no agent tools", async () => {
    world = makeWorld();
    writeManifest(world, [
      "ssh: {}",
      "checks:",
      "  - { id: vpn, title: VPN, run: 'exit 1', machines: server, fix: { kind: run, command: 'true' } }",
    ]);
    const { harness } = await boot(world);
    await check(harness);
    const registrations = harness.inspection.registrations;
    expect(registrations.agentTools).toEqual([]);
    expect(registrations.experimental_publishedRpcMethods).toEqual([]);
    const cli = await harness.behavior.runCli(["approve"]);
    expect(cli.exitCode).not.toBe(0);
    expect(registrations.rpcMethods).not.toContain("approve");
    // Without the browser's Sec-Fetch-* headers the actions route refuses.
    const hash = item(await state(harness), "check:vpn").commands[0]!.hash;
    await expect(act(harness, { action: "approve", hash }, { "content-type": "application/json" })).rejects.toThrow(/^403/);
    await expect(
      act(harness, { action: "approve", hash }, { "content-type": "application/json", "sec-fetch-site": "same-origin" }),
    ).rejects.toThrow(/^403/);
    expect(item(await state(harness), "check:vpn").commands[0]!.approved).toBe(false);
    // RPC, which `bb plugin rpc call` reaches, runs safe fixes only.
    for (const method of ["approve", "setEnv", "openTerminal", "forgetMachine"]) {
      expect(registrations.rpcMethods).not.toContain(method);
    }
    expect(
      await harness.behavior.callRpc("runFix", { itemId: "ssh.uploaded", hostId: SERVER, kind: "copy-public-key", confirmed: true }),
    ).toMatchObject({ ok: false });
    expect(
      await harness.behavior.callRpc("runFix", { itemId: "github.login", hostId: SERVER, kind: "device-login", confirmed: true }),
    ).toMatchObject({ ok: false, message: "Only safe fixes can run here." });
    expect(await harness.behavior.callRpc("runFix", { itemId: "ssh.known-hosts", hostId: SERVER, kind: "write-known-hosts" })).toMatchObject({ ok: true });
    const refused = await harness.behavior.runCli(["fix", "check:vpn"]);
    expect(`${refused.stdout}${refused.stderr}`).not.toContain("The fix ran");
    expect(world.hostCalls.filter((call) => call.method === "runCheck" && JSON.stringify(call.input).includes('"true"'))).toEqual([]);
    await harness.behavior.runCli(["fix", "ssh.key"]);
    expect(existsSync(join(world.homes[SERVER]!, ".ssh", "bb_ed25519"))).toBe(true);
  });

  it("gives every thread the CLI skill and no tools", async () => {
    world = makeWorld();
    const { harness } = await boot(world);
    const { makePluginAgentConfigurationContext } = await import("@get-bb/plugin-sdk/testing");
    const config = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
    expect(JSON.stringify(config)).toContain("team-onboarding");
    expect(JSON.stringify(config)).not.toContain("onboarding_fix");
  });
});

describe("machines", () => {
  // Acceptance 10: an offline machine is unknown and not counted; it is
  // rechecked when it returns.
  it("marks an offline machine unknown and keeps it out of the badge", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node }, min: '1' }]"]);
    const { harness } = await boot(world);
    world.online.delete(REMOTE);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "tool:node", REMOTE)).toMatchObject({ status: "unknown", category: "offline" });
    expect(on(s, "tool:node", REMOTE).detail).toContain("laptop");
    expect(item(s, "tool:node").status).toBe("ok");
    expect(world.hostCalls.some((call) => call.hostId === REMOTE)).toBe(false);
    world.online.add(REMOTE);
    await harness.behavior.runCli(["check", "tool:node"]);
    expect(on(await state(harness), "tool:node", REMOTE).status).toBe("ok");
  });

  // Acceptance 19.
  it("skips machines out of an item's scope", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node }, machines: [laptop] }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "tool:node", SERVER).status).toBe("skipped");
    expect(on(s, "tool:node", REMOTE).status).toBe("ok");
  });

  // Acceptance 13: a tool below its minimum on a remote machine needs
  // approval, then opens a terminal there with the command typed, not entered.
  it("installs a tool through a typed, approved command on the remote", async () => {
    world = makeWorld();
    writeManifest(world, ["tools: [{ id: node, check: { bin: node }, min: '999', install: 'brew install node', machines: [laptop] }]"]);
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "tool:node", REMOTE)).toMatchObject({ status: "todo", category: "too-old" });
    expect(item(s, "tool:node").fixes[0]!.fixes[0]!.kind).toBe("approve");
    await expect(fix(harness, "tool:node", REMOTE, "tool-install")).rejects.toThrow();
    await approve(harness, item(s, "tool:node").commands[0]!.hash);
    s = await state(harness);
    const out = (await fix(harness, "tool:node", REMOTE, "tool-install")) as { terminal: { hostId: string } };
    expect(out.terminal.hostId).toBe(REMOTE);
    expect(world.terminalCreates[0]).toMatchObject({ scope: { kind: "host_path", hostId: REMOTE, cwd: null }, start: { mode: "shell" } });
    expect(world.terminalInputs[0]!.text).toBe("brew install node");
  });

  // Acceptance 8: Log in opens a terminal on that machine with the provider's command.
  it("logs an agent in on the remote with bb's own command", async () => {
    world = makeWorld();
    world.providerStatus[REMOTE] = "unauthenticated";
    writeManifest(world, ["providers: [{ id: claude-code }]"]);
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "agent:claude-code", REMOTE).status).toBe("todo");
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    expect(world.terminalCreates[0]).toMatchObject({ scope: { hostId: REMOTE }, start: { mode: "command", command: "claude /login" } });
    // The page shows it under this item, with what runs and where; a reload finds it again.
    expect((await state(harness)).terminals).toEqual([
      { terminalId: "term-1", hostId: REMOTE, itemId: "agent:claude-code", title: expect.any(String), command: "claude /login", status: "running", exitCode: null },
    ]);
  });

  // A command that ends before the first poll, or while the plugin reloads,
  // still gets its item checked again, once.
  it("rechecks a terminal's item after a quick exit and after a reload", async () => {
    world = makeWorld();
    world.providerStatus[REMOTE] = "unauthenticated";
    writeManifest(world, ["providers: [{ id: claude-code }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    world.providerStatus[REMOTE] = "ready";
    world.terminalStatus["term-1"] = { status: "exited", exitCode: 0 };
    await until(async () => on(await state(harness), "agent:claude-code", REMOTE).status === "ok", 10_000);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login").catch(() => null);
    // A terminal still running when the plugin reloads.
    world.providerStatus[REMOTE] = "unauthenticated";
    await check(harness);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    const reloaded = await harness.lifecycle.reload(plugin);
    world.providerStatus[REMOTE] = "ready";
    world.terminalStatus["term-2"] = { status: "exited", exitCode: 0 };
    await until(async () => {
      const s = (await reloaded.harness.behavior.callRpc("state", null)) as OnboardingState;
      return on(s, "agent:claude-code", REMOTE).status === "ok";
    }, 10_000);
  });

  it("rechecks once, even when the check is slow", { timeout: 40_000 }, async () => {
    world = makeWorld();
    world.providerStatus[REMOTE] = "unauthenticated";
    writeManifest(world, ["providers: [{ id: claude-code }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    // What one recheck of this item costs in provider-state calls.
    let mark = world.providerCalls;
    await harness.behavior.callRpc("recheck", { itemId: "agent:claude-code", hostId: REMOTE });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const perRecheck = world.providerCalls - mark;
    expect(perRecheck).toBeGreaterThan(0);
    // Now each call takes 7 s, longer than two polls.
    world.providerDelayMs = 7_000;
    world.providerStatus[REMOTE] = "ready";
    mark = world.providerCalls;
    world.terminalStatus["term-1"] = { status: "exited", exitCode: 0 };
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    expect(world.providerCalls - mark).toBe(perRecheck);
    expect(on(await state(harness), "agent:claude-code", REMOTE).status).toBe("ok");
  });

  it("rechecks a terminal opened while a slow recheck runs", { timeout: 90_000 }, async () => {
    world = makeWorld();
    world.providerStatus[REMOTE] = "unauthenticated";
    writeManifest(world, ["providers: [{ id: claude-code }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    // term-1 ends and its recheck is slow (and still finds no login).
    world.providerDelayMs = 7_000;
    world.terminalStatus["term-1"] = { status: "exited", exitCode: 1 };
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    // Meanwhile a second fix opens term-2.
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    // Only once term-1's recheck is over does term-2 end with the login done,
    // so only term-2's own recheck can turn the item ok.
    await until(async () => !(await state(harness)).running, 40_000);
    world.providerDelayMs = 0;
    world.providerStatus[REMOTE] = "ready";
    world.terminalStatus["term-2"] = { status: "exited", exitCode: 0 };
    await until(async () => on(await state(harness), "agent:claude-code", REMOTE).status === "ok", 15_000);
  });

  it("treats a failed status lookup as unknown, not as an end", { timeout: 20_000 }, async () => {
    world = makeWorld();
    world.providerStatus[REMOTE] = "unauthenticated";
    writeManifest(world, ["providers: [{ id: claude-code }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await fix(harness, "agent:claude-code", REMOTE, "provider-login");
    world.terminalStatus["term-1"] = "error";
    const before = world.providerCalls;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(world.providerCalls - before).toBe(0);
    // Still on the page, as unknown, and rechecked once bb says it really ended.
    expect((await state(harness)).terminals).toMatchObject([{ terminalId: "term-1", status: "unknown" }]);
    world.providerStatus[REMOTE] = "ready";
    world.terminalStatus["term-1"] = "missing";
    await until(async () => on(await state(harness), "agent:claude-code", REMOTE).status === "ok", 10_000);
    expect((await state(harness)).terminals).toMatchObject([{ terminalId: "term-1", status: "gone" }]);
  });

  // Acceptance 11.
  it("apply --safe --machine runs the safe fixes there and lists the rest", async () => {
    world = makeWorld();
    skillsSource(world, { deploy: skillMd("deploy") });
    writeManifest(world, [
      "github: { mode: per-machine }",
      "ssh: {}",
      "skills:",
      `  - { id: team, source: git, url: '${world.skillsRepo}' }`,
    ]);
    const { harness } = await boot(world);
    const out = await harness.behavior.runCli(["apply", "--safe", "--machine", "laptop"]);
    expect(out.exitCode).toBe(0);
    const home = world.homes[REMOTE]!;
    expect(existsSync(join(home, ".ssh", "bb_ed25519"))).toBe(true);
    expect(readFileSync(join(home, ".ssh", "bb_known_hosts"), "utf8")).toContain("github.com ssh-ed25519");
    expect(readFileSync(join(home, ".gitconfig"), "utf8")).toContain("bb_config");
    expect(out.stdout).toContain("ssh.key");
    expect(out.stdout).toContain("Left to do by hand");
    expect(out.stdout).toContain("github.login");
    expect(out.stdout).toContain("ssh.uploaded");
    // The server machine was not touched.
    expect(existsSync(join(world.homes[SERVER]!, ".ssh"))).toBe(false);
  });
});

describe("GitHub modes", () => {
  // Acceptance 23 (settings side): the switch is confirmed and sends the
  // whole settings object back with builtInGit off.
  it("switches to per-machine GitHub after confirmation", async () => {
    world = makeWorld();
    writeManifest(world, ["github: { mode: per-machine }", "ssh: {}"]);
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "github.mode", SERVER).status).toBe("todo");
    // Per-machine: every machine in scope has its own login and SSH items.
    expect(item(s, "github.login").results.map((r) => r.status)).not.toContain("skipped");
    expect(item(s, "ssh.key").results.map((r) => r.status)).not.toContain("skipped");
    await expect(fix(harness, "github.mode", SERVER, "switch-per-machine")).rejects.toThrow(/confirmation/);
    await fix(harness, "github.mode", SERVER, "switch-per-machine", true);
    expect(world.generalSettings).toMatchObject({ machineGitCredentialsEnabled: false, managedBranchPrefix: "bb/", streamerMode: false });
    s = await state(harness);
    expect(item(s, "github.mode").status).toBe("ok");
  });

  it("keeps SSH to the server machine in builtin mode", async () => {
    world = makeWorld();
    writeManifest(world, ["ssh: {}"]);
    const { harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "ssh.key", REMOTE).status).toBe("skipped");
  });
});

describe("environment and privacy", () => {
  // Acceptance 25.
  it("refuses GH_TOKEN and sets listed variables", async () => {
    world = makeWorld();
    writeManifest(world, ["env: [{ name: TRACKER_API_KEY }, { name: GH_TOKEN }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await expect(act(harness, { action: "setEnv", name: "GH_TOKEN", value: "x" })).rejects.toThrow(/^400 .*built-in git/);
    await expect(act(harness, { action: "setEnv", name: "OTHER", value: "x" })).rejects.toThrow(/^400 .*manifest/);
    await act(harness, { action: "setEnv", name: "TRACKER_API_KEY", value: "secret-value" });
    expect(world.machineEnv).toEqual([{ name: "TRACKER_API_KEY" }]);
    expect(JSON.stringify(harness.inspection.logEntries)).not.toContain("secret-value");
  });

  // Acceptances 12 and 20.
  it("stores and logs categories, never repository URLs or organisation names", async () => {
    world = makeWorld();
    writeManifest(world, ["github:", "  access:", "    - { id: platform, repo: example-org/private-repo }"]);
    const { bb, harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    expect(on(s, "github.access:platform", SERVER)).toMatchObject({ status: "todo", category: "no-access" });
    expect(on(s, "github.access:platform", SERVER).detail).toContain("It says the same when you can't read it");
    const stored = await everythingStored(bb);
    expect(stored).not.toContain("example-org");
    expect(stored).not.toContain("private-repo");
    expect(JSON.stringify(harness.inspection.logEntries)).not.toMatch(/example-org|file:\/\//);
    expect(JSON.stringify(harness.inspection.realtimeSignals)).not.toContain("example-org");
    // Raw output stays available on request, in memory.
    const details = (await harness.behavior.callRpc("details", { itemId: "github.access:platform", hostId: SERVER })) as { text: string };
    expect(details.text).toContain("404");
  });

  // Acceptance 12 with plugin sources and approved commands.
  it("keeps plugin sources and approved commands out of storage", async () => {
    world = makeWorld();
    writeManifest(world, [
      "plugins: [{ id: helper, install: 'git:https://example.com/example-org/bb-plugin-helper.git' }]",
      "checks: [{ id: net, title: Net, run: 'curl -sf https://internal.example.com/health || true', machines: server }]",
    ]);
    const { bb, harness } = await boot(world);
    await check(harness);
    const s = await state(harness);
    for (const id of ["plugin:helper", "check:net"]) await approve(harness, item(s, id).commands[0]!.hash);
    await until(async () => (on(await state(harness), "check:net", SERVER).status === "ok" ? true : null));
    const stored = await everythingStored(bb);
    expect(stored).not.toMatch(/https?:\/\/|example-org|file:\/\//);
    // The page still shows each command verbatim, from the cached manifest.
    expect(item(await state(harness), "plugin:helper").commands[0]).toMatchObject({ approved: true, text: "git:https://example.com/example-org/bb-plugin-helper.git" });
  });
});

describe("Show details", () => {
  // Raw output is redacted on the way out.
  it("masks secrets in a check's output", async () => {
    world = makeWorld();
    writeManifest(world, ["checks: [{ id: leak, title: Leak, run: 'echo GH_TOKEN=abc123 https://user:pw@example.com/x ghp_abcdefghijklmnopqrstuvwxyz012345', machines: server }]"]);
    const { harness } = await boot(world);
    await check(harness);
    await approve(harness, item(await state(harness), "check:leak").commands[0]!.hash);
    await until(async () => (on(await state(harness), "check:leak", SERVER).status === "ok" ? true : null));
    const details = (await harness.behavior.callRpc("details", { itemId: "check:leak", hostId: SERVER })) as { text: string };
    expect(details.text).toBe("GH_TOKEN=[redacted] https://[credentials]@example.com/x [token]");
  });
});

describe("plugins", () => {
  // Acceptance 14: needs approval with its source, then installs.
  it("waits for approval, then installs", async () => {
    world = makeWorld();
    writeManifest(world, ["plugins: [{ id: helper, install: 'git:https://example.com/bb-plugin-helper.git' }]"]);
    const { harness } = await boot(world);
    await check(harness);
    let s = await state(harness);
    expect(on(s, "plugin:helper", SERVER)).toMatchObject({ status: "needs-approval" });
    expect(item(s, "plugin:helper").commands[0]!.text).toBe("git:https://example.com/bb-plugin-helper.git");
    expect(s.items.some((i) => i.id === "tool:npm")).toBe(true);
    await approve(harness, item(s, "plugin:helper").commands[0]!.hash);
    await until(async () => (on(await state(harness), "plugin:helper", SERVER).status === "todo" ? true : null));
    s = await state(harness);
    expect(s.safeFixes.some((f) => f.itemId === "plugin:helper" && f.kind === "plugin-install")).toBe(true);
    await fix(harness, "plugin:helper", SERVER, "plugin-install");
    s = await state(harness);
    expect(item(s, "plugin:helper").status).toBe("ok");
  });
});
