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
import { SETTINGS } from "../../src/server/settings";

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

    // With the services stuck, the settings page still answers with what the plugin has.
    for (const name of ["backfill", "online-prices"]) host.harness.behavior.runService(name);
    const status = (await host.harness.behavior.callRpc("status", null)) as SettingsStatus;
    expect(status.prices.updatedAt).toBeNull();
    expect(status.threadsTracked).toBe(0);
  });

  it("has no gateway surface: it tags no provider's requests and runs no sweep", async () => {
    const host = createFakePluginHost({ pluginId: "thread-usage", sdk: { providers: { list: async () => [{ id: "codex" }] } } });
    started = host;
    await plugin(host.bb);
    expect([...host.harness.inspection.registrations.providerEnvResolvers.keys()]).toEqual([]);
    expect(() => host.harness.behavior.runService("gateway-sweep")).toThrow();
    expect(() => host.harness.behavior.runService("provider-env")).toThrow();
    expect(await host.harness.behavior.callRpc("status", null)).not.toHaveProperty("gateway");
    await expect(host.harness.behavior.callRpc("testConnection", null)).rejects.toThrow();
  });

  it("declares no gateway adapter, URL, read key, extra headers, or price overrides and aliases", () => {
    expect(Object.keys(SETTINGS).sort()).toEqual(
      ["billingClaudeCode", "billingCodex", "billingOther", "billingPi", "currency", "readLogs", "refreshPrices", "showAmount", "warnAbove"],
    );
    const options = (SETTINGS.billingClaudeCode as { options: string[] }).options;
    expect(options).toEqual(["auto", "api-key", "subscription"]);
    // Nothing declared is a secret, so the plugin reads none, and an old gateway read key stays where bb keeps it.
    expect(Object.values(SETTINGS).some((d) => "secret" in d)).toBe(false);
  });
});
