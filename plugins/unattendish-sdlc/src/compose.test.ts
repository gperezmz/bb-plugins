// The composition root against the SDK's fake host: what runs behind a poll.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compose } from "./compose";
import type { RegisterArgs } from "./fleet/domain/registration";

const REPO = "github.example/org/repo";
const MANAGER = "thr_manager";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unattendish-compose-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A fetch that holds every request until `release` and then answers 404, as a slow service would. */
const slowService = () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    requests.push(String(input instanceof Request ? input.url : input));
    await released;
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, release, requests };
};

const load = async (fetch: typeof globalThis.fetch) => {
  const manifest = join(dir, "manifest.md");
  writeFileSync(manifest, `# Fleet: ${REPO}\n\n## Inbox\n\n| Ref | What | Waits for | Since | Link |\n| --- | --- | --- | --- | --- |\n| #7 | A parked question | answer | 2026-10-12T09:00:00Z | https://${REPO}/issues/7 |\n`);
  const host = createFakePluginHost({
    pluginId: "unattendish-sdlc",
    settings: {
      credentials: JSON.stringify([{ prefix: "github.example/org", auth: "token", service: "github", baseUrl: "https://github.example/api/v3" }]),
      tokens: JSON.stringify({ "github.example/org": "ghp_compose_test_token_value" }),
    },
    sdk: { threads: { get: async () => ({ id: MANAGER, archivedAt: null, deletedAt: null }), send: async () => ({ delivery: "sent", ok: true }) } },
  });
  const fleets = await compose(host.bb, { fetch });
  const args: RegisterArgs = {
    contract: 1,
    repo: REPO,
    tracker: "forge-issues",
    manifest,
    operator: "olivia",
    labelSpec: "spec",
    labelReady: "ready",
    labelInProgress: "in-progress",
    labelNeedsInput: "needs-input",
    marker: "🤖 unattendish agent",
    echoActors: [],
  };
  return { fleets, args };
};

const registered = (fleets: Awaited<ReturnType<typeof load>>["fleets"]) => fleets.app.status().then((all) => all.length);
const waitFor = async (until: () => boolean) => {
  for (let waited = 0; !until() && waited < 200; waited += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("work that changes a fleet runs behind a poll of it", () => {
  it("removes the registration only once a poll in flight has ended, so the poll cannot write the fleet back", async () => {
    const service = slowService();
    const { fleets, args } = await load(service.fetch);
    await fleets.app.register(MANAGER, args);
    const polling = fleets.pollDue();
    await waitFor(() => service.requests.length > 0);
    expect(service.requests.length).toBeGreaterThan(0);

    expect(fleets.app.unregister(REPO)).toBe(true);
    expect(await registered(fleets)).toBe(1);
    service.release();
    await polling;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await registered(fleets)).toBe(0);
    expect(fleets.app.unregister(REPO)).toBe(false);
  });

  it("registers behind a poll in flight", async () => {
    const service = slowService();
    const { fleets, args } = await load(service.fetch);
    await fleets.app.register(MANAGER, args);
    const polling = fleets.pollDue();
    await waitFor(() => service.requests.length > 0);

    let outcome: string | undefined;
    const registering = fleets.app.register(MANAGER, { ...args, marker: "changed marker" }).then((result) => (outcome = result.outcome));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcome).toBeUndefined();
    service.release();
    await Promise.all([polling, registering]);
    expect(outcome).toBe("registered");
  });

  it("sets an interval behind a poll in flight, and answers from the registry at once", async () => {
    const service = slowService();
    const { fleets, args } = await load(service.fetch);
    await fleets.app.register(MANAGER, args);
    const polling = fleets.pollDue();
    await waitFor(() => service.requests.length > 0);

    expect(fleets.app.setInterval(REPO, 45_000)).toBe(true);
    expect(fleets.app.setInterval("github.example/org/unknown", 45_000)).toBe(false);
    expect((await fleets.app.status())[0]!.intervalMs).toBe(120_000);
    service.release();
    await polling;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await fleets.app.status())[0]!.intervalMs).toBe(45_000);
  });

  it("registers an unparsable repository without waiting for anything, and says it is invalid", async () => {
    const { fleets, args } = await load(slowService().fetch);
    expect(await fleets.app.register(MANAGER, { ...args, repo: "not a repository" })).toMatchObject({ outcome: "invalid" });
  });
});
