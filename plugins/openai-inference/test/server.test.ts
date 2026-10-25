import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { Endpoint } from "../src/endpoints.js";
import plugin from "../server.js";

type Call = { method: string; input: unknown; hostId: string; signal?: AbortSignal };

const mlx: Endpoint = { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } };
const gateway: Endpoint = {
  id: "gateway",
  url: "${GATEWAY_URL}",
  model: "gpt-6-luna",
  key: { kind: "variable", reference: "${GATEWAY_VIRTUAL_KEY}" },
};
const plain: Endpoint = { id: "plain", url: "http://127.0.0.1:8081/v1", model: "m", key: { kind: "none" } };

interface Options {
  /** The Endpoints saved in the plugin's storage. */
  endpoints?: Endpoint[];
  /** What 0.3 saved: the plugin has not copied it yet. */
  legacy?: Record<string, string>;
  /** Variables the host entry lacks. */
  unset?: string[];
  answer?: (call: Call) => unknown;
  /** Where the host entry's key file is, by id, as the plugin has changed it. */
  keys?: Record<string, string>;
  hostDown?: boolean;
}

const hosts: { harness: { lifecycle: { dispose(): Promise<void> } } }[] = [];

afterEach(async () => {
  for (const fake of hosts.splice(0)) await fake.harness.lifecycle.dispose();
});

/** Starts the plugin on a fake host whose host entry keeps keys in `keys` and answers each completion with `answer`. */
const start = async (options: Options = {}) => {
  const keys = { ...options.keys };
  const urls: Record<string, string> = {};
  const state = { hostDown: options.hostDown ?? false, reloads: 0, reloadFails: false };
  const fake = createFakePluginHost({
    pluginId: "openai-inference",
    settings: options.legacy,
    sdk: {
      system: { config: async () => ({ primaryHostId: "host_primary" }) },
      plugins: {
        // bb finishes a reload only once the plugin's services have stopped, so
        // one that waits for it from inside a service never returns.
        reload: async () => {
          state.reloads += 1;
          if (state.reloadFails) throw new Error("reload refused");
          return new Promise(() => undefined);
        },
      },
    } as never,
    experimental_callHostRpc: (call) => {
      if (state.hostDown) throw new Error("No primary machine is connected");
      switch (call.method) {
        case "configure":
          return (call.input as Endpoint[]).map((e) => ({
            id: e.id,
            missing: (options.unset ?? []).filter((name) => `${e.url} ${e.key.kind === "variable" ? e.key.reference : ""}`.includes(`\${${name}}`)),
          }));
        case "putKey": {
          const { id, url, key } = call.input as { id: string; url: string; key: string };
          keys[id] = key;
          urls[id] = url;
          return null;
        }
        case "removeKey":
          delete keys[(call.input as { id: string }).id];
          return null;
        default:
          return (options.answer ?? (() => ({ ok: true, text: "A title" })))(call);
      }
    },
  });
  hosts.push(fake);
  if (options.legacy === undefined) await fake.bb.storage.kv.set("legacy-settings-copied", true);
  if (options.endpoints !== undefined) await fake.bb.storage.kv.set("endpoints", options.endpoints);
  await plugin(fake.bb);
  const { harness } = fake;
  const running = harness.behavior.runService("send-endpoints");
  // A host that is down fails the send, which bb answers by restarting the service.
  running.done.catch(() => undefined);
  await expect.poll(() => configureCalls(harness).length).toBeGreaterThanOrEqual(1);
  return { fake, harness, keys, urls, state, stop: async () => (running.controller.abort(), await running.done.catch(() => undefined)) };
};
type Harness = Awaited<ReturnType<typeof start>>["harness"];

