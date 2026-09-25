import type { ExperimentalAiInferenceCompleteInput } from "@get-bb/plugin-sdk/ai-services";
import { describe, expect, it } from "vitest";
import { complete, extractJsonObject, httpFailure, isStrictSchema } from "../src/complete.js";

// The schema bb sends for thread titles.
const titleSchema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

const input = (overrides: Partial<ExperimentalAiInferenceCompleteInput> = {}): ExperimentalAiInferenceCompleteInput => ({
  serviceId: "gateway",
  model: "gpt-6-luna",
  prompt: "You create concise titles for coding tasks.\nTask:\nFix the login bug",
  outputSchema: titleSchema,
  reasoningEffort: "none",
  timeoutMs: 5_000,
  ...overrides,
});

const endpoint = { id: "gateway", url: "https://gateway.example.com/v1", key: "sk-test" };

const chat = (content: string, status = 200) =>
  new Response(JSON.stringify({ model: "gpt-6-luna-2026", choices: [{ index: 0, message: { role: "assistant", content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });

const liteLlmError = (status: number, message: string, type = "invalid_request_error") =>
  new Response(JSON.stringify({ error: { message, type, param: null, code: String(status) } }), { status });

/** A fetch that answers from a queue and records every request. */
function fakeFetch(...answers: Array<Response | ((init: RequestInit) => Promise<Response>)>) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const impl = async (url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const answer = answers.shift();
    if (answer === undefined) throw new Error("no answer queued");
    return typeof answer === "function" ? answer(init) : answer;
  };
  return { fetch: impl as typeof fetch, requests };
}

/** Learned fields per URL and model, the way the host entry keeps them. */
function memory() {
  const saved = new Map<string, readonly string[]>();
  const of = (model: string) => ({
    fields: saved.get(`${endpoint.url} ${model}`) ?? [],
    save: (fields: readonly string[]) => void saved.set(`${endpoint.url} ${model}`, fields),
  });
  return { saved, of };
}

describe("request shape", () => {
  it("posts the prompt as the user message and asks for json_schema output", async () => {
    const f = fakeFetch(chat('{"title":"Fix login bug"}'));
    const out = await complete(input(), endpoint, { fetch: f.fetch });

    expect(out).toEqual({ ok: true, model: "gpt-6-luna", value: { title: "Fix login bug" } });
    expect(f.requests).toHaveLength(1);
    const [request] = f.requests;
    expect(request.url).toBe("https://gateway.example.com/v1/chat/completions");
    expect(request.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-test" });
    expect(request.body).toEqual({
      model: "gpt-6-luna",
      messages: expect.any(Array),
      stream: false,
      response_format: { type: "json_schema", json_schema: { name: "result", schema: titleSchema, strict: false } },
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
      enable_thinking: false,
      max_tokens: 256,
    });
    const messages = request.body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content.startsWith(input().prompt)).toBe(true);
    expect(messages[0].content).toContain(JSON.stringify(titleSchema));
  });

  it("sends no Authorization header without a key", async () => {
    const f = fakeFetch(chat('{"title":"x"}'));
    await complete(input(), { id: "mlx", url: "http://127.0.0.1:8080/v1", key: null }, { fetch: f.fetch });
    expect(f.requests[0].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("asks for strict mode only when OpenAI's strict mode accepts the schema", () => {
    expect(isStrictSchema(titleSchema)).toBe(false);
    expect(isStrictSchema({ ...titleSchema, additionalProperties: false })).toBe(true);
    expect(
      isStrictSchema({
        type: "object",
        additionalProperties: false,
        required: ["a"],
        properties: { a: { type: "object", properties: { b: { type: "string" } }, required: ["b"] } },
      }),
    ).toBe(false);
  });
});

describe("structured output paths", () => {
  it("falls back to prompt-only JSON when the server rejects response_format", async () => {
    const f = fakeFetch(
      liteLlmError(400, "This model does not support structured output"),
      chat('Sure! Here it is:\n```json\n{"title": "Fix login bug"}\n```'),
    );
    const out = await complete(input(), endpoint, { fetch: f.fetch });

    expect(out).toEqual({ ok: true, model: "gpt-6-luna", value: { title: "Fix login bug" } });
    expect(f.requests).toHaveLength(2);
    expect(Object.keys(f.requests[1].body)).toEqual(["model", "messages", "stream"]);
  });

  it("drops only the fields the error names, and remembers that per URL and model", async () => {
    const learned = memory();
    const f = fakeFetch(
      liteLlmError(400, "litellm.UnsupportedParamsError: azure does not support parameters: ['reasoning_effort'], for model=gpt-6-luna"),
      liteLlmError(400, "Unrecognized request arguments supplied: chat_template_kwargs, enable_thinking"),
      chat('{"title":"Fix login bug"}'),
      chat('{"title":"Again"}'),
      chat('{"title":"Other model"}'),
    );
    await complete(input(), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });
    await complete(input(), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });
    await complete(input({ model: "gpt-6-sol" }), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-sol") });

    const sent = f.requests.map((r) => Object.keys(r.body).filter((k) => !["model", "messages", "stream"].includes(k)));
    expect(sent).toEqual([
      ["response_format", "reasoning_effort", "chat_template_kwargs", "enable_thinking", "max_tokens"],
      ["response_format", "chat_template_kwargs", "enable_thinking", "max_tokens"],
      ["response_format", "max_tokens"],
      ["response_format", "max_tokens"],
      ["response_format", "reasoning_effort", "chat_template_kwargs", "enable_thinking", "max_tokens"],
    ]);
  });

  it("forgets the learned fields and sends every field when the server names one it was not sent", async () => {
    const learned = memory();
    learned.saved.set(`${endpoint.url} gpt-6-luna`, ["reasoning_effort", "max_tokens"]);
    const f = fakeFetch(
      liteLlmError(400, "max_tokens is required for this model"),
      chat('{"title":"Fix login bug"}'),
    );
    const out = await complete(input(), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });

    expect(out).toMatchObject({ ok: true, value: { title: "Fix login bug" } });
    expect(f.requests[0].body).not.toHaveProperty("max_tokens");
    expect(f.requests[1].body).toMatchObject({ reasoning_effort: "none", max_tokens: 256 });
    expect(learned.saved.get(`${endpoint.url} gpt-6-luna`)).toEqual([]);
  });

  it("keeps the learned fields when an error names none of them", async () => {
    const learned = memory();
    learned.saved.set(`${endpoint.url} gpt-6-luna`, ["reasoning_effort"]);
    const f = fakeFetch(liteLlmError(400, "Unknown parameter: 'enable_thinking'"), chat('{"title":"x"}'));
    await complete(input(), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });

    expect(f.requests[1].body).not.toHaveProperty("reasoning_effort");
    expect(learned.saved.get(`${endpoint.url} gpt-6-luna`)).toEqual(["reasoning_effort", "enable_thinking"]);
  });

  it("learns nothing when the fallback fails too", async () => {
    const learned = memory();
    const f = fakeFetch(
      liteLlmError(422, "Budget has been exceeded!", "budget_exceeded"),
      liteLlmError(422, "Budget has been exceeded!", "budget_exceeded"),
    );
    const out = await complete(input(), endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });

    expect(out).toEqual({ ok: false, code: "request_failed", message: "HTTP 422: Budget has been exceeded!" });
    expect(learned.saved.size).toBe(0);
  });

  it("reads the answer after a thinking model's </think>", async () => {
    const f = fakeFetch(chat('<think>The user wants {"title": "wrong"}</think>\n{"title":"Right"}'));
    const out = await complete(input({ serviceId: "local" }), endpoint, { fetch: f.fetch });
    expect(out).toMatchObject({ ok: true, value: { title: "Right" } });
  });

  it("reads reasoning_content when a thinking model left content empty", async () => {
    const f = fakeFetch(
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", reasoning_content: 'Title: {"title":"Fix login bug"}' } }] })),
    );
    const out = await complete(input({ serviceId: "local" }), endpoint, { fetch: f.fetch });
    expect(out).toMatchObject({ ok: true, value: { title: "Fix login bug" } });
  });

  it("returns invalid_response when a required key is missing", async () => {
    const f = fakeFetch(chat('{"name":"Fix login bug"}'));
    const out = await complete(input(), endpoint, { fetch: f.fetch });
    expect(out).toEqual({ ok: false, code: "invalid_response", message: "The answer lacks required keys: title." });
  });

  it.each([
    ["prose without JSON", chat("Fix login bug")],
    ["no choices", new Response('{"choices":[]}')],
    ["a body that is not JSON", new Response("<html>proxy error</html>")],
  ])("returns invalid_response for %s", async (_name, response) => {
    const out = await complete(input(), endpoint, { fetch: fakeFetch(response).fetch });
    expect(out).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("finds the first JSON object in text", () => {
    expect(extractJsonObject('a {b} then {"x": "}{", "y": {"z": 1}} and {"w": 2}')).toEqual({ x: "}{", y: { z: 1 } });
    expect(extractJsonObject('["not", "an", "object"]')).toBeNull();
    expect(extractJsonObject('{"open": ')).toBeNull();
  });
});

describe("error codes", () => {
  it.each([
    [401, "auth_required"],
    [403, "auth_required"],
    [404, "request_failed"],
    [408, "timeout"],
    [429, "rate_limited"],
    [500, "service_unavailable"],
    [502, "service_unavailable"],
    [503, "service_unavailable"],
    [504, "service_unavailable"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const f = fakeFetch(liteLlmError(status, "upstream said no"));
    const out = await complete(input(), endpoint, { fetch: f.fetch });
    expect(out).toEqual({ ok: false, code, message: `HTTP ${status}: upstream said no` });
  });

  it("keeps the error text short and never echoes the key", () => {
    const failure = httpFailure(400, "x".repeat(1_000));
    expect(failure.message.length).toBeLessThan(320);
    expect(failure.message).not.toContain("sk-test");
  });

  it("maps a network error to service_unavailable", async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }) })));
    const out = await complete(input(), endpoint, { fetch: f.fetch });
    expect(out).toEqual({
      ok: false,
      code: "service_unavailable",
      message: 'Could not reach endpoint "gateway": fetch failed (ECONNREFUSED)',
    });
  });
});

describe("timeout", () => {
  const hang = (init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });

  it("aborts the request and returns timeout when timeoutMs passes", async () => {
    const started = Date.now();
    const out = await complete(input({ timeoutMs: 50 }), endpoint, { fetch: fakeFetch(hang).fetch });
    expect(out).toEqual({ ok: false, code: "timeout", message: 'No answer from endpoint "gateway" within 50 ms.' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("counts the fallback request against the same deadline", async () => {
    const f = fakeFetch(liteLlmError(400, "bad response_format"), hang);
    const out = await complete(input({ timeoutMs: 50 }), endpoint, { fetch: f.fetch });
    expect(out).toMatchObject({ ok: false, code: "timeout" });
  });

  it("returns request_failed when bb cancels the request", async () => {
    const cancel = new AbortController();
    const pending = complete(input(), endpoint, { fetch: fakeFetch(hang).fetch, signal: cancel.signal });
    cancel.abort();
    expect(await pending).toEqual({ ok: false, code: "request_failed", message: "bb cancelled the request." });
  });
});
