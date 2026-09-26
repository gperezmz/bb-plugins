import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contract } from "../src/contract.js";
import type { Endpoint } from "../src/endpoints.js";
import { createHandlers } from "../src/handlers.js";
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
const env: Record<string, string> = { FAKE_URL: "", FAKE_KEY: "sk-test" };
// Each call builds new handlers, as a worker that bb started again does.
const entry = (dir = dataDir) =>
  experimental_createHostEntryHarness(
    { experimental_apiVersion: 1, contract, handlers: createHandlers(env) },
    { experimental_paths: { dataDir: dir, tempDir: dir } },
  );

const prompt = "You create concise titles for coding tasks.\nTask:\nAdd dark mode to the settings page";
const gateway = (overrides: Partial<Endpoint> = {}): Endpoint => ({
  id: "gateway",
  url: `${fake.url}/v1`,
  key: "sk-test",
  model: "gpt-6-luna",
  ...overrides,
});

describe("host entry against a LiteLLM-like server", () => {
  it("answers with the Endpoint's text, sending every optional field", async () => {
    expect(await entry().experimental_call("complete", { endpoint: gateway(), prompt })).toEqual({
      ok: true,
      text: "Add dark mode to the",
    });
    expect(fake.requests.at(-1)).toMatchObject({
      path: "/v1/chat/completions",
      authorized: true,
      body: { model: "gpt-6-luna", messages: [{ role: "user", content: prompt }], reasoning_effort: "none" },
    });
    expect(fake.requests.at(-1)!.body).not.toHaveProperty("response_format");
  });

  it.each([
    ["limited", 'Endpoint "gateway" answered HTTP 429: Rate limit reached for this key.'],
    ["down", 'Endpoint "gateway" answered HTTP 503: Service unavailable: no healthy deployment.'],
  ])("answers why model %s failed", async (model, message) => {
    expect(await entry().experimental_call("complete", { endpoint: gateway({ model }), prompt })).toEqual({ ok: false, message });
  });

  it("answers why when the key is refused", async () => {
    expect(await entry().experimental_call("complete", { endpoint: gateway({ key: "sk-nope" }), prompt })).toMatchObject({
      ok: false,
      message: expect.stringContaining('Endpoint "gateway" answered HTTP 401'),
    });
  });

  it("expands ${NAME} in url and key from bb's environment, and drops trailing slashes", async () => {
    const endpoint = gateway({ url: "${FAKE_URL}/v1//", key: "${FAKE_KEY}" });
    expect(await entry().experimental_call("configure", [endpoint])).toEqual([{ id: "gateway", missing: [] }]);
    expect(await entry().experimental_call("complete", { endpoint, prompt })).toMatchObject({ ok: true });
    expect(fake.requests.at(-1)).toMatchObject({ path: "/v1/chat/completions", authorized: true });
  });

  it("reports unset variables, and refuses a completion that needs them", async () => {
    const endpoint = gateway({ url: "${UNSET_URL}", key: "${UNSET_KEY}" });
    expect(await entry().experimental_call("configure", [endpoint])).toEqual([{ id: "gateway", missing: ["UNSET_URL", "UNSET_KEY"] }]);
    expect(await entry().experimental_call("complete", { endpoint, prompt })).toEqual({
      ok: false,
      message: `Endpoint "gateway" cannot answer: Not set in bb's environment: UNSET_URL, UNSET_KEY.`,
    });
  });

  it("refuses a completion for an Endpoint without a model", async () => {
    expect(await entry().experimental_call("complete", { endpoint: gateway({ model: null }), prompt })).toMatchObject({
      ok: false,
      message: expect.stringContaining("needs a model"),
    });
  });

  it("puts no key and no expanded value in a failure, even when the server echoes them", async () => {
    const secretEnv = { FAKE_URL: fake.url, FAKE_KEY: "sk-test" };
    for (const endpoint of [gateway({ url: "${FAKE_URL}/v1", key: "${FAKE_KEY}", model: "echo" }), gateway({ model: "echo" })]) {
      const h = experimental_createHostEntryHarness(
        { experimental_apiVersion: 1, contract, handlers: createHandlers(secretEnv) },
        { experimental_paths: { dataDir, tempDir: dataDir } },
      );
      const out = await h.experimental_call("complete", { endpoint, prompt });
      expect(out).toMatchObject({ ok: false, message: expect.stringContaining("HTTP 500") });
      const { message } = out as { message: string };
      expect(message).not.toContain("sk-test");
      if (endpoint.url.includes("${")) {
        expect(message).not.toContain(fake.url.replace("http://", ""));
        expect(message).toContain("${FAKE_KEY}");
      } else {
        expect(message).toContain("<key>");
      }
    }
  });

  it("puts no expanded value in a network failure", async () => {
    const unreachable = { DEAD_URL: "http://127.0.0.1:9/secret-path" };
    const h = experimental_createHostEntryHarness(
      { experimental_apiVersion: 1, contract, handlers: createHandlers(unreachable) },
      { experimental_paths: { dataDir, tempDir: dataDir } },
    );
    const out = await h.experimental_call("complete", { endpoint: gateway({ url: "${DEAD_URL}", key: null }), prompt });
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('Could not reach Endpoint "gateway"') });
    expect((out as { message: string }).message).not.toMatch(/secret-path|127\.0\.0\.1:9/);
  });

  it("closes the connection to the server within a second of bb's abort", async () => {
    const cancel = new AbortController();
    const pending = entry().experimental_call("complete", { endpoint: gateway({ model: "hang" }), prompt }, { signal: cancel.signal });
    await expect.poll(() => fake.requests.at(-1)?.body.model).toBe("hang");
    const request = fake.requests.at(-1)!;
    const abortedAt = Date.now();
    cancel.abort();
    await pending.catch(() => undefined);
    await expect.poll(() => request.closedAt, { timeout: 1_000 }).toBeDefined();
    expect(request.closedAt! - abortedAt).toBeLessThan(1_000);
  });

  it("removes the Endpoints file 0.1 kept, which held keys", async () => {
    await writeFile(join(dataDir, "endpoints.json"), '[{"id":"gateway","url":"x","key":"sk-old"}]');
    await entry().experimental_call("configure", [gateway()]);
    await expect(stat(join(dataDir, "endpoints.json"))).rejects.toThrow();
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
    h.experimental_call("configure", [gateway({ url, model: "no-reasoning" })]);
  /** Asks for a title from a model that refuses `reasoning_effort`; returns what each request sent it. */
  const titleFromNoReasoning = async (h: ReturnType<typeof entry>, url = `${fake.url}/v1`) => {
    const before = fake.requests.length;
    expect(await h.experimental_call("complete", { endpoint: gateway({ url, model: "no-reasoning" }), prompt })).toMatchObject({ ok: true });
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

  it("keys them by the URL as the settings write it, so the file holds no expanded value", async () => {
    await titleFromNoReasoning(entry(dir), "${FAKE_URL}/v1");
    const stored = await readFile(learnedFile(), "utf8");
    expect(stored).toContain("${FAKE_URL}");
    expect(stored).not.toContain(fake.url);
  });

  it("writes the file only when something new is learned", async () => {
    const h = entry(dir);
    await titleFromNoReasoning(h);
    await rm(learnedFile());
    expect(await titleFromNoReasoning(h)).toEqual(["without"]);
    await expect(stat(learnedFile())).rejects.toThrow();
  });

  it("forgets what a URL refused when the Endpoint's URL changes", async () => {
    const h = entry(dir);
    await titleFromNoReasoning(h);
    await configure(h, "https://gateway.example.com/v1");
    expect(JSON.parse(await readFile(learnedFile(), "utf8"))).toEqual({});
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
  });

  it("reads a corrupt file as nothing learned, and replaces it", async () => {
    await writeFile(learnedFile(), "{not json");
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
    expect(JSON.parse(await readFile(learnedFile(), "utf8"))).toEqual({ [`${fake.url}/v1`]: { "no-reasoning": ["reasoning_effort"] } });
  });

  it("answers when the file can be neither read nor written", async () => {
    await mkdir(learnedFile());
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
    expect(await titleFromNoReasoning(entry(dir))).toEqual(["with", "without"]);
  });
});
