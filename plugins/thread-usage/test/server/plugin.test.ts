/**
 * The price refresh as server.ts wires it: the one-time reset of the old
 * default, the service that fetches, and the setting that turns it on and
 * off, driven through the SDK's fake plugin host.
 */
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../server";
import type { PricesInfo, SettingsStatus } from "../../src/core/report-types";
import { MODELS_DEV_URL } from "../../src/server/public-prices";
import { LITELLM_PRICES_URL } from "../../src/server/snapshot";

const body = (extra: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...extra };
  for (let i = 0; i < 120; i++) out[`model-${i}`] = { mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
  return out;
};
const fetchStub = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url === LITELLM_PRICES_URL) return new Response(JSON.stringify(body({})));
  if (url === MODELS_DEV_URL) {
    return new Response(JSON.stringify({ acme: { models: Object.fromEntries(Object.entries(body({})).map(([k, v]) => [k, { cost: { input: 1, output: 2 }, v }])) } }));
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

describe("Refresh prices online, as wired in server.ts", () => {
  it("resets a stored false to on at load, once, and the service then fetches both lists", async () => {
    const { host, status, top } = await load({ refreshPrices: false });
    expect((await status()).snapshot.online).toBe(false);
    host.harness.behavior.runService("online-prices");
    await vi.waitFor(async () => expect((await status()).snapshot.online).toBe(true));
    const s = await status();
    expect(s.snapshot.onlineFetchedAt).not.toBeNull();
    expect(s.snapshot.modelsDevFetchedAt).not.toBeNull();
    expect(s.snapshot.lastError).toBeNull();
    expect((await top()).prices.updatedAt).toBe(s.snapshot.onlineFetchedAt);
    // The open panels are told to reload their figures.
    expect(host.harness.inspection.realtimeSignals.some((r) => r.channel === "usage-changed")).toBe(true);
  });

  it("falls back to the bundled list while the setting is off, and uses the fetched copy again when it is turned on", async () => {
    const { host, status, top } = await load({ refreshPrices: false });
    host.harness.behavior.runService("online-prices");
    await vi.waitFor(async () => expect((await status()).snapshot.online).toBe(true));
    await host.harness.behavior.setSettings({ refreshPrices: false });
    expect((await status()).snapshot.online).toBe(false);
    expect((await top()).prices).toMatchObject({ updatedAt: null, refreshOn: false });
    fetchStub.mockClear();
    await host.harness.behavior.setSettings({ refreshPrices: true });
    // The copy fetched earlier is under a day old: nothing is refetched.
    expect(fetchStub).not.toHaveBeenCalled();
    expect((await status()).snapshot.online).toBe(true);
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
    expect(status.snapshot.online).toBe(false);
  });

  it("turning the setting on with no copy fetches at once, without waiting for the hourly loop", async () => {
    const { host, status } = await load({});
    await host.harness.behavior.setSettings({ refreshPrices: false });
    expect(fetchStub).not.toHaveBeenCalled();
    await host.harness.behavior.setSettings({ refreshPrices: true });
    await vi.waitFor(async () => expect((await status()).snapshot.online).toBe(true));
  });
});
