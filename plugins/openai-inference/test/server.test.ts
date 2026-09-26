import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";

type Call = { method: string; input: unknown; hostId: string; signal?: AbortSignal };

/**
 * Starts the plugin with a host entry that lacks the variables in `unset`
 * and answers each completion with `answer`.
 */
const start = async (
  settings: Record<string, string> = {},
  { unset = [] as string[], answer = (_call: Call): unknown => ({ ok: true, text: "A title" }) } = {},
) => {
  const fake = createFakePluginHost({
    pluginId: "openai-inference",
    settings,
    sdk: { system: { config: async () => ({ primaryHostId: "host_primary" }) } as never },
    experimental_callHostRpc: (call) =>
      call.method === "configure"
        ? (call.input as Array<{ id: string; url: string; key: string | null }>).map((e) => ({
            id: e.id,
            missing: unset.filter((name) => `${e.url} ${e.key}`.includes(`\${${name}}`)),
          }))
        : answer(call),
  });
  await plugin(fake.bb);
  const service = fake.harness.behavior.runService("send-endpoints");
  await expect.poll(() => configureCalls(fake.harness).length).toBe(1);
  return { harness: fake.harness, stop: async () => (service.controller.abort(), await service.done) };
};
type Harness = Awaited<ReturnType<typeof start>>["harness"];

const configureCalls = (harness: Pick<Harness, "inspection">) =>
  harness.inspection.experimental_hostRpcCalls.filter((c) => c.method === "configure");
const services = (harness: Harness) => harness.inspection.registrations.aiServiceRegistrations;
const serviceIds = (harness: Harness) => services(harness).map((s) => s.id);
const service = (harness: Harness, id: string) => {
  const found = services(harness).find((s) => s.id === id);
  if (found === undefined) throw new Error(`no service ${id}`);
  return found;
};
const status = (harness: Harness, id: string) => service(harness, id).status!();
const warnings = (harness: Harness) => harness.inspection.logEntries.filter((e) => e.level === "warn" || e.level === "error");

const mlx = '{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"}';
const gatewayByReference = '{"id": "gateway", "url": "${GATEWAY_URL}", "key": "${GATEWAY_VIRTUAL_KEY}", "model": "gpt-6-luna"}';

describe("registration", () => {
  it("sends the Endpoints unexpanded to the primary host and registers each as a text service", async () => {
    const { harness, stop } = await start({ endpoints: `[${mlx}, ${gatewayByReference}]`, keys: '{"mlx": "sk-mlx"}' });
    expect(configureCalls(harness)[0]).toMatchObject({
      hostId: "host_primary",
      input: [
        { id: "mlx", url: "http://127.0.0.1:8080/v1", key: "sk-mlx", model: "qwen3-4b" },
        { id: "gateway", url: "${GATEWAY_URL}", key: "${GATEWAY_VIRTUAL_KEY}", model: "gpt-6-luna" },
      ],
    });
    expect(serviceIds(harness)).toEqual(["mlx", "gateway"]);
    for (const s of services(harness)) {
      expect(s.complete).toBeTypeOf("function");
      expect(s.status).toBeTypeOf("function");
      expect(s.transcribe).toBeUndefined();
    }
    expect(warnings(harness)).toEqual([]);
    await stop();
  });

  it.each([["unset", {}], ["empty", { endpoints: "[]" }]])("logs nothing when endpoints is %s", async (_name, settings) => {
    const { harness, stop } = await start(settings);
    expect(serviceIds(harness)).toEqual([]);
    expect(warnings(harness)).toEqual([]);
    await stop();
  });

  it("keeps a long URL's display name within bb's 64 characters", async () => {
    const url = "http://a-long-machine-name.example-network.example.com:8083/v1";
    const { harness, stop } = await start({ endpoints: `[{"id": "mac", "url": "${url}", "model": "m"}]` });
    const [s] = services(harness);
    expect(s.displayName.length).toBeLessThanOrEqual(64);
    expect(s.displayName).toMatch(/^OpenAI-compatible endpoint at http:\/\/a-long-machine-name.*…$/);
    await stop();
  });

  it("warns with the id and bb's error when bb refuses an Endpoint, and registers the others", async () => {
    const { harness, stop } = await start({
      endpoints: `[{"id": "off", "url": "http://127.0.0.1:1/v1", "model": "m"}, {"id": "a", "url": "http://127.0.0.1:2/v1", "model": "m"}, ${mlx}]`,
    });
    expect(serviceIds(harness)).toEqual(["mlx"]);
    const messages = warnings(harness).map((e) => e.message);
    expect(messages).toContainEqual(expect.stringMatching(/^Endpoint "off" is not a service: .*reserved/));
    expect(messages).toContainEqual(expect.stringMatching(/^Endpoint "a" is not a service: .*invalid AI service id/));
    await stop();
  });
});

