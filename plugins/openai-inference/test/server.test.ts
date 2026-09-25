import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../server.js";

afterEach(() => vi.unstubAllEnvs());

const start = async (settings: Record<string, string> = {}) => {
  const fake = createFakePluginHost({
    pluginId: "openai-inference",
    settings,
    sdk: { system: { config: async () => ({ primaryHostId: "host_primary" }) } as never },
    experimental_callHostRpc: () => null,
  });
  await plugin(fake.bb);
  return fake.harness;
};

const serviceIds = (harness: Awaited<ReturnType<typeof start>>) =>
  harness.inspection.registrations.aiServiceRegistrations.map((s) => s.id);

describe("server entry", () => {
  it("registers each listed endpoint, and gateway from GATEWAY_URL", async () => {
    vi.stubEnv("GATEWAY_URL", "https://gateway.example.com/v1");
    vi.stubEnv("GATEWAY_VIRTUAL_KEY", "sk-env");
    const harness = await start({ endpoints: '[{"id": "mlx", "url": "http://127.0.0.1:8080/v1/"}]' });
    expect(serviceIds(harness)).toEqual(["mlx", "gateway"]);

    const service = harness.behavior.runService("send-endpoints");
    await expect.poll(() => harness.inspection.experimental_hostRpcCalls.length).toBe(1);
    expect(harness.inspection.experimental_hostRpcCalls[0]).toMatchObject({
      method: "configure",
      hostId: "host_primary",
      input: [
        { id: "mlx", url: "http://127.0.0.1:8080/v1", key: null },
        { id: "gateway", url: "https://gateway.example.com/v1", key: "sk-env" },
      ],
    });
    service.controller.abort();
    await service.done;
  });

  it("registers no gateway without GATEWAY_URL", async () => {
    vi.stubEnv("GATEWAY_URL", "");
    expect(serviceIds(await start())).toEqual([]);
  });

  it("lets a listed gateway and its key replace the environment's", async () => {
    vi.stubEnv("GATEWAY_URL", "https://env.example.com/v1");
    vi.stubEnv("GATEWAY_VIRTUAL_KEY", "sk-env");
    const harness = await start({
      endpoints: '[{"id": "gateway", "url": "https://gateway.example.com/v1"}]',
      keys: '{"gateway": "sk-setting"}',
    });
    const service = harness.behavior.runService("send-endpoints");
    await expect.poll(() => harness.inspection.experimental_hostRpcCalls.length).toBe(1);
    expect(harness.inspection.experimental_hostRpcCalls[0].input).toEqual([
      { id: "gateway", url: "https://gateway.example.com/v1", key: "sk-setting" },
    ]);
    service.controller.abort();
    await service.done;
  });

  it("adds and removes services when the endpoints change, without a reload", async () => {
    vi.stubEnv("GATEWAY_URL", "");
    const harness = await start({ endpoints: '[{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}]' });
    await harness.behavior.setSettings({ endpoints: '[{"id": "lmstudio", "url": "http://127.0.0.1:1234/v1"}]' });
    expect(serviceIds(harness)).toEqual(["lmstudio"]);
    await expect.poll(() => harness.inspection.experimental_hostRpcCalls.at(-1)?.input).toEqual([
      { id: "lmstudio", url: "http://127.0.0.1:1234/v1", key: null },
    ]);
  });

  it.each([
    ["not JSON", "[{"],
    ["an id with a capital", '[{"id": "MLX", "url": "http://127.0.0.1:8080/v1"}]'],
    ["an id with a slash", '[{"id": "a/b", "url": "http://127.0.0.1:8080/v1"}]'],
    ["a url without a scheme", '[{"id": "mlx", "url": "127.0.0.1:8080/v1"}]'],
    ["an id twice", '[{"id": "a", "url": "http://a.example.com"}, {"id": "a", "url": "http://b.example.com"}]'],
  ])("refuses endpoints with %s", async (_name, endpoints) => {
    const harness = await start();
    await expect(harness.behavior.setSettings({ endpoints })).rejects.toThrow();
  });

  it("refuses keys that are not a JSON object of strings", async () => {
    const harness = await start();
    await expect(harness.behavior.setSettings({ keys: '["sk-test"]' })).rejects.toThrow();
    await expect(harness.behavior.setSettings({ keys: '{"mlx": "sk-test"}' })).resolves.not.toThrow();
  });
});
