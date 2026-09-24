import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostContract } from "../src/host-contract.js";
import { NO_SETTINGS } from "../src/endpoint.js";
import { createHandlers } from "../src/handlers.js";
import { startFakeLiteLlm, type FakeLiteLlm } from "./fake-litellm.mjs";

let fake: FakeLiteLlm;
let dataDir: string;

beforeAll(async () => {
  fake = await startFakeLiteLlm({ key: "sk-test", slowMs: 2_000 });
  dataDir = await mkdtemp(join(tmpdir(), "openai-inference-"));
});
afterAll(async () => {
  await fake.close();
  await rm(dataDir, { recursive: true, force: true });
});

// `@get-bb/plugin-sdk/host` cannot be imported by native ESM, so the entry
// object that `experimental_defineHostEntry` builds is written out here.
const entry = (env: Record<string, string | undefined>) =>
  experimental_createHostEntryHarness(
    { experimental_apiVersion: 1, contract: hostContract, handlers: createHandlers(env) },
    { experimental_paths: { dataDir, tempDir: dataDir } },
  );

const title = (serviceId: string, model: string, timeoutMs = 5_000) => ({
  serviceId,
  model,
  prompt: "You create concise titles for coding tasks.\nTask:\nAdd dark mode to the settings page",
  outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  reasoningEffort: "none" as const,
  timeoutMs,
});

describe("host entry against a LiteLLM-like server", () => {
  it("serves gateway from GATEWAY_URL and GATEWAY_VIRTUAL_KEY", async () => {
    const h = entry({ GATEWAY_URL: `${fake.url}/v1/`, GATEWAY_VIRTUAL_KEY: "sk-test" });
    await h.experimental_call("configure", NO_SETTINGS);
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toEqual({
      ok: true,
      model: "gpt-6-luna",
      value: { title: "Add dark mode to the" },
    });
    expect(fake.requests.at(-1)).toMatchObject({ path: "/v1/chat/completions", authorized: true, body: { reasoning_effort: "none" } });
  });

  it("lets the settings override the environment, and keeps them in a file only its owner reads", async () => {
    const h = entry({ GATEWAY_URL: "http://127.0.0.1:9/v1", GATEWAY_VIRTUAL_KEY: "sk-wrong" });
    await h.experimental_call("configure", { ...NO_SETTINGS, gateway: { baseUrl: `${fake.url}/v1`, apiKey: "sk-test" } });
    expect((await stat(join(dataDir, "endpoints.json"))).mode & 0o777).toBe(0o600);
    // A fresh worker reads what the last one was sent.
    const restarted = entry({});
    expect(await restarted.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toMatchObject({ ok: true });
  });

  it("maps a bad key to auth_required", async () => {
    const h = entry({});
    await h.experimental_call("configure", { ...NO_SETTINGS, gateway: { baseUrl: `${fake.url}/v1`, apiKey: "sk-nope" } });
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toMatchObject({
      ok: false,
      code: "auth_required",
    });
  });

  it("serves local without reasoning_effort, and falls back to prompt-only JSON", async () => {
    const h = entry({});
    await h.experimental_call("configure", { ...NO_SETTINGS, local: { baseUrl: `${fake.url}/v1`, apiKey: "sk-test" } });
    expect(await h.experimental_call("ai.inference.complete", title("local", "no-json-schema"))).toMatchObject({
      ok: true,
      value: { title: "Add dark mode to the" },
    });
    const bodies = fake.requests.slice(-2).map((r) => r.body);
    expect(bodies[0]).toHaveProperty("response_format");
    expect(bodies[1]).not.toHaveProperty("response_format");
    expect(bodies.some((b) => "reasoning_effort" in b)).toBe(false);
    expect(bodies[0]).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
  });

  it.each([
    ["limited", "rate_limited"],
    ["down", "service_unavailable"],
    ["unknown-model", "request_failed"],
  ])("maps model %s to %s", async (model, code) => {
    const h = entry({});
    await h.experimental_call("configure", { ...NO_SETTINGS, gateway: { baseUrl: `${fake.url}/v1`, apiKey: "sk-test" } });
    expect(await h.experimental_call("ai.inference.complete", title("gateway", model))).toMatchObject({ ok: false, code });
  });

  it("returns timeout when the server is slower than timeoutMs", async () => {
    const h = entry({});
    await h.experimental_call("configure", { ...NO_SETTINGS, gateway: { baseUrl: `${fake.url}/v1`, apiKey: "sk-test" } });
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "slow", 200))).toMatchObject({
      ok: false,
      code: "timeout",
    });
  });

  it("says what is missing when a service has no URL", async () => {
    const h = entry({});
    await h.experimental_call("configure", NO_SETTINGS);
    expect(await h.experimental_call("ai.inference.complete", title("local", "any"))).toEqual({
      ok: false,
      code: "request_failed",
      message: "No local server URL: set the plugin's Local server base URL setting.",
    });
    expect(await h.experimental_call("ai.inference.complete", title("codex", "any"))).toMatchObject({ code: "request_failed" });
  });
});
