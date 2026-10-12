// The dashboard through the plugin's entry: the RPC the pages call, behind the real composition, on the SDK's fake host.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, { rpcContract } from "../server";
import type { FleetCardView, FleetsView, Result, SettingsView, ThreadFleetView } from "../src/fleet/application/views";
import { threadReport } from "./fixtures/thread-report";

const REPO = "github.example/org/repo";
const MANAGER = "thr_manager";
const TOKEN = "ghp_dashboard_token_value_1";
const NEW_TOKEN = "ghp_dashboard_token_value_2";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unattendish-dashboard-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const manifestText = (rows: string, extra = "") => `# Fleet: ${REPO}\n\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n${rows}\n${extra}`;
const row = (n: number, waitsFor = "answer") => `| #${n} | A parked question | ${waitsFor} | 2026-10-12T09:00:00Z | https://github.example/org/repo/issues/${n} |`;

interface Sent {
  threadId: string;
  input: { text: string }[];
  mode: string;
}

interface Options {
  send?: (args: unknown) => Promise<unknown>;
  report?: () => Promise<unknown>;
  remote?: string | null;
  threadStatus?: string;
  /** No credential is chosen, so a poll reads the manifest and nothing from a service. */
  noCredential?: boolean;
}

async function load(options: Options = {}) {
  const sent: Sent[] = [];
  const host = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    settings: {
      credentials: JSON.stringify(options.noCredential === true ? [] : [{ prefix: "github.example/org", auth: "token", service: "github", baseUrl: "http://127.0.0.1:1" }]),
      tokens: JSON.stringify({ "github.example/org": TOKEN }),
    },
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, status: threadId === MANAGER ? ((options.threadStatus ?? "active") as "active") : "idle", projectId: "proj_1", updatedAt: Date.UTC(2026, 9, 12, 9, 30) }),
        send:
          options.send ??
          (async (args: unknown) => {
            sent.push(args as Sent);
            return { ok: true, delivery: "queued", queuedMessage: makeQueueEntry({ id: "q1" }) };
          }),
      },
      projects: { get: async () => ({ gitRemoteUrl: options.remote === undefined ? "git@github.example:Org/Repo.git" : options.remote }) },
      plugins: { callRpc: options.report ?? (async () => threadReport({ gateway: 1, harness: 0.5, estimate: 0.25 })) },
    },
  });
  await plugin(host.bb);
  const call = <T>(method: string, input: unknown = null) => host.harness.callRpc(method, input) as Promise<T>;
  return { ...host, sent, call };
}

const register = async (harness: Awaited<ReturnType<typeof load>>["harness"], manifest: string) => {
  const result = await harness.runCli(
    ["fleet", "register", "--contract", "1", "--repo", REPO, "--tracker", "forge-issues", "--manifest", manifest, "--operator", "olivia", "--label-spec", "spec", "--label-ready", "ready", "--label-in-progress", "in-progress", "--label-needs-input", "needs-input", "--marker", "🤖 unattendish agent", "--json"],
    { threadId: MANAGER },
  );
  expect(result.exitCode).toBe(0);
};