const configureCalls = (harness: Pick<Harness, "inspection">) => harness.inspection.experimental_hostRpcCalls.filter((c) => c.method === "configure");
const services = (harness: Harness) => harness.inspection.registrations.aiServiceRegistrations;
const serviceIds = (harness: Harness) => services(harness).map((s) => s.id);
const service = (harness: Harness, id: string) => {
  const found = services(harness).find((s) => s.id === id);
  if (found === undefined) throw new Error(`no service ${id}`);
  return found;
};
const status = (harness: Harness, id: string) => service(harness, id).status!();
const warnings = (harness: Harness) => harness.inspection.logEntries.filter((e) => e.level === "warn" || e.level === "error");
const kvEndpoints = async (fake: { bb: { storage: { kv: { get<T>(key: string): Promise<T | undefined> } } } }) =>
  (await fake.bb.storage.kv.get<Endpoint[]>("endpoints")) ?? [];

const draft = (over: Record<string, unknown> = {}) => ({ id: "new", url: "http://127.0.0.1:9000/v1", model: "m", key: { kind: "none" }, ...over });
const save = (harness: Harness, over: Record<string, unknown> = {}, create = true) => harness.behavior.callRpc("saveEndpoint", { draft: draft(over), create });

describe("registration", () => {
  it("sends the saved Endpoints unexpanded to the primary host and registers each as a text service", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, gateway] });
    expect(configureCalls(harness)[0]).toMatchObject({ hostId: "host_primary", input: [mlx, gateway] });
    expect(serviceIds(harness)).toEqual(["mlx", "gateway"]);
    for (const s of services(harness)) {
      expect(s.complete).toBeTypeOf("function");
      expect(s.status).toBeTypeOf("function");
      expect(s.transcribe).toBeUndefined();
    }
    expect(warnings(harness)).toEqual([]);
    await stop();
  });

  it("registers nothing and logs nothing with no Endpoint", async () => {
    const { harness, stop } = await start();
    expect(serviceIds(harness)).toEqual([]);
    expect(warnings(harness)).toEqual([]);
    await stop();
  });

  it("keeps a long URL's display name within bb's 64 characters", async () => {
    const url = "http://a-long-machine-name.example-network.example.com:8083/v1";
    const { harness, stop } = await start({ endpoints: [{ ...plain, url }] });
    const [s] = services(harness);
    expect(s.displayName.length).toBeLessThanOrEqual(64);
    expect(s.displayName).toMatch(/^OpenAI-compatible endpoint at http:\/\/a-long-machine-name.*…$/);
    await stop();
  });

  it("warns with the id and bb's error when bb refuses an Endpoint, and registers the others", async () => {
    const { harness, stop } = await start({ endpoints: [{ ...plain, id: "off" }, { ...plain, id: "a" }, mlx] });
    expect(serviceIds(harness)).toEqual(["mlx"]);
    const messages = warnings(harness).map((e) => e.message);
    expect(messages).toContainEqual(expect.stringMatching(/^Endpoint "off" is not a service: .*reserved/));
    expect(messages).toContainEqual(expect.stringMatching(/^Endpoint "a" is not a service: .*invalid AI service id/));
    await stop();
  });
});

