import { describe, expect, it } from "vitest";
import { complete } from "../src/complete.js";

// A prompt the way bb writes one for a thread title.
const prompt = "You create concise titles for coding tasks.\nTask:\nFix the login bug";

const endpoint = { id: "gateway", url: "https://gateway.example.com/v1", key: "sk-test", model: "gpt-6-luna" };

const chat = (content: unknown, status = 200) =>
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
  it("posts bb's prompt unchanged as the one user message, asking the model not to think", async () => {
    const f = fakeFetch(chat("Fix login bug"));
    expect(await complete(prompt, endpoint, { fetch: f.fetch })).toBe("Fix login bug");

    expect(f.requests).toHaveLength(1);
    const [request] = f.requests;
    expect(request.url).toBe("https://gateway.example.com/v1/chat/completions");
    expect(request.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-test" });
    expect(request.body).toEqual({
      model: "gpt-6-luna",
      messages: [{ role: "user", content: prompt }],
      stream: false,
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
      enable_thinking: false,
      max_tokens: 256,
    });
  });

  it("sends no Authorization header without a key", async () => {
    const f = fakeFetch(chat("x"));
    await complete(prompt, { ...endpoint, key: null }, { fetch: f.fetch });
    expect(f.requests[0].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("returns the message content as the server wrote it", async () => {
    const content = '<think>hm</think>\n"Fix login bug"\n\nTitle: extra';
    expect(await complete(prompt, endpoint, { fetch: fakeFetch(chat(content)).fetch })).toBe(content);
  });
});

describe("fields a server refuses", () => {
  it("drops only the fields the error names, and remembers that per URL and model", async () => {
    const learned = memory();
    const f = fakeFetch(
      liteLlmError(400, "litellm.UnsupportedParamsError: azure does not support parameters: ['reasoning_effort'], for model=gpt-6-luna"),
      liteLlmError(422, "Unrecognized request arguments supplied: chat_template_kwargs, enable_thinking"),
      chat("Fix login bug"),
      chat("Again"),
      chat("Other model"),
    );
    expect(await complete(prompt, endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") })).toBe("Fix login bug");
    await complete(prompt, endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });
    await complete(prompt, { ...endpoint, model: "gpt-6-sol" }, { fetch: f.fetch, learned: learned.of("gpt-6-sol") });

    const sent = f.requests.map((r) => Object.keys(r.body).filter((k) => !["model", "messages", "stream"].includes(k)));
    expect(sent).toEqual([
      ["reasoning_effort", "chat_template_kwargs", "enable_thinking", "max_tokens"],
      ["chat_template_kwargs", "enable_thinking", "max_tokens"],
      ["max_tokens"],
      ["max_tokens"],
      ["reasoning_effort", "chat_template_kwargs", "enable_thinking", "max_tokens"],
    ]);
  });

  it("drops every optional field when the error names none", async () => {
    const f = fakeFetch(liteLlmError(400, "Bad request"), chat("x"));
    await complete(prompt, endpoint, { fetch: f.fetch });
    expect(Object.keys(f.requests[1].body)).toEqual(["model", "messages", "stream"]);
  });

  it("forgets the learned fields and sends every field when the server names one it was not sent", async () => {
    const learned = memory();
    learned.saved.set(`${endpoint.url} gpt-6-luna`, ["reasoning_effort", "max_tokens"]);
    const f = fakeFetch(liteLlmError(400, "max_tokens is required for this model"), chat("Fix login bug"));
    expect(await complete(prompt, endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") })).toBe("Fix login bug");

    expect(f.requests[0].body).not.toHaveProperty("max_tokens");
    expect(f.requests[1].body).toMatchObject({ reasoning_effort: "none", max_tokens: 256 });
    expect(learned.saved.get(`${endpoint.url} gpt-6-luna`)).toEqual([]);
  });

  it("keeps the learned fields when an error names none of them", async () => {
    const learned = memory();
    learned.saved.set(`${endpoint.url} gpt-6-luna`, ["reasoning_effort"]);
    const f = fakeFetch(liteLlmError(400, "Unknown parameter: 'enable_thinking'"), chat("x"));
    await complete(prompt, endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") });

    expect(f.requests[1].body).not.toHaveProperty("reasoning_effort");
    expect(learned.saved.get(`${endpoint.url} gpt-6-luna`)).toEqual(["reasoning_effort", "enable_thinking"]);
  });

  it("learns nothing, and rejects, when the request without the fields fails too", async () => {
    const learned = memory();
    const f = fakeFetch(
      liteLlmError(422, "Budget has been exceeded!", "budget_exceeded"),
      liteLlmError(422, "Budget has been exceeded!", "budget_exceeded"),
    );
    await expect(complete(prompt, endpoint, { fetch: f.fetch, learned: learned.of("gpt-6-luna") })).rejects.toThrow(
      'Endpoint "gateway" answered HTTP 422: Budget has been exceeded!',
    );
    expect(learned.saved.size).toBe(0);
  });
});

describe("failures", () => {
  it.each([401, 404, 429, 500, 503])("rejects HTTP %i with the endpoint, the status and the server's message", async (status) => {
    const f = fakeFetch(liteLlmError(status, "upstream said no"));
    await expect(complete(prompt, endpoint, { fetch: f.fetch })).rejects.toThrow(`Endpoint "gateway" answered HTTP ${status}: upstream said no`);
  });

  it("cuts the server's error text to a few hundred characters", async () => {
    const error = await complete(prompt, endpoint, { fetch: fakeFetch(liteLlmError(500, "x".repeat(1_000))).fetch }).catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(360);
  });

  it("redacts the server's error text before cutting it", async () => {
    const body = `${"x".repeat(290)} sk-test-secret-key`;
    const redact = (text: string) => text.split("sk-test-secret-key").join("<key>");
    const error = await complete(prompt, endpoint, { fetch: fakeFetch(liteLlmError(500, body)).fetch, redact }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain("sk-test");
  });

  it.each([
    ["no choices", new Response('{"choices":[]}'), 'Endpoint "gateway" answered without message content.'],
    ["null content", chat(null), 'Endpoint "gateway" answered without message content.'],
    ["blank content", chat("  "), 'Endpoint "gateway" answered without message content.'],
    ["a body that is not JSON", new Response("<html>proxy error</html>"), 'Endpoint "gateway" answered with something that is not JSON.'],
  ])("rejects %s", async (_name, response, message) => {
    await expect(complete(prompt, endpoint, { fetch: fakeFetch(response).fetch })).rejects.toThrow(message);
  });

  it("rejects a network error, naming the endpoint and the cause", async () => {
    const f = fakeFetch(() =>
      Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }) })),
    );
    await expect(complete(prompt, endpoint, { fetch: f.fetch })).rejects.toThrow(
      'Could not reach Endpoint "gateway": fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:9)',
    );
  });

  it("aborts the request when bb cancels it", async () => {
    const cancel = new AbortController();
    let aborted = false;
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => ((aborted = true), reject(init.signal?.reason)), { once: true });
      });
    const pending = complete(prompt, endpoint, { fetch: fakeFetch(hang).fetch, signal: cancel.signal });
    cancel.abort();
    await expect(pending).rejects.toThrow('bb cancelled the request to Endpoint "gateway".');
    expect(aborted).toBe(true);
  });
});
