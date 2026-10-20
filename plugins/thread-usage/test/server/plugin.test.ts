/**
 * The price refresh as server.ts wires it: the one-time reset of the old
 * default, the service that fetches models.dev's list, and the setting that
 * turns it on and off, driven through the SDK's fake plugin host.
 */
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../server";
import type { PricesInfo, SettingsStatus } from "../../src/core/report-types";
import { MODELS_DEV_URL } from "../../src/core/models-dev";

const fetchStub = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url === MODELS_DEV_URL) {
    const models = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`model-${i}`, { cost: { input: 1, output: 2 } }]));
    return new Response(JSON.stringify({ acme: { models } }));
  }
  throw new Error(`unexpected ${url}`);
});

let started: FakePluginHost | null = null;
async function load(settings: Record<string, boolean>) {
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockClear();
  const host = createFakePluginHost({ pluginId: "thread-usage", settings });
  await plugin(host.bb);
  started = host;
  const call = <T,>(method: string, input: unknown = null) => host.harness.behavior.callRpc(method, input) as Promise<T>;
  return { host, status: () => call<SettingsStatus>("status"), top: () => call<{ prices: PricesInfo }>("top", { projectId: null, sinceDays: 7 }) };
}

afterEach(async () => {
  await started?.harness.lifecycle.dispose();
  started = null;
  vi.unstubAllGlobals();
});

const fetchedAt = (s: SettingsStatus) => s.prices.updatedAt;

describe("Refresh prices online, as wired in server.ts", () => {
  it("resets a stored false to on at load, once, and the service then fetches models.dev's list", async () => {
    const { host, status, top } = await load({ refreshPrices: false });
    expect(fetchedAt(await status())).toBeNull();
    host.harness.behavior.runService("online-prices");
    await vi.waitFor(async () => expect(fetchedAt(await status())).not.toBeNull());
    const s = await status();
    expect(s.prices).toMatchObject({ refreshOn: true, lastError: null, models: 120 });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect((await top()).prices.updatedAt).toBe(s.prices.updatedAt);
    // The open panels are told to reload their figures.
    expect(host.harness.inspection.realtimeSignals.some((r) => r.channel === "usage-changed")).toBe(true);
  });

  it("uses the bundled list until a fetch succeeds, falls back to it while the setting is off, and uses the fetched copy again when it is turned on", async () => {
    const { host, status, top } = await load({ refreshPrices: false });
    // Not fetched yet: the bundled copy, which holds far more than the stub's 120 models.
    expect((await status()).prices.models).toBeGreaterThan(1000);
    host.harness.behavior.runService("online-prices");
    await vi.waitFor(async () => expect(fetchedAt(await status())).not.toBeNull());
    expect((await status()).prices.models).toBe(120);
    await host.harness.behavior.setSettings({ refreshPrices: false });
    expect(fetchedAt(await status())).toBeNull();
    expect((await status()).prices.models).toBeGreaterThan(1000);
    expect((await top()).prices).toMatchObject({ updatedAt: null, refreshOn: false });
    fetchStub.mockClear();
    await host.harness.behavior.setSettings({ refreshPrices: true });
    // The copy fetched earlier is under a day old: nothing is refetched.
    expect(fetchStub).not.toHaveBeenCalled();
    expect(fetchedAt(await status())).not.toBeNull();
  });

  it("keeps a deliberate off across a reload: the reset ran once and the service fetches nothing", async () => {
    const first = await load({});
    await first.host.harness.behavior.setSettings({ refreshPrices: false });
    const next = await first.host.harness.lifecycle.reload(plugin);
    started = next;
    fetchStub.mockClear();
    next.harness.behavior.runService("online-prices");
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchStub).not.toHaveBeenCalled();
    const status = (await next.harness.behavior.callRpc("status", null)) as SettingsStatus;
    expect(status.prices).toMatchObject({ updatedAt: null, refreshOn: false });
  });

  it("turning the setting on with no copy fetches at once, without waiting for the hourly loop", async () => {
    const { host, status } = await load({});
    await host.harness.behavior.setSettings({ refreshPrices: false });
    expect(fetchStub).not.toHaveBeenCalled();
    await host.harness.behavior.setSettings({ refreshPrices: true });
    await vi.waitFor(async () => expect(fetchedAt(await status())).not.toBeNull());
  });
});