describe("status", () => {
  it("is ready for an Endpoint with a model and every variable set", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, gateway] });
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    expect(await status(harness, "gateway")).toEqual({ ready: true });
    await stop();
  });

  it("lists an Endpoint without a model as not ready, naming the plugin's page, and leaves the others alone", async () => {
    const { harness, stop } = await start({ endpoints: [{ ...plain, id: "old", model: null }, mlx] });
    expect(serviceIds(harness)).toEqual(["old", "mlx"]);
    const old = await status(harness, "old");
    expect(old).toEqual({ ready: false, message: expect.stringContaining("needs a model") });
    expect(old).toMatchObject({ message: expect.stringContaining("Endpoints section of the plugin's page") });
    expect(JSON.stringify(old)).not.toMatch(/setting/);
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    await stop();
  });

  it("lists an Endpoint whose literal key is not set as not ready, naming the page", async () => {
    const { harness, stop } = await start({ endpoints: [{ ...mlx, key: { kind: "literal", set: false } }] });
    expect(await status(harness, "mlx")).toEqual({ ready: false, message: expect.stringContaining("Literal and not set") });
    await stop();
  });

  it("lists an Endpoint whose variables are unset as not ready, naming every one", async () => {
    const { harness, stop } = await start({ endpoints: [gateway, mlx], unset: ["GATEWAY_URL", "GATEWAY_VIRTUAL_KEY"] });
    expect(await status(harness, "gateway")).toEqual({ ready: false, message: "Not set in bb's environment: GATEWAY_URL, GATEWAY_VIRTUAL_KEY." });
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    await stop();
  });

  it("says so when there is no primary machine to send the Endpoints to", async () => {
    // Vitest fails the run on an unhandled rejection, which a failed first send left before.
    const fake = createFakePluginHost({
      pluginId: "openai-inference",
      sdk: { system: { config: async () => ({ primaryHostId: null }) } as never },
    });
    hosts.push(fake);
    await fake.bb.storage.kv.set("legacy-settings-copied", true);
    await fake.bb.storage.kv.set("endpoints", [mlx]);
    await plugin(fake.bb);
    const run = fake.harness.behavior.runService("send-endpoints");
    await run.done.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [s] = fake.harness.inspection.registrations.aiServiceRegistrations;
    await expect(s.status!()).rejects.toThrow("No primary machine is connected");
  });

  it("calls nothing on the host, however often it is read", async () => {
    const { harness, stop } = await start({ endpoints: [mlx] });
    for (let i = 0; i < 5; i++) await status(harness, "mlx");
    expect(harness.inspection.experimental_hostRpcCalls).toHaveLength(1);
    await stop();
  });
});

