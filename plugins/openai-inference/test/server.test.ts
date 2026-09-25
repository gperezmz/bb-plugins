import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";

/** Starts the plugin with a host entry that lacks the variables in `unset`. */
const start = async (settings: Record<string, string> = {}, unset: string[] = []) => {
  const fake = createFakePluginHost({
    pluginId: "openai-inference",
    settings,
    sdk: { system: { config: async () => ({ primaryHostId: "host_primary" }) } as never },
    experimental_callHostRpc: ({ input }) =>
      (input as Array<{ id: string; url: string; key: string | null }>).map((e) => ({
        id: e.id,
        missing: unset.filter((name) => `${e.url} ${e.key}`.includes(`\${${name}}`)),
      })),
  });
  await plugin(fake.bb);
  const service = fake.harness.behavior.runService("send-endpoints");
  await expect.poll(() => fake.harness.inspection.experimental_hostRpcCalls.length).toBe(1);
  return { harness: fake.harness, stop: async () => (service.controller.abort(), await service.done) };
};

const serviceIds = (harness: Awaited<ReturnType<typeof start>>["harness"]) =>
  harness.inspection.registrations.aiServiceRegistrations.map((s) => s.id);

const gatewayByReference = '{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}"}';

describe("server entry", () => {
  it("sends the endpoints unexpanded to the primary host and registers each", async () => {
    const { harness, stop } = await start({
      endpoints: `[{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}, ${gatewayByReference}]`,
      keys: '{"mlx": "sk-mlx"}',
    });
    expect(harness.inspection.experimental_hostRpcCalls[0]).toMatchObject({
      method: "configure",
      hostId: "host_primary",
      input: [
        { id: "mlx", url: "http://127.0.0.1:8080/v1", key: "sk-mlx" },
        { id: "gateway", url: "${GATEWAY_URL}", key: "${GATEWAY_VIRTUAL_KEY}" },
      ],
    });
    await expect.poll(() => serviceIds(harness)).toEqual(["mlx", "gateway"]);
    await stop();
  });

  it("registers no endpoint whose variables the host lacks, and logs why", async () => {
    const { harness, stop } = await start({ endpoints: `[${gatewayByReference}]` }, ["GATEWAY_URL"]);
    await expect
      .poll(() => harness.inspection.logEntries.map((e) => e.message))
      .toContain('Endpoint "gateway" is not registered: not set in bb\'s environment: GATEWAY_URL');
    expect(serviceIds(harness)).toEqual([]);
    await stop();
  });

  it("lets a literal key in keys win over the endpoint's reference", async () => {
    const { harness, stop } = await start({ endpoints: `[${gatewayByReference}]`, keys: '{"gateway": "sk-setting"}' });
    expect(harness.inspection.experimental_hostRpcCalls[0].input).toEqual([
      { id: "gateway", url: "${GATEWAY_URL}", key: "sk-setting" },
    ]);
    await stop();
  });

  it("adds and removes services when the endpoints change, without a reload", async () => {
    const { harness, stop } = await start({ endpoints: '[{"id": "mlx", "url": "http://127.0.0.1:8080/v1"}]' });
    await expect.poll(() => serviceIds(harness)).toEqual(["mlx"]);
    await harness.behavior.setSettings({ endpoints: '[{"id": "lmstudio", "url": "http://127.0.0.1:1234/v1"}]' });
    await expect.poll(() => serviceIds(harness)).toEqual(["lmstudio"]);
    await stop();
  });

  it.each([
    ["not JSON", "[{"],
    ["an id with a capital", '[{"id": "MLX", "url": "http://127.0.0.1:8080/v1"}]'],
    ["an id with a slash", '[{"id": "a/b", "url": "http://127.0.0.1:8080/v1"}]'],
    ["a url without a scheme", '[{"id": "mlx", "url": "127.0.0.1:8080/v1"}]'],
    ["an id twice", '[{"id": "a", "url": "http://a.example.com"}, {"id": "a", "url": "http://b.example.com"}]'],
    ["a literal key", '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "sk-plain"}]'],
    ["a key with more than a reference", '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "Bearer ${KEY}"}]'],
  ])("refuses endpoints with %s", async (_name, endpoints) => {
    const { harness, stop } = await start();
    await expect(harness.behavior.setSettings({ endpoints })).rejects.toThrow();
    await stop();
  });

  it("tells the user where a literal key goes", async () => {
    const { harness, stop } = await start();
    await expect(
      harness.behavior.setSettings({ endpoints: '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "sk-plain"}]' }),
    ).rejects.toThrow("put a literal key in Endpoint keys");
    await stop();
  });

  it("accepts a url that references a variable whole or embedded", async () => {
    const { harness, stop } = await start();
    await expect(
      harness.behavior.setSettings({ endpoints: '[{"id": "a", "url": "${A_URL}"}, {"id": "b", "url": "https://${B_HOST}/v1"}]' }),
    ).resolves.not.toThrow();
    await stop();
  });

  it("refuses keys that are not a JSON object of strings", async () => {
    const { harness, stop } = await start();
    await expect(harness.behavior.setSettings({ keys: '["sk-test"]' })).rejects.toThrow();
    await stop();
  });
});
