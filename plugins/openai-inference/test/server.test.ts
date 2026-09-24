import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";

const start = async () => {
  const fake = createFakePluginHost({
    pluginId: "openai-inference",
    sdk: { system: { config: async () => ({ primaryHostId: "host_primary" }) } as never },
    experimental_callHostRpc: () => null,
  });
  await plugin(fake.bb);
  return fake.harness;
};

describe("server entry", () => {
  it("registers the gateway and local inference services", async () => {
    const harness = await start();
    expect(harness.inspection.registrations.aiServiceRegistrations.map((s) => [s.id, s.kinds])).toEqual([
      ["gateway", ["inference"]],
      ["local", ["inference"]],
    ]);
  });

  it("sends the settings to the primary host at start and on every change", async () => {
    const harness = await start();
    const service = harness.behavior.runService("send-settings");
    await expect.poll(() => harness.inspection.experimental_hostRpcCalls.length).toBe(1);
    expect(harness.inspection.experimental_hostRpcCalls[0]).toMatchObject({
      method: "configure",
      hostId: "host_primary",
      input: { gateway: { baseUrl: null, apiKey: null }, local: { baseUrl: null, apiKey: null } },
    });

    await harness.behavior.setSettings({ localUrl: "http://127.0.0.1:8080/v1", gatewayKey: "sk-test" });
    await expect.poll(() => harness.inspection.experimental_hostRpcCalls.length).toBe(2);
    expect(harness.inspection.experimental_hostRpcCalls[1].input).toEqual({
      gateway: { baseUrl: null, apiKey: "sk-test" },
      local: { baseUrl: "http://127.0.0.1:8080/v1", apiKey: null },
    });
    service.controller.abort();
    await service.done;
  });

  it("refuses a base URL that is not http or https", async () => {
    const harness = await start();
    await expect(harness.behavior.setSettings({ gatewayUrl: "gateway.example.com" })).rejects.toThrow();
    await expect(harness.behavior.setSettings({ gatewayUrl: "https://gateway.example.com/v1" })).resolves.not.toThrow();
  });
});
