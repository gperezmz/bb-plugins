/**
 * Activation as bb times it: bb fails a plugin whose factory takes more than
 * 30 seconds, and on a server that has just started bb.sdk can take all of
 * them to answer. So the factory must not wait on bb.sdk, the network or the
 * provider logs; the services do that work after it returns.
 */
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../server";
import type { SettingsStatus } from "../../src/core/report-types";

const never = () => new Promise<never>(() => {});

let started: FakePluginHost | null = null;
afterEach(async () => {
  await started?.harness.lifecycle.dispose();
  started = null;
  vi.unstubAllGlobals();
});

describe("Activation, as wired in server.ts", () => {
  it("returns without waiting on bb.sdk, the network or the logs, and answers before the services have run", async () => {
    const fetchStub = vi.fn(never);
    vi.stubGlobal("fetch", fetchStub);
    // Every call the services make hangs, as bb.sdk can on a server that is still starting.
    const host = createFakePluginHost({
      pluginId: "thread-usage",
      sdk: {
        providers: { list: never },
        projects: { list: never },
        threads: { list: never, get: never, events: { list: never } },
        environments: { get: never },
        hosts: { get: never },
      },
    });
    started = host;
    const timedOut = Symbol("timed out");
    const result = await Promise.race([
      plugin(host.bb).then(() => "loaded"),
      new Promise<symbol>((resolve) => setTimeout(() => resolve(timedOut), 2_000)),
    ]);
    expect(result).toBe("loaded");
    expect(host.harness.inspection.sdk.calls).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(host.harness.inspection.experimental_hostRpcCalls).toEqual([]);

    // The harnesses it tags by name are tagged from the start.
    expect([...host.harness.inspection.registrations.providerEnvResolvers.keys()]).toEqual(["claude-code", "codex", "pi"]);

    // With the services stuck, the settings page still answers with what the plugin has.
    for (const name of ["backfill", "online-prices", "provider-env"]) host.harness.behavior.runService(name);
    const status = (await host.harness.behavior.callRpc("status", null)) as SettingsStatus;
    expect(status.snapshot.online).toBe(false);
    expect(status.threadsTracked).toBe(0);
  });

  it("tags the other providers bb lists once the provider-env service runs", async () => {
    const host = createFakePluginHost({
      pluginId: "thread-usage",
      sdk: { providers: { list: async () => [{ id: "codex" }, { id: "acme" }] } },
    });
    started = host;
    await plugin(host.bb);
    await host.harness.behavior.runService("provider-env").done;
    expect([...host.harness.inspection.registrations.providerEnvResolvers.keys()]).toEqual(["claude-code", "codex", "pi", "acme"]);
  });
});
