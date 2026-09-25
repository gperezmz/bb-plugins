import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandlers } from "../src/handlers.js";
import { hostContract } from "../src/host-contract.js";
import { startFakeLiteLlm, type FakeLiteLlm } from "./fake-litellm.mjs";

let fake: FakeLiteLlm;
let dataDir: string;

beforeAll(async () => {
  fake = await startFakeLiteLlm({ key: "sk-test", slowMs: 2_000 });
  env.FAKE_URL = fake.url;
  dataDir = await mkdtemp(join(tmpdir(), "openai-inference-"));
});
afterAll(async () => {
  await fake.close();
  await rm(dataDir, { recursive: true, force: true });
});

// `@get-bb/plugin-sdk/host` cannot be imported by native ESM, so the entry
// object that `experimental_defineHostEntry` builds is written out here.
const env = { FAKE_URL: "", FAKE_KEY: "sk-test" };
// Each call builds new handlers, as a worker that bb started again does.
const entry = (dir = dataDir) =>
  experimental_createHostEntryHarness(
    { experimental_apiVersion: 1, contract: hostContract, handlers: createHandlers(env) },
    { experimental_paths: { dataDir: dir, tempDir: dir } },
  );

/** A host entry that knows the endpoints `gateway` and `mlx`, both at the fake. */
const configured = async (key = "sk-test") => {
  const h = entry();
  await h.experimental_call("configure", [
    { id: "gateway", url: `${fake.url}/v1`, key },
    { id: "mlx", url: fake.url + "/v1", key: "sk-test" },
  ]);
  return h;
};

const title = (serviceId: string, model: string, timeoutMs = 5_000) => ({
  serviceId,
  model,
  prompt: "You create concise titles for coding tasks.\nTask:\nAdd dark mode to the settings page",
  outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  reasoningEffort: "none" as const,
  timeoutMs,
});

describe("host entry against a LiteLLM-like server", () => {
  it("answers for the endpoint bb names, with every optional field", async () => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toEqual({
      ok: true,
      model: "gpt-6-luna",
      value: { title: "Add dark mode to the" },
    });
    expect(fake.requests.at(-1)).toMatchObject({
      path: "/v1/chat/completions",
      authorized: true,
      body: { reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_schema" } },
    });
  });

  it("keeps the endpoints in a file only its owner reads, for a worker that restarts", async () => {
    await configured();
    expect((await stat(join(dataDir, "endpoints.json"))).mode & 0o777).toBe(0o600);
    expect(await entry().experimental_call("ai.inference.complete", title("mlx", "gpt-6-luna"))).toMatchObject({ ok: true });
  });

  it("falls back to prompt-only JSON when the server rejects response_format", async () => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("mlx", "no-json-schema"))).toMatchObject({
      ok: true,
      value: { title: "Add dark mode to the" },
    });
    // The mock's error names response_format, so only that field is dropped.
    expect(fake.requests.at(-1)!.body).not.toHaveProperty("response_format");
    expect(fake.requests.at(-1)!.body).toHaveProperty("reasoning_effort");
  });

  it("drops only reasoning_effort when the server names it", async () => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "no-reasoning"))).toMatchObject({ ok: true });
    expect(fake.requests.at(-1)!.body).not.toHaveProperty("reasoning_effort");
    expect(fake.requests.at(-1)!.body).toHaveProperty("response_format");
  });

  it.each([
    ["limited", "rate_limited"],
    ["down", "service_unavailable"],
    ["unknown-model", "request_failed"],
  ])("maps model %s to %s", async (model, code) => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("gateway", model))).toMatchObject({ ok: false, code });
  });

  it("maps a bad key to auth_required", async () => {
    const h = await configured("sk-nope");
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toMatchObject({
      ok: false,
      code: "auth_required",
    });
  });

  it("returns timeout when the server is slower than timeoutMs", async () => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "slow", 200))).toMatchObject({
      ok: false,
      code: "timeout",
    });
  });

  it("expands ${NAME} in url and key from bb's environment, and writes the expansion nowhere", async () => {
    const h = entry();
    const endpoints = [{ id: "gateway", url: "${FAKE_URL}/v1/", key: "${FAKE_KEY}" }];
    expect(await h.experimental_call("configure", endpoints)).toEqual([{ id: "gateway", missing: [] }]);
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toMatchObject({ ok: true });
    expect(fake.requests.at(-1)).toMatchObject({ path: "/v1/chat/completions", authorized: true });
    const stored = await readFile(join(dataDir, "endpoints.json"), "utf8");
    expect(stored).toContain("${FAKE_URL}");
    expect(stored).not.toContain(fake.url);
    expect(stored).not.toContain("sk-test");
  });

  it("reports unset variables, and refuses a completion that needs them", async () => {
    const h = entry();
    expect(
      await h.experimental_call("configure", [{ id: "gateway", url: "${UNSET_URL}", key: "${UNSET_KEY}" }]),
    ).toEqual([{ id: "gateway", missing: ["UNSET_URL", "UNSET_KEY"] }]);
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "gpt-6-luna"))).toEqual({
      ok: false,
      code: "request_failed",
      message: "Not set in bb's environment: UNSET_URL, UNSET_KEY.",
    });
  });

  it("says so when bb names an endpoint it does not have", async () => {
    const h = await configured();
    expect(await h.experimental_call("ai.inference.complete", title("codex", "any"))).toEqual({
      ok: false,
      code: "request_failed",
      message: 'No endpoint "codex" in the plugin\'s settings.',
    });
  });
});