describe("the dashboard's RPC", () => {
  it("exports the contract the pages import the type of, with every DashboardApi method under its own name, and registers it", async () => {
    const { harness } = await load();
    const names = ["fleets", "threadFleet", "fleetDetail", "ledger", "sendAction", "settings", "saveCredential", "removeCredential", "setInterval"];
    expect(Object.keys(rpcContract).sort()).toEqual([...names].sort());
    expect([...harness.registrations.rpcMethods].sort()).toEqual([...names].sort());
  });

  it("shows an empty page with no fleet registered (AC15)", async () => {
    const { call } = await load();
    expect(await call<FleetsView>("fleets")).toMatchObject({ waiting: 0, fleets: [], inbox: [], landed: [] });
  });

  it("shows a registered fleet's Inbox, its card with the manager's state and its cost, and the same on the Fleet tab (AC1 to AC3, AC8, AC14)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7), "\n## Standing orders\n\nMerge anything green.\n"));
    const { harness, call } = await load();
    await register(harness, manifest);

    const page = await call<FleetsView>("fleets");
    expect(page.waiting).toBe(1);
    expect(page.inbox).toHaveLength(1);
    expect(page.inbox[0]).toMatchObject({ fleet: REPO, managerThreadId: MANAGER, ref: "#7", offer: { kind: "answer", label: "Answer…" } });
    expect(page.fleets[0]).toMatchObject({
      repo: REPO,
      manager: { state: "working", since: "2026-10-12T09:30:00.000Z" },
      waiting: 1,
      cost: { amount: 1.75, currency: "USD", period: "since this manager started" },
    });

    const detail = await call<Result<{ detail: { manifest: { status: string; written: unknown[] } } }>>("fleetDetail", { repo: REPO });
    expect(detail).toMatchObject({ ok: true, detail: { manifest: { status: "ok", written: [{ heading: "Standing orders", markdown: "Merge anything green." }] } } });
  });

  it("leaves the cost out, with no error, without Thread Usage or when its answer cannot be read (AC14)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    for (const report of [() => Promise.reject(new Error("plugin thread-usage is not installed")), async () => ({ currency: "USD" })]) {
      const { harness, call } = await load({ report });
      await register(harness, manifest);
      const card = (await call<FleetsView>("fleets")).fleets[0] as FleetCardView;
      expect(card.cost).toBeNull();
      expect(harness.logEntries.map((entry) => JSON.stringify(entry)).join("")).not.toContain("currency");
    }
  });

  it("names the manager holding the thread's repository for a thread that runs no fleet, and the card for the manager (AC9)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call } = await load();
    await register(harness, manifest);
    expect(await call<ThreadFleetView>("threadFleet", { threadId: MANAGER })).toMatchObject({ kind: "manager", card: { repo: REPO } });
    expect(await call<ThreadFleetView>("threadFleet", { threadId: "thr_other" })).toEqual({ kind: "none", holder: { repo: REPO, managerThreadId: MANAGER } });
  });

  it("has no holder for a thread whose project has no remote", async () => {
    const { call } = await load({ remote: null });
    expect(await call<ThreadFleetView>("threadFleet", { threadId: "thr_other" })).toEqual({ kind: "none", holder: null });
  });

  it("sends an action to the manager as a plain prompt queued behind its turn, keeps it sent for every window, and refuses a second (AC13)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call, sent } = await load();
    await register(harness, manifest);
    const rowId = (await call<FleetsView>("fleets")).inbox[0]!.id;

    const result = await call<Result<{ action: { state: string } }>>("sendAction", { fleet: REPO, rowId, kind: "answer", text: "Go with B.\nThanks." });
    expect(result).toMatchObject({ ok: true, action: { state: "sent", kind: "answer", ref: "#7" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ threadId: MANAGER, mode: "queue-if-active" });
    expect(sent[0]!.input[0]!.text).toBe("Answer to #7: Go with B.\nThanks.");
    expect(harness.realtimeSignals.some((signal) => signal.channel === "board-changed")).toBe(true);

    expect((await call<FleetsView>("fleets")).inbox[0]).toMatchObject({ offer: null, action: { state: "sent" } });
    expect(await call("sendAction", { fleet: REPO, rowId, kind: "answer", text: "again" })).toMatchObject({ ok: false });
    expect(sent).toHaveLength(1);
  });

  it("answers bb's reason when bb refuses the message, records nothing, and leaves the row its action (AC13)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call } = await load({ send: () => Promise.reject(Object.assign(new Error("HTTP 409 conflict: Go with B"), { status: 409 })) });
    await register(harness, manifest);
    const rowId = (await call<FleetsView>("fleets")).inbox[0]!.id;
    const result = await call<Result<unknown>>("sendAction", { fleet: REPO, rowId, kind: "answer", text: "Go with B" });
    expect(result).toEqual({ ok: false, reason: "HTTP 409" });
    expect((await call<FleetsView>("fleets")).inbox[0]).toMatchObject({ offer: { kind: "answer" }, action: null });
  });

  it("refuses inputs that are not the contract's", async () => {
    const { call } = await load();
    await expect(call("sendAction", { fleet: REPO, rowId: "x", kind: "answer", text: "a", extra: true })).rejects.toThrow();
    await expect(call("sendAction", { fleet: REPO, rowId: "x", kind: "delete" })).rejects.toThrow();
    await expect(call("sendAction", { fleet: REPO, rowId: "x", kind: "answer", text: "x".repeat(20_001) })).rejects.toThrow();
    await expect(call("ledger", { repo: REPO, filter: { limit: 1000 } })).rejects.toThrow();
    await expect(call("setInterval", { repo: REPO, seconds: "30" })).rejects.toThrow();
    await expect(call("threadFleet", {})).rejects.toThrow();
  });

  it("opens the ledger of a fleet, and refuses one that is not registered (AC12)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call } = await load();
    await register(harness, manifest);
    expect(await call("ledger", { repo: REPO, filter: { item: "#7", done: "echo", limit: 10 } })).toMatchObject({ ok: true, ledger: { changes: [], dropped: [], wakes: [] } });
    expect(await call("ledger", { repo: "github.example/org/none" })).toMatchObject({ ok: false });
  });
});

