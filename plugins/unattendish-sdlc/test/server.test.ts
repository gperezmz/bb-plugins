// The plugin's entry, loaded against the SDK's fake host and a fake GitHub on
// a loopback port: register through the command line, poll through the
// service, and read what reached the manager's thread.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "../server";
import { createFakeGithub, type FakeGithubState } from "./fakes/github";
import { listen, type Mounted } from "./fakes/listen";

const TOKEN = "ghp_entry_test_token_value";
const REPO = "github.example/org/repo";
const MANAGER = "thr_manager";

let dir: string;
let fake: Mounted | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unattendish-"));
});
afterEach(async () => {
  await fake?.close();
  rmSync(dir, { recursive: true, force: true });
});

const manifestText = (rows: string) => `# Fleet: ${REPO}\n\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
const inbox = (n: number) => `| #${n} | A parked question | answer | 2026-10-12T09:00:00Z | https://github.example/org/repo/issues/${n} |`;

const issue = (number: number, over = {}): FakeGithubState["repos"][string]["issues"][number] => ({
  number,
  state: "open",
  labels: [],
  assignees: [],
  creator: "olivia",
  createdAt: "2026-10-12T09:00:00Z",
  updatedAt: "2026-10-12T09:00:00Z",
  ...over,
});

async function load(state: Partial<FakeGithubState>, sent: unknown[] = []) {
  fake = await listen(createFakeGithub(state));
  const host = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    settings: {
      credentials: JSON.stringify([{ prefix: "github.example/org", auth: "token", service: "github", baseUrl: fake.url }]),
      tokens: JSON.stringify({ "github.example/org": TOKEN }),
    },
    sdk: {
      threads: {
        get: async () => ({ id: MANAGER, archivedAt: null, deletedAt: null }),
        send: async (args: unknown) => {
          sent.push(args);
          return { delivery: "sent", ok: true };
        },
      },
    },
  });
  await plugin(host.bb);
  return { ...host, sent, fake };
}

const registerArgs = (manifest: string) => [
  "fleet", "register", "--contract", "1", "--repo", REPO, "--tracker", "forge-issues", "--manifest", manifest, "--operator", "olivia",
  "--label-spec", "spec", "--label-ready", "ready", "--label-in-progress", "in-progress", "--label-needs-input", "needs-input", "--marker", "🤖 unattendish agent", "--json",
];

describe("the plugin's entry", () => {
  it("registers the command line, the thread events and the polling service, and declares the two settings", async () => {
    const { harness } = await load({});
    expect(harness.registrations.cli?.name).toBe("unattendish");
    expect(harness.registrations.cli?.commands.map((c) => c.name)).toEqual(expect.arrayContaining(["fleet-register", "fleet-unregister", "fleet-status", "fleet-ledger", "fleet-interval"]));
    expect(harness.registrations.services.map((s) => s.name)).toEqual(["poll-fleets"]);
    expect(Object.keys(harness.registrations.settingsDescriptors).sort()).toEqual(["credentials", "tokens"]);
    expect(harness.registrations.settingsDescriptors.tokens).toMatchObject({ secret: true });
  });

  it("registers a manager, polls the forge, wakes the manager once, and sends nothing but reads", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(inbox(7)));
    const comment = new Date(Date.now() + 5_000).toISOString();
    const sent: { threadId: string; input: { text: string }[]; mode: string }[] = [];
    const { harness } = await load({ repos: { "org/repo": { issues: [issue(7)], comments: [{ id: 1, issue: 7, user: "alice", body: "Go with B.\n", createdAt: comment, updatedAt: comment }] } as never } }, sent);

    const registered = await harness.runCli(registerArgs(manifest), { threadId: MANAGER });
    expect(registered.exitCode).toBe(0);
    expect(JSON.parse(registered.stdout)).toEqual({ outcome: "registered", watched: true, notWatched: [] });

    const service = harness.runService("poll-fleets");
    for (let waited = 0; sent.length === 0 && waited < 100; waited += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    service.controller.abort();
    await service.done;

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ threadId: MANAGER, mode: "queue-if-active" });
    expect(sent[0]!.input[0]!.text).toMatch(/^From Unattendish Fleet: changes since /);
    expect(sent[0]!.input[0]!.text).toContain("#7 commented by alice https://github.example/org/repo/issues/7");
    expect(sent[0]!.input[0]!.text).not.toContain("Go with B");

    // Every request the plugin sent a service was a read, and carried the token only to the fake.
    expect(fake!.requests.length).toBeGreaterThan(0);
    expect(fake!.requests.every((r) => r.method === "GET" && r.hasAuthorization)).toBe(true);

    // The ledger and the status carry no token, and the status shows what the fleet is.
    const ledger = await harness.runCli(["fleet", "ledger", REPO, "--json"]);
    expect(JSON.parse(ledger.stdout).entries.some((e: { type: string; row?: { disposition: string; wakeId: number } }) => e.type === "change" && e.row?.disposition === "wake" && e.row.wakeId === 1)).toBe(true);
    const status = await harness.runCli(["fleet", "status", "--json"]);
    expect(JSON.parse(status.stdout).fleets[0]).toMatchObject({ repo: REPO, manager: MANAGER, watched: true, intervalMs: 120_000 });
    for (const text of [ledger.stdout, status.stdout, JSON.stringify(sent), JSON.stringify(harness.logEntries)]) expect(text).not.toContain(TOKEN);
  });

  it("reads the state of an item the manifest gains when the manager's turn ends", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(inbox(7)));
    const { harness } = await load({ repos: { "org/repo": { issues: [issue(7), issue(8)] } as never } });
    await harness.runCli(registerArgs(manifest), { threadId: MANAGER });
    const service = harness.runService("poll-fleets");
    await new Promise((resolve) => setTimeout(resolve, 300));
    service.controller.abort();
    await service.done;
    const before = fake!.requests.length;

    writeFileSync(manifest, manifestText(`${inbox(7)}\n${inbox(8)}`));
    await harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: MANAGER }), lastAssistantText: null });
    expect(fake!.requests.slice(before).some((r) => r.url.includes("/issues/8"))).toBe(true);
    expect(fake!.requests.slice(before).every((r) => r.method === "GET")).toBe(true);
  });

  it("refuses a poll interval under 30 seconds and names the floor", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(inbox(7)));
    const { harness } = await load({});
    await harness.runCli(registerArgs(manifest), { threadId: MANAGER });
    const refused = await harness.runCli(["fleet", "interval", REPO, "10s", "--json"]);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stdout + refused.stderr).toContain("30");
    expect((await harness.runCli(["fleet", "interval", REPO, "45s"])).exitCode).toBe(0);
    const status = await harness.runCli(["fleet", "status", "--json"]);
    expect(JSON.parse(status.stdout).fleets[0].intervalMs).toBe(45_000);
  });

  it("refuses to register from outside a thread", async () => {
    const { harness } = await load({});
    const refused = await harness.runCli(registerArgs(join(dir, "manifest.md")));
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stdout).toContain("no_thread");
  });
});
