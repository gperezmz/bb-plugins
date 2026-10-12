// The plugin's entry, loaded against the SDK's fake host and a fake GitHub on
// a loopback port: register through the command line, poll through the
// service, and read what reached the manager's thread.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "../server";
import { SqliteStore } from "../src/fleet/adapters/store";
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

/** Hooks to script the manager thread's side of the SDK. */
interface Sdk {
  get?: () => Promise<unknown>;
  send?: (args: unknown) => Promise<unknown>;
}

async function load(state: Partial<FakeGithubState>, sent: unknown[] = [], sdk: Sdk = {}) {
  // The authorization header of every request the fake GitHub received, which its own log does not keep.
  const bearers: string[] = [];
  const github = createFakeGithub(state);
  fake = await listen({
    ...github,
    handle: (request, body, response) => {
      bearers.push(request.headers.authorization ?? "");
      return github.handle(request, body, response);
    },
  });
  const host = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    settings: {
      credentials: JSON.stringify([{ prefix: "github.example/org", auth: "token", service: "github", baseUrl: fake.url }]),
      tokens: JSON.stringify({ "github.example/org": TOKEN }),
    },
    sdk: {
      threads: {
        get: sdk.get ?? (async () => ({ id: MANAGER, archivedAt: null, deletedAt: null })),
        send:
          sdk.send ??
          (async (args: unknown) => {
            sent.push(args);
            return { delivery: "sent", ok: true };
          }),
      },
    },
  });
  await plugin(host.bb);
  return { ...host, sent, fake, bearers };
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
    expect(sent[0]!.input[0]!.text).toMatch(/^Moved on the tracker or the forge since /);
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

/** Waits up to `ms` for `condition`; the service runs on real time. */
async function until(condition: () => boolean, ms = 3_000) {
  for (let waited = 0; !condition() && waited < ms; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("what the entry wires between bb and the fleets", () => {
  const registered = async (state: Partial<FakeGithubState>, sent: unknown[] = [], sdk: Sdk = {}) => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(inbox(7)));
    const loaded = await load(state, sent, sdk);
    await loaded.harness.runCli(registerArgs(manifest), { threadId: MANAGER });
    return loaded;
  };
  const wakeEntries = async (harness: Awaited<ReturnType<typeof load>>["harness"]) =>
    (JSON.parse((await harness.runCli(["fleet", "ledger", REPO, "--json"])).stdout).entries as { type: string; wake?: { dispatchedAt: string | null; queuedMessageId?: string | null } }[]).filter((e) => e.type === "wake");

  it("records when bb dispatched a queued wake, on message.dispatched", async () => {
    const comment = new Date(Date.now() + 5_000).toISOString();
    const sent: unknown[] = [];
    const { harness } = await registered(
      { repos: { "org/repo": { issues: [issue(7)], comments: [{ id: 1, issue: 7, user: "alice", body: "x", createdAt: comment, updatedAt: comment }] } as never } },
      sent,
      { send: async (args) => (sent.push(args), { ok: true, delivery: "queued", queuedMessage: makeQueueEntry({ id: "q-wake-1" }) }) },
    );
    const service = harness.runService("poll-fleets");
    await until(() => sent.length > 0);
    service.controller.abort();
    await service.done;
    expect(sent).toHaveLength(1);

    const waiting = await wakeEntries(harness);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.wake!.dispatchedAt).toBeNull();

    // A message that is not the wake's changes nothing; the wake's own records the time.
    await harness.emitThreadEvent("message.dispatched", { entry: makeQueueEntry({ id: "someone-elses" }) });
    expect((await wakeEntries(harness))[0]!.wake!.dispatchedAt).toBeNull();
    const before = Date.now();
    await harness.emitThreadEvent("message.dispatched", { entry: makeQueueEntry({ id: "q-wake-1" }) });
    const dispatchedAt = (await wakeEntries(harness))[0]!.wake!.dispatchedAt;
    expect(dispatchedAt).not.toBeNull();
    expect(Date.parse(dispatchedAt!)).toBeGreaterThanOrEqual(before);
  });

  it("prunes the ledger at the service's first tick, cutting what is older than 30 days", async () => {
    const { harness, bb } = await registered({ repos: { "org/repo": { issues: [issue(7)] } as never } });
    const store = new SqliteStore(bb.storage.database());
    const stale = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 29 * 86_400_000).toISOString();
    const base = { role: "forge" as const, kind: "commented" as const, label: null, actor: "alice", at: stale, disposition: "out-of-scope" as const, rule: null };
    store.recordChange("github.example/org/repo", { ...base, key: "old", ref: "#101", url: "https://github.example/org/repo/issues/101", seenAt: stale });
    store.recordChange("github.example/org/repo", { ...base, key: "new", ref: "#102", url: "https://github.example/org/repo/issues/102", seenAt: fresh });
    const refs = async () => (JSON.parse((await harness.runCli(["fleet", "ledger", REPO, "--done", "out-of-scope", "--json"])).stdout).entries as { row: { ref: string } }[]).map((e) => e.row.ref).sort();
    expect(await refs()).toEqual(["#101", "#102"]);

    const service = harness.runService("poll-fleets");
    for (let waited = 0; (await refs()).includes("#101") && waited < 3_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    service.controller.abort();
    await service.done;
    expect(await refs()).toEqual(["#102"]);
  });

  it("uses a token pasted after the plugin loaded for the next read", async () => {
    const { harness, bearers } = await registered({ repos: { "org/repo": { issues: [issue(7), issue(8)] } as never } });
    const service = harness.runService("poll-fleets");
    await until(() => bearers.length > 0);
    service.controller.abort();
    await service.done;
    expect(bearers.length).toBeGreaterThan(0);
    expect(new Set(bearers)).toEqual(new Set([`Bearer ${TOKEN}`]));

    const NEW_TOKEN = "ghp_pasted_after_load_value";
    await harness.setSettings({ tokens: JSON.stringify({ "github.example/org": NEW_TOKEN }) });
    // The manager's turn ends with a second item in its manifest, which is read with whatever token is held now.
    writeFileSync(join(dir, "manifest.md"), manifestText(`${inbox(7)}\n${inbox(8)}`));
    const before = bearers.length;
    await harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: MANAGER }), lastAssistantText: null });
    expect(bearers.length).toBeGreaterThan(before);
    expect(new Set(bearers.slice(before))).toEqual(new Set([`Bearer ${NEW_TOKEN}`]));
  });

  it("scrubs every held token from a warning, including one bb's own error carries", async () => {
    let failing = false;
    const { harness } = await registered(
      { repos: { "org/repo": { issues: [issue(7)] } as never } },
      [],
      { get: async () => { if (failing) throw new Error(`connection to bb failed with ${TOKEN} in the message`); return { id: MANAGER, archivedAt: null, deletedAt: null }; } },
    );
    failing = true;
    const service = harness.runService("poll-fleets");
    await until(() => harness.logEntries.some((entry) => entry.level === "warn" && entry.message.includes("polling")));
    service.controller.abort();
    await service.done;

    const warning = harness.logEntries.find((entry) => entry.level === "warn" && entry.message.includes("polling"));
    expect(warning?.message).toContain("connection to bb failed with [redacted] in the message");
    expect(JSON.stringify(harness.logEntries)).not.toContain(TOKEN);
  });
});