describe("completions", () => {
  it("sends bb's prompt with the Endpoint, its key as a kind and never a literal key, to the host entry, with bb's signal", async () => {
    const { harness, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-mlx" } });
    const signal = new AbortController().signal;
    expect(await service(harness, "mlx").complete!("Title this", { signal })).toBe("A title");
    const call = harness.inspection.experimental_hostRpcCalls.at(-1)!;
    expect(call).toMatchObject({ method: "complete", hostId: "host_primary", input: { endpoint: mlx, prompt: "Title this" } });
    expect(JSON.stringify(call.input)).not.toContain("sk-mlx");
    expect(call.signal).toBeDefined();
    await stop();
  });

  it("rejects with the host entry's message when the Endpoint fails", async () => {
    const { harness, stop } = await start({ endpoints: [mlx], answer: () => ({ ok: false, message: 'Endpoint "mlx" answered HTTP 503: down' }) });
    await expect(service(harness, "mlx").complete!("Title this", { signal: new AbortController().signal })).rejects.toThrow('Endpoint "mlx" answered HTTP 503: down');
    await stop();
  });
});

describe("the page", () => {
  it("lists the Endpoints with no literal key, and no notice once 0.3's settings are copied", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, gateway], keys: { mlx: "sk-mlx" } });
    const out = await harness.behavior.callRpc("endpoints", null);
    expect(out).toEqual({ endpoints: [mlx, gateway], notice: null });
    expect(JSON.stringify(out)).not.toContain("sk-mlx");
    expect(harness.inspection.registrations.settingsDescriptors).toEqual({});
    await stop();
  });

  it("saves a new Endpoint with a literal key at once: offered as a service, the key kept by the host entry alone", async () => {
    const { fake, harness, keys, stop } = await start();
    const result = await save(harness, { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", value: "sk-test" } });
    expect(result).toEqual({ ok: true, endpoints: [{ ...mlx }] });
    expect(serviceIds(harness)).toEqual(["mlx"]);
    expect(keys).toEqual({ mlx: "sk-test" });
    await expect.poll(() => configureCalls(harness).length).toBe(2);
    expect(await status(harness, "mlx")).toEqual({ ready: true });
    await service(harness, "mlx").complete!("x", { signal: new AbortController().signal });
    const sent = harness.inspection.experimental_hostRpcCalls.at(-1)!;
    expect(sent.input).toMatchObject({ endpoint: { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } } });
    // The key is in nothing the server keeps, answers or logs.
    expect(JSON.stringify(await kvEndpoints(fake))).not.toContain("sk-test");
    expect(JSON.stringify(await harness.behavior.callRpc("endpoints", null))).not.toContain("sk-test");
    expect(JSON.stringify(harness.inspection.logEntries)).not.toContain("sk-test");
    expect(JSON.stringify(configureCalls(harness))).not.toContain("sk-test");
    await stop();
  });

  it("offers the service under its new URL when the URL changes", async () => {
    const { harness, stop } = await start({ endpoints: [plain, mlx] });
    await save(harness, { id: "plain", url: "http://127.0.0.1:9999/v1", model: "m" }, false);
    expect(serviceIds(harness).sort()).toEqual(["mlx", "plain"]);
    expect(service(harness, "plain").displayName).toContain("127.0.0.1:9999");
    expect(service(harness, "plain").displayName).not.toContain("8081");
    await stop();
  });

  it("registers the service again when its key is typed, so bb does not read it as not ready for its cached 10 seconds", async () => {
    const { harness, stop } = await start({ endpoints: [{ ...mlx, key: { kind: "literal", set: false } }] });
    const before = service(harness, "mlx");
    expect(await before.status!()).toMatchObject({ ready: false });
    await save(harness, { id: "mlx", url: mlx.url, model: "qwen3-4b", key: { kind: "literal", value: "sk-new" } }, false);
    const after = service(harness, "mlx");
    expect(after).not.toBe(before);
    expect(serviceIds(harness)).toEqual(["mlx"]);
    expect(await after.status!()).toEqual({ ready: true });
    await stop();
  });

  it("registers the service again when a model is entered for an Endpoint that had none, and leaves the others' services alone", async () => {
    const { harness, stop } = await start({ endpoints: [{ ...plain, model: null }, mlx] });
    const [before, other] = [service(harness, "plain"), service(harness, "mlx")];
    await save(harness, { id: "plain", url: plain.url, model: "m" }, false);
    expect(service(harness, "plain")).not.toBe(before);
    expect(service(harness, "mlx")).toBe(other);
    expect(await service(harness, "plain").status!()).toEqual({ ready: true });
    await stop();
  });

  it("leaves the service of an Endpoint that did not change as it was when another is saved", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, gateway] });
    const [mlxService, gatewayService] = [service(harness, "mlx"), service(harness, "gateway")];
    await save(harness, { id: "plain", url: plain.url, model: "m" });
    const plainService = service(harness, "plain");
    await save(harness, { id: "plain2", url: plain.url, model: "m" });
    expect(service(harness, "mlx")).toBe(mlxService);
    expect(service(harness, "gateway")).toBe(gatewayService);
    expect(service(harness, "plain")).toBe(plainService);
    await stop();
  });

  it("applies a changed model, URL or key on Save, with no reload, and not before", async () => {
    const { harness, keys, urls, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-old" } });
    await service(harness, "mlx").complete!("x", { signal: new AbortController().signal });
    expect(harness.inspection.experimental_hostRpcCalls.at(-1)!.input).toMatchObject({ endpoint: { model: "qwen3-4b" } });
    await save(harness, { id: "mlx", url: mlx.url, model: "qwen3-8b", key: { kind: "literal", value: "sk-new" } }, false);
    await service(harness, "mlx").complete!("x", { signal: new AbortController().signal });
    expect(harness.inspection.experimental_hostRpcCalls.at(-1)!.input).toMatchObject({ endpoint: { model: "qwen3-8b" } });
    expect(keys).toEqual({ mlx: "sk-new" });
    expect(urls).toEqual({ mlx: mlx.url });
    await stop();
  });

  it("refuses an invalid card, naming the field, and changes nothing", async () => {
    const { fake, harness, keys, stop } = await start({ endpoints: [mlx, plain], keys: { mlx: "sk-mlx" } });
    const before = harness.inspection.experimental_hostRpcCalls.length;
    expect(await save(harness, { id: "mlx", model: "" })).toEqual({ ok: false, fields: { id: expect.any(String), model: expect.any(String) } });
    expect(await save(harness, { id: "x1", url: "nope" })).toEqual({ ok: false, fields: { url: expect.any(String) } });
    expect(await save(harness, { id: "x1", key: { kind: "variable", reference: "sk-plain" } })).toEqual({ ok: false, fields: { key: expect.any(String) } });
    expect(await save(harness, { id: "x1", key: { kind: "literal", value: null } })).toEqual({ ok: false, fields: { key: expect.any(String) } });
    expect(await kvEndpoints(fake)).toEqual([mlx, plain]);
    expect(serviceIds(harness)).toEqual(["mlx", "plain"]);
    expect(keys).toEqual({ mlx: "sk-mlx" });
    expect(harness.inspection.experimental_hostRpcCalls).toHaveLength(before);
    await stop();
  });

  it("clears a literal key when its URL changes, so no task sends it to the new URL", async () => {
    const { harness, keys, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-mlx" } });
    const result = await save(harness, { id: "mlx", url: "http://127.0.0.1:9999/v1", model: "qwen3-4b", key: { kind: "literal", value: null } }, false);
    expect(result).toMatchObject({ ok: true, endpoints: [{ id: "mlx", url: "http://127.0.0.1:9999/v1", key: { kind: "literal", set: false } }] });
    expect(keys).toEqual({});
    expect(await status(harness, "mlx")).toMatchObject({ ready: false });
    await stop();
  });

  it("deletes a literal key when the Endpoint is saved with Key None or Variable, or removed", async () => {
    const { harness, keys, stop } = await start({ endpoints: [mlx, { ...mlx, id: "mlx2" }], keys: { mlx: "sk-a", mlx2: "sk-b" } });
    await save(harness, { id: "mlx", url: mlx.url, model: "qwen3-4b", key: { kind: "none" } }, false);
    expect(keys).toEqual({ mlx2: "sk-b" });
    expect(await harness.behavior.callRpc("removeEndpoint", { id: "mlx2" })).toMatchObject({ ok: true });
    expect(keys).toEqual({});
    expect(serviceIds(harness)).toEqual(["mlx"]);
    await stop();
  });

  it("keeps the Endpoint and says why when the key cannot be kept", async () => {
    const { fake, harness, state, stop } = await start();
    state.hostDown = true;
    await expect(save(harness, { id: "mlx", key: { kind: "literal", value: "sk-test" } })).rejects.toThrow("No primary machine is connected");
    expect(await kvEndpoints(fake)).toEqual([]);
    expect(serviceIds(harness)).toEqual([]);
    await stop();
  });

  it("removes an Endpoint: no longer offered as an AI service", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, plain] });
    expect(await harness.behavior.callRpc("removeEndpoint", { id: "plain" })).toEqual({ ok: true, endpoints: [mlx] });
    expect(serviceIds(harness)).toEqual(["mlx"]);
    expect(await harness.behavior.callRpc("removeEndpoint", { id: "plain" })).toEqual({ ok: false, problem: expect.stringContaining('"plain"') });
    await stop();
  });

  it.each(["endpoints", "saveEndpoint", "removeEndpoint"])("refuses %s to a caller that is another plugin", async (method) => {
    const { harness, keys, stop } = await start({ endpoints: [plain] });
    const input = { endpoints: null, saveEndpoint: { draft: draft({ key: { kind: "literal", value: "sk-x" } }), create: true }, removeEndpoint: { id: "plain" } }[method];
    await expect(harness.behavior.callRpc(method, input, { experimental_caller: { kind: "plugin", pluginId: "other" } })).rejects.toThrow("Only the plugin's own page");
    expect(keys).toEqual({});
    expect(serviceIds(harness)).toEqual(["plain"]);
    await stop();
  });
});