describe("fields learned across worker restarts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openai-inference-learned-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const learnedFile = () => join(dir, "learned-fields.json");
  const configure = async (h: ReturnType<typeof entry>, url: string) =>
    h.experimental_call("configure", [{ id: "gateway", url, key: "sk-test" }]);
  /** Asks for a title from a model that refuses `reasoning_effort`; returns what each request sent it. */
  const titleFromNoReasoning = async (h: ReturnType<typeof entry>) => {
    const before = fake.requests.length;
    expect(await h.experimental_call("ai.inference.complete", title("gateway", "no-reasoning"))).toMatchObject({ ok: true });
    return fake.requests.slice(before).map((r) => ("reasoning_effort" in r.body ? "with" : "without"));
  };

  it("keeps them, in a file only its owner reads, for a worker that restarts", async () => {
    const url = `${fake.url}/v1`;
    await configure(entry(dir), url);
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
    expect((await stat(learnedFile())).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(learnedFile(), "utf8"))).toEqual({ [url]: { "no-reasoning": ["reasoning_effort"] } });

    expect(await titleFromNoReasoning(entry(dir))).toEqual(["without"]);
  });

  it("writes the file only when something new is learned", async () => {
    const h = entry(dir);
    await configure(h, `${fake.url}/v1`);
    await titleFromNoReasoning(h);
    await rm(learnedFile());
    expect(await titleFromNoReasoning(h)).toEqual(["without"]);
    await expect(stat(learnedFile())).rejects.toThrow();
  });

  it("forgets what a URL refused when the endpoint's URL changes", async () => {
    const h = entry(dir);
    await configure(h, `${fake.url}/v1`);
    await titleFromNoReasoning(h);
    await configure(h, "https://gateway.example.com/v1");
    expect(JSON.parse(await readFile(learnedFile(), "utf8"))).toEqual({});
    await configure(h, `${fake.url}/v1`);
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
  });

  it("reads a corrupt file as nothing learned, and replaces it", async () => {
    await writeFile(learnedFile(), "{not json");
    const h = entry(dir);
    await configure(h, `${fake.url}/v1`);
    expect(await titleFromNoReasoning(h)).toEqual(["with", "without"]);
    expect(JSON.parse(await readFile(learnedFile(), "utf8"))).toEqual({ [`${fake.url}/v1`]: { "no-reasoning": ["reasoning_effort"] } });
  });

  it("answers when the file can be neither read nor written", async () => {
    await mkdir(learnedFile());
    await configure(entry(dir), `${fake.url}/v1`);
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
  });
});