describe("the settings section through the RPC (AC16)", () => {
  it("lists the credentials, adds one with a token that no output, log or signal carries, and removes it", async () => {
    const { harness, call } = await load();
    const listed = await call<SettingsView>("settings");
    expect(listed.credentials).toEqual([{ prefix: "github.example/org", auth: "token", service: "github", baseUrl: "http://127.0.0.1:1", hasToken: true, expiresAt: null, problem: null }]);

    const added = await call<Result<{ settings: SettingsView }>>("saveCredential", { prefix: "github.com/other", auth: "token", token: NEW_TOKEN });
    expect(added).toMatchObject({ ok: true, settings: { credentials: [{ prefix: "github.example/org" }, { prefix: "github.com/other", hasToken: true }] } });
    const refused = await call<Result<unknown>>("saveCredential", { prefix: "git.nowhere.net/x", auth: "token", token: NEW_TOKEN });
    expect(refused).toMatchObject({ ok: false });
    const removed = await call<Result<{ settings: SettingsView }>>("removeCredential", { prefix: "github.com/other" });
    expect(removed).toMatchObject({ ok: true, settings: { credentials: [{ prefix: "github.example/org" }] } });

    const everything = JSON.stringify([listed, added, refused, removed, harness.logEntries, harness.realtimeSignals]);
    expect(everything).not.toContain(NEW_TOKEN);
    expect(everything).not.toContain(TOKEN);
  });

  it("sets a fleet's interval in seconds, refusing under 30", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call } = await load();
    await register(harness, manifest);
    expect(await call("setInterval", { repo: REPO, seconds: 29 })).toMatchObject({ ok: false });
    expect(await call("setInterval", { repo: REPO, seconds: 45 })).toMatchObject({ ok: true, settings: { fleets: [{ repo: REPO, intervalMs: 45_000, isDefault: false }] } });
    expect(await call("setInterval", { repo: REPO, seconds: null })).toMatchObject({ ok: true, settings: { fleets: [{ intervalMs: 120_000, isDefault: true }] } });
  });
});

describe("the signals the pages listen for", () => {
  const idle = (harness: Awaited<ReturnType<typeof load>>["harness"]) => harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: MANAGER }), lastAssistantText: null });

  it("announces nothing for the rows there when the fleet registered, tells the windows the board changed, and announces a row the manager adds once (AC6)", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness } = await load({ noCredential: true });
    await register(harness, manifest);
    const signals = (channel: string) => harness.realtimeSignals.filter((signal) => signal.channel === channel);
    await idle(harness);
    // The registration's signal went out at once; the read after it, within the second, waits and goes out as one.
    expect(signals("board-changed")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(signals("board-changed")).toHaveLength(2);
    expect(signals("inbox-new")).toEqual([]);

    writeFileSync(manifest, manifestText(`${row(7)}\n${row(8, "grant")}`));
    await idle(harness);
    await idle(harness);
    expect(signals("inbox-new")).toEqual([{ channel: "inbox-new", payload: { fleet: REPO, ref: "#8", what: "A parked question", rowId: "#8|grant|2026-10-12T09:00:00Z" } }]);
  });

  it("shows an action done once a poll sees the row gone", async () => {
    const manifest = join(dir, "manifest.md");
    writeFileSync(manifest, manifestText(row(7)));
    const { harness, call } = await load({ noCredential: true });
    await register(harness, manifest);
    const rowId = (await call<FleetsView>("fleets")).inbox[0]!.id;
    await call("sendAction", { fleet: REPO, rowId, kind: "answer", text: "B" });
    writeFileSync(manifest, manifestText(""));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await idle(harness);
    const page = await call<FleetsView>("fleets");
    expect(page.inbox).toEqual([]);
    expect(page.recentActions).toMatchObject([{ kind: "answer", ref: "#7", state: "done" }]);
  });
});