describe("status", () => {
  it("is ready for an Endpoint with a model and every variable set", async () => {
    const { harness, stop } = await start({ endpoints: `[${mlx}, ${gatewayByReference}]` });
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    expect(await status(harness, "gateway")).toEqual({ ready: true });
    await stop();
  });

  it("lists an Endpoint saved without a model as not ready, and leaves the others alone", async () => {
    const { harness, stop } = await start({ endpoints: `[{"id": "mac", "url": "http://127.0.0.1:8083/v1"}, ${mlx}]` });
    expect(serviceIds(harness)).toEqual(["mac", "mlx"]);
    expect(await status(harness, "mac")).toEqual({ ready: false, message: expect.stringContaining("needs a model") });
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    await stop();
  });

  it("lists an Endpoint whose variables are unset as not ready, naming every one", async () => {
    const { harness, stop } = await start({ endpoints: `[${gatewayByReference}, ${mlx}]` }, { unset: ["GATEWAY_URL", "GATEWAY_VIRTUAL_KEY"] });
    expect(serviceIds(harness)).toEqual(["gateway", "mlx"]);
    expect(await status(harness, "gateway")).toEqual({
      ready: false,
      message: "Not set in bb's environment: GATEWAY_URL, GATEWAY_VIRTUAL_KEY.",
    });
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    await stop();
  });

  it("ignores a reference in a key that is not in effect", async () => {
    const { harness, stop } = await start(
      { endpoints: `[${gatewayByReference.replace("${GATEWAY_URL}", "https://gateway.example.com/v1")}]`, keys: '{"gateway": "sk-literal"}' },
      { unset: ["GATEWAY_VIRTUAL_KEY"] },
    );
    expect(await status(harness, "gateway")).toEqual({ ready: true });
    await stop();
  });

  it("says so when there is no primary machine to send the Endpoints to", async () => {
    // Vitest fails the run on an unhandled rejection, which a failed first send left before.
    const fake = createFakePluginHost({
      pluginId: "openai-inference",
      settings: { endpoints: `[${mlx}]` },
      sdk: { system: { config: async () => ({ primaryHostId: null }) } as never },
    });
    await plugin(fake.bb);
    const run = fake.harness.behavior.runService("send-endpoints");
    await run.done.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [s] = fake.harness.inspection.registrations.aiServiceRegistrations;
    await expect(s.status!()).rejects.toThrow("No primary machine is connected");
  });

  it("calls nothing on the host, however often it is read", async () => {
    const { harness, stop } = await start({ endpoints: `[${mlx}]` });
    for (let i = 0; i < 5; i++) await status(harness, "mlx");
    expect(harness.inspection.experimental_hostRpcCalls).toHaveLength(1);
    await stop();
  });
});

describe("completions", () => {
  it("sends bb's prompt with the Endpoint to the host entry, with bb's signal", async () => {
    const { harness, stop } = await start({ endpoints: `[${mlx}]`, keys: '{"mlx": "sk-mlx"}' });
    const signal = new AbortController().signal;
    expect(await service(harness, "mlx").complete!("Title this", { signal })).toBe("A title");
    const call = harness.inspection.experimental_hostRpcCalls.at(-1)!;
    expect(call).toMatchObject({
      method: "complete",
      hostId: "host_primary",
      input: { endpoint: { id: "mlx", url: "http://127.0.0.1:8080/v1", key: "sk-mlx", model: "qwen3-4b" }, prompt: "Title this" },
    });
    expect(call.signal).toBeDefined();
    await stop();
  });

  it("rejects with the host entry's message when the Endpoint fails", async () => {
    const { harness, stop } = await start(
      { endpoints: `[${mlx}]` },
      { answer: () => ({ ok: false, message: 'Endpoint "mlx" answered HTTP 503: down' }) },
    );
    await expect(service(harness, "mlx").complete!("Title this", { signal: new AbortController().signal })).rejects.toThrow(
      'Endpoint "mlx" answered HTTP 503: down',
    );
    await stop();
  });
});

