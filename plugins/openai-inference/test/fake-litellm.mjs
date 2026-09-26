#!/usr/bin/env node
/**
 * A dependency-free fake of a LiteLLM proxy's `/v1/chat/completions`, with
 * LiteLLM's error bodies and status codes. Use it from tests with
 * {@link startFakeLiteLlm}, or run it for a live check against a running bb:
 *
 *   node test/fake-litellm.mjs --port 4466 --key sk-test
 *   curl localhost:4466/__admin/requests
 *
 * Models:
 * `gpt-6-luna` accepts everything and answers with a title. `no-reasoning`
 * rejects `reasoning_effort` the way LiteLLM does when its cost map lacks the
 * model. `slow` answers after `slowMs`, and `hang` never does. `limited`
 * answers 429, `down` 503, and `echo` 500 with the request's URL and headers
 * in its error. Any other model is unknown (400).
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const MODELS = ["gpt-6-luna", "no-reasoning", "slow", "hang", "limited", "down", "echo"];

const error = (status, message, type) => ({ status, body: { error: { message, type, param: null, code: String(status) } } });

/** A title from the prompt's task, the way a model would write one. */
function titleFor(prompt) {
  const task = prompt.split("Task:\n")[1] ?? prompt;
  return task.split(/\s+/).filter(Boolean).slice(0, 5).join(" ") || "Untitled";
}

function answer(request, slowMs, req) {
  const { model, messages, reasoning_effort: effort } = request;
  if (!MODELS.includes(model)) {
    return error(400, `/chat/completions: Invalid model name passed in model=${model}. Call \`/v1/models\` to view available models for your key.`, "invalid_request_error");
  }
  if (model === "limited") return error(429, "Rate limit reached for this key.", "throttling_error");
  if (model === "down") return error(503, "Service unavailable: no healthy deployment.", "None");
  if (model === "no-reasoning" && effort !== undefined) {
    return error(400, `litellm.UnsupportedParamsError: azure does not support parameters: ['reasoning_effort'], for model=${model}. To drop these, set \`litellm.drop_params=True\`.`, "None");
  }
  if (model === "echo") {
    return error(500, `Upstream failed for ${req.headers.host}${req.url} with headers ${JSON.stringify(req.headers)}`, "None");
  }
  const content = titleFor(messages?.[0]?.content ?? "");
  const body = {
    id: "chatcmpl-fake",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  };
  return { status: 200, body, delayMs: model === "slow" ? slowMs : model === "hang" ? Infinity : 0 };
}

export async function startFakeLiteLlm(opts = {}) {
  const key = opts.key ?? "sk-test";
  const slowMs = opts.slowMs ?? 10_000;
  /**
   * Every completion request's body, whether it was authorized, when its
   * connection closed, and the message content it was answered with.
   */
  const requests = [];
  const sockets = new Set();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/__admin/requests") return send(200, requests);
    if (req.method !== "POST" || !["/v1/chat/completions", "/chat/completions"].includes(url.pathname)) {
      return send(404, { detail: "Not Found" });
    }
    let text = "";
    for await (const chunk of req) text += chunk;
    const authorized = String(req.headers.authorization ?? "") === `Bearer ${key}`;
    let request;
    try {
      request = JSON.parse(text);
    } catch {
      return send(400, error(400, "Invalid JSON body", "invalid_request_error").body);
    }
    const record = { path: url.pathname, authorized, body: request, closedAt: undefined, answer: undefined };
    requests.push(record);
    res.on("close", () => (record.closedAt = Date.now()));
    if (!authorized) {
      return send(401, error(401, "Authentication Error, Invalid proxy server token passed.", "auth_error").body);
    }
    const { status, body, delayMs = 0 } = answer(request, slowMs, req);
    if (delayMs === Infinity) return;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (res.destroyed) return;
    record.answer = body.choices?.[0]?.message.content;
    send(status, body);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://${opts.host ?? "127.0.0.1"}:${port}`,
    port,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const fake = await startFakeLiteLlm({
    port: Number(arg("port", "4466")),
    key: arg("key", "sk-test"),
    host: arg("host", "127.0.0.1"),
  });
  console.log(`fake LiteLLM on ${fake.url}/v1 (key ${arg("key", "sk-test")}; models ${MODELS.join(", ")})`);
  console.log(`  requests: curl ${fake.url}/__admin/requests`);
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