describe("the command", () => {
  it("lists each Endpoint with its id, URL, model and key kind, never a literal key", async () => {
    const { harness, stop } = await start({ endpoints: [mlx, gateway, plain, { ...mlx, id: "unset", key: { kind: "literal", set: false } }], keys: { mlx: "sk-mlx" } });
    const out = await harness.behavior.runCli(["list"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.split("\n")).toEqual([
      "mlx  http://127.0.0.1:8080/v1  model qwen3-4b  key literal (set)",
      "gateway  ${GATEWAY_URL}  model gpt-6-luna  key variable GATEWAY_VIRTUAL_KEY",
      "plain  http://127.0.0.1:8081/v1  model m  key none",
      "unset  http://127.0.0.1:8080/v1  model qwen3-4b  key literal (not set)",
    ]);
    expect(out.stdout).not.toContain("sk-mlx");
    expect(JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout)).toHaveLength(4);
    await stop();
  });

  it("says so when there is no Endpoint", async () => {
    const { harness, stop } = await start();
    expect((await harness.behavior.runCli(["list"])).stdout).toBe("No Endpoint is set.");
    await stop();
  });

  it("sets a new Endpoint as a card's Save would, with a ${NAME} key", async () => {
    const { harness, stop } = await start();
    const out = await harness.behavior.runCli(["set", "mac", "--url", "http://192.168.1.5:8083/v1", "--model", "m", "--key", "${MAC_INFERENCE_KEY}"]);
    expect(out).toMatchObject({ exitCode: 0, stdout: "mac  http://192.168.1.5:8083/v1  model m  key variable MAC_INFERENCE_KEY" });
    expect(serviceIds(harness)).toEqual(["mac"]);
    await stop();
  });

  it("refuses what a card's Save refuses, naming the field", async () => {
    const { fake, harness, stop } = await start();
    const out = await harness.behavior.runCli(["set", "Mac", "--url", "http://x.example.com/v1", "--model", "m"]);
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain("id:");
    expect(await kvEndpoints(fake)).toEqual([]);
    await stop();
  });

  it("takes no literal key: a key that is not a ${NAME} reference is refused and not echoed", async () => {
    const { fake, harness, keys, stop } = await start();
    const out = await harness.behavior.runCli(["set", "mac", "--url", "http://x.example.com/v1", "--model", "m", "--key", "sk-secret"]);
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain("key:");
    expect(out.stderr + out.stdout).not.toContain("sk-secret");
    expect(await kvEndpoints(fake)).toEqual([]);
    expect(keys).toEqual({});
    await stop();
  });

  it("replaces the URL and model of a saved Endpoint, and its key only when a reference is given", async () => {
    const { harness, stop } = await start({ endpoints: [gateway, plain] });
    await harness.behavior.runCli(["set", "gateway", "--url", "https://gw.example.com/v1", "--model", "m2"]);
    expect(JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout)[0]).toEqual({
      ...gateway,
      url: "https://gw.example.com/v1",
      model: "m2",
    });
    await harness.behavior.runCli(["set", "plain", "--url", plain.url, "--model", "m", "--key", "${PLAIN_KEY}"]);
    expect(JSON.parse((await harness.behavior.runCli(["list", "--json"])).stdout)[1].key).toEqual({ kind: "variable", reference: "${PLAIN_KEY}" });
    await stop();
  });

  it("refuses a new URL for an Endpoint with a literal key even with a reference, and names the page", async () => {
    const { fake, harness, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-mlx" } });
    const out = await harness.behavior.runCli(["set", "mlx", "--url", "http://127.0.0.1:1/v1", "--model", "qwen3-4b", "--key", "${MLX_KEY}"]);
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain("page");
    expect(await kvEndpoints(fake)).toEqual([mlx]);
    await stop();
  });

  it("refuses a new URL for an Endpoint with a literal key, and names the page", async () => {
    const { fake, harness, keys, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-mlx" } });
    const out = await harness.behavior.runCli(["set", "mlx", "--url", "http://127.0.0.1:1/v1", "--model", "qwen3-4b"]);
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain("page");
    expect(await kvEndpoints(fake)).toEqual([mlx]);
    expect(keys).toEqual({ mlx: "sk-mlx" });
    await stop();
  });

  it("removes an Endpoint, and its literal key", async () => {
    const { harness, keys, stop } = await start({ endpoints: [mlx], keys: { mlx: "sk-mlx" } });
    expect(await harness.behavior.runCli(["remove", "mlx"])).toMatchObject({ exitCode: 0, stdout: "Removed mlx." });
    expect(keys).toEqual({});
    expect(serviceIds(harness)).toEqual([]);
    expect((await harness.behavior.runCli(["remove", "mlx"])).exitCode).not.toBe(0);
    await stop();
  });
});

describe("copying what 0.3 saved", () => {
  const legacy = {
    endpoints: '[{"id": "mac", "url": "http://192.168.1.5:8083/v1", "key": "${MAC_INFERENCE_KEY}", "model": "m"}, {"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "qwen3-4b"}, {"id": "old", "url": "http://127.0.0.1:1/v1"}]',
    keys: '{"mlx": "sk-mlx"}',
  };

  /** Reads the values of the old settings as they stay saved, in a reload that declares them. */
  const savedValues = async (harness: Harness) => {
    let values: Record<string, unknown> = {};
    hosts.push(
      await harness.lifecycle.reload(async (bb) => {
        values = await bb.settings
          .define({ endpoints: { type: "string", label: "e", default: "[]" }, keys: { type: "string", label: "k", secret: true } })
          .get();
      }),
    );
    return values;
  };

  const copy = async (options: Options = {}) => {
    const started = await start({ legacy, ...options });
    const run = started.harness.behavior.runService("copy-legacy-settings");
    return { ...started, run };
  };

  it("declares the old settings while they are not copied, and none once they are", async () => {
    const { harness, run, stop } = await copy();
    expect(Object.keys(harness.inspection.registrations.settingsDescriptors)).toEqual(["endpoints", "keys"]);
    await expect.poll(() => harness.inspection.logEntries.some((e) => e.message.startsWith("Copied"))).toBe(true);
    run.controller.abort();
    await run.done;
    const reloaded = await harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    expect(reloaded.harness.inspection.registrations.settingsDescriptors).toEqual({});
    await stop();
  });

  it("copies the Endpoints and literal keys, unsets keys, keeps endpoints, and reloads once", async () => {
    const { fake, harness, keys, state, run, stop } = await copy();
    await expect.poll(() => state.reloads).toBe(1);
    expect(await kvEndpoints(fake)).toEqual([
      { id: "mac", url: "http://192.168.1.5:8083/v1", model: "m", key: { kind: "variable", reference: "${MAC_INFERENCE_KEY}" } },
      { id: "mlx", url: "http://127.0.0.1:8080/v1", model: "qwen3-4b", key: { kind: "literal", set: true } },
      { id: "old", url: "http://127.0.0.1:1/v1", model: null, key: { kind: "none" } },
    ]);
    expect(keys).toEqual({ mlx: "sk-mlx" });
    expect(await fake.bb.storage.kv.get("legacy-settings-copied")).toBe(true);
    expect(serviceIds(harness)).toEqual(["mac", "mlx", "old"]);
    expect(JSON.stringify(await kvEndpoints(fake))).not.toContain("sk-mlx");
    run.controller.abort();
    await run.done;
    expect(await savedValues(harness)).toEqual({ endpoints: legacy.endpoints });
    await stop();
  });

  it("shows an Endpoint with no model as not ready, naming the page", async () => {
    const { harness, state, run, stop } = await copy();
    await expect.poll(() => state.reloads).toBe(1);
    expect(await status(harness, "old")).toMatchObject({ ready: false, message: expect.stringContaining("Endpoints section of the plugin's page") });
    expect(await harness.behavior.callRpc("endpoints", null)).toMatchObject({ endpoints: expect.arrayContaining([expect.objectContaining({ id: "old", model: null })]) });
    run.controller.abort();
    await run.done;
    await stop();
  });

  it("does not copy again when the plugin restarts", async () => {
    const { harness, keys, state, run, stop } = await copy();
    await expect.poll(() => state.reloads).toBe(1);
    run.controller.abort();
    await run.done;
    await harness.behavior.callRpc("removeEndpoint", { id: "mac" });
    const reloaded = await harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    expect(reloaded.harness.inspection.registrations.services.map((s) => s.name)).toEqual(["send-endpoints"]);
    expect(await reloaded.bb.storage.kv.get<Endpoint[]>("endpoints")).toHaveLength(2);
    expect(keys).toEqual({ mlx: "sk-mlx" });
    await stop();
  });

  it("copies nothing and unsets nothing when an old value cannot be read, and says so on the page", async () => {
    const { fake, harness, keys, state, run, stop } = await copy({ legacy: { endpoints: "[{", keys: '{"mlx": "sk-mlx"}' } });
    await expect.poll(async () => ((await harness.behavior.callRpc("endpoints", null)) as { notice: string | null }).notice).toContain("The endpoints setting is not valid JSON");
    expect(await kvEndpoints(fake)).toEqual([]);
    expect(await fake.bb.storage.kv.get("legacy-settings-copied")).toBeUndefined();
    expect(keys).toEqual({});
    expect(state.reloads).toBe(0);
    run.controller.abort();
    await run.done;
    expect(await savedValues(harness)).toEqual({ endpoints: "[{", keys: '{"mlx": "sk-mlx"}' });
    await stop();
  });

  it("copies when the old value is fixed", async () => {
    const { harness, state, run, stop } = await copy({ legacy: { endpoints: "[{" } });
    await expect.poll(async () => ((await harness.behavior.callRpc("endpoints", null)) as { notice: string | null }).notice).toContain("not valid JSON");
    await harness.behavior.setSettings({ endpoints: '[{"id": "mlx", "url": "http://127.0.0.1:8080/v1", "model": "q"}]' });
    await expect.poll(() => state.reloads).toBe(1);
    expect(((await harness.behavior.callRpc("endpoints", null)) as { notice: string | null; endpoints: unknown[] })).toMatchObject({ notice: null, endpoints: [{ id: "mlx" }] });
    run.controller.abort();
    await run.done;
    await stop();
  });

  it("copies nothing when the primary machine cannot keep the keys, says so, and unsets nothing", async () => {
    const { fake, harness, state, run, stop } = await copy({ hostDown: true });
    await expect.poll(async () => ((await harness.behavior.callRpc("endpoints", null)) as { notice: string | null }).notice).toContain("not copied yet");
    expect(await kvEndpoints(fake)).toEqual([]);
    expect(state.reloads).toBe(0);
    run.controller.abort();
    await run.done;
    expect((await savedValues(harness)).keys).toBe('{"mlx": "sk-mlx"}');
    await stop();
  });

  it("copies an unset old value as nothing, and still stops declaring the settings", async () => {
    const { fake, state, run, stop } = await copy({ legacy: { endpoints: "[]" } });
    await expect.poll(() => state.reloads).toBe(1);
    expect(await kvEndpoints(fake)).toEqual([]);
    expect(await fake.bb.storage.kv.get("legacy-settings-copied")).toBe(true);
    run.controller.abort();
    await run.done;
    await stop();
  });

  it("warns, and still records the copy, when the plugin cannot reload itself", async () => {
    const started = await start({ legacy });
    started.state.reloadFails = true;
    const run = started.harness.behavior.runService("copy-legacy-settings");
    await expect.poll(() => warnings(started.harness).map((e) => e.message)).toContainEqual(expect.stringContaining("reload the plugin"));
    expect(await started.fake.bb.storage.kv.get("legacy-settings-copied")).toBe(true);
    run.controller.abort();
    await run.done;
    await started.stop();
  });
});