describe("settings", () => {
  it("adds and removes services, and sends the change, without a reload", async () => {
    const { harness, stop } = await start({ endpoints: `[${mlx}]` });
    await harness.behavior.setSettings({ endpoints: '[{"id": "lmstudio", "url": "http://127.0.0.1:1234/v1", "model": "m"}]' });
    await expect.poll(() => serviceIds(harness)).toEqual(["lmstudio"]);
    await expect.poll(() => configureCalls(harness).length).toBe(2);
    expect(await status(harness, "lmstudio")).toEqual({ ready: true });
    await stop();
  });

  it("sends the Endpoints again at the next status read when a send after a save failed", async () => {
    let failNext = false;
    const fake = createFakePluginHost({
      pluginId: "openai-inference",
      settings: { endpoints: `[${mlx}]` },
      sdk: { system: { config: async () => ({ primaryHostId: "host_primary" }) } as never },
      experimental_callHostRpc: (call) => {
        if (failNext) {
          failNext = false;
          throw new Error("host went away");
        }
        return (call.input as Array<{ id: string }>).map((e) => ({ id: e.id, missing: [] }));
      },
    });
    await plugin(fake.bb);
    const run = fake.harness.behavior.runService("send-endpoints");
    await expect.poll(() => configureCalls(fake.harness).length).toBe(1);
    failNext = true;
    await fake.harness.behavior.setSettings({ endpoints: '[{"id": "lmstudio", "url": "http://127.0.0.1:1234/v1", "model": "m"}]' });
    await expect.poll(() => configureCalls(fake.harness).length).toBe(2);
    expect(await service(fake.harness, "lmstudio").status!()).toEqual({ ready: true });
    expect(configureCalls(fake.harness)).toHaveLength(3);
    run.controller.abort();
    await run.done;
  });

  it("changes the key an Endpoint sends, and its status, when keys changes", async () => {
    const { harness, stop } = await start({ endpoints: `[${gatewayByReference}]` }, { unset: ["GATEWAY_VIRTUAL_KEY"] });
    expect(await status(harness, "gateway")).toMatchObject({ ready: false });
    await harness.behavior.setSettings({ keys: '{"gateway": "sk-setting"}' });
    await expect.poll(() => configureCalls(harness).length).toBe(2);
    expect(configureCalls(harness)[1].input).toEqual([{ id: "gateway", url: "${GATEWAY_URL}", key: "sk-setting", model: "gpt-6-luna" }]);
    expect(await status(harness, "gateway")).toEqual({ ready: true });
    await service(harness, "gateway").complete!("x", { signal: new AbortController().signal });
    expect(harness.inspection.experimental_hostRpcCalls.at(-1)!.input).toMatchObject({ endpoint: { key: "sk-setting" } });
    await stop();
  });

  it("refuses an Endpoint without a model, saying model is required", async () => {
    const { harness, stop } = await start();
    await expect(harness.behavior.setSettings({ endpoints: '[{"id": "mac", "url": "http://127.0.0.1:8083/v1"}]' })).rejects.toThrow(
      '"model" is required',
    );
    await stop();
  });

  it.each([
    ["not JSON", "[{"],
    ["an id with a capital", '[{"id": "MLX", "url": "http://127.0.0.1:8080/v1", "model": "m"}]'],
    ["an id with a slash", '[{"id": "a/b", "url": "http://127.0.0.1:8080/v1", "model": "m"}]'],
    ["a url without a scheme", '[{"id": "mlx", "url": "127.0.0.1:8080/v1", "model": "m"}]'],
    ["an empty model", '[{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": " "}]'],
    ["an id twice", '[{"id": "a", "url": "http://a.example.com", "model": "m"}, {"id": "a", "url": "http://b.example.com", "model": "m"}]'],
    ["a literal key", '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "sk-plain", "model": "m"}]'],
    ["a key with more than a reference", '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "Bearer ${KEY}", "model": "m"}]'],
  ])("refuses endpoints with %s", async (_name, endpoints) => {
    const { harness, stop } = await start();
    await expect(harness.behavior.setSettings({ endpoints })).rejects.toThrow();
    await stop();
  });

  it("tells the user where a literal key goes", async () => {
    const { harness, stop } = await start();
    await expect(
      harness.behavior.setSettings({ endpoints: '[{"id": "gateway", "url": "https://gateway.example.com/v1", "key": "sk-plain", "model": "m"}]' }),
    ).rejects.toThrow("put a literal key in Endpoint keys");
    await stop();
  });

  it("accepts a url that references a variable whole or embedded", async () => {
    const { harness, stop } = await start();
    await expect(
      harness.behavior.setSettings({
        endpoints: '[{"id": "a1", "url": "${A_URL}", "model": "m"}, {"id": "b1", "url": "https://${B_HOST}/v1", "model": "m"}]',
      }),
    ).resolves.not.toThrow();
    await stop();
  });

  it("refuses keys that are not a JSON object of strings", async () => {
    const { harness, stop } = await start();
    await expect(harness.behavior.setSettings({ keys: '["sk-test"]' })).rejects.toThrow();
    await stop();
  });
});
