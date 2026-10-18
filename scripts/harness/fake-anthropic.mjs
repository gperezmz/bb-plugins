// A stand-in for Anthropic's Messages API, so the harness's Claude Code
// threads run without spending tokens or reaching the network.
//
// Every request gets a short answer, streamed as server-sent events when
// Claude Code asks for a stream, with usage that has cache fields: a context
// of `context` tokens, of which `write` tokens are written to the 5-minute or
// the 1-hour cache and the rest read from it. The last user text steers the
// answer:
//
//   `Reply with exactly "X"` (a keep-warm, a check-in)  -> X
//   `[fake: background]`                               -> a Bash `sleep 1800` run in the background
//   `[fake: fail]`                                     -> HTTP 400, so the turn ends failed
//   `[fake: hold=N]`                                   -> the answer it would give, N seconds late
//   `/compact`, or a summary request                    -> a short summary
//   anything else, and every tool result                -> "OK"
//
// Settings apply to every thread, from the environment at start or from
// POST /_control; a marker `[fake: key=value]` anywhere in a conversation
// overrides one for that conversation alone. Keys:
//
//   context      tokens a turn reports (CONTEXT, default 800000)
//   lifetime     "5m" or "1h": the cache the writes go to (LIFETIME, default 5m)
//   write        tokens written to the cache by an ordinary turn (WRITE, default 2000)
//   warmWrite    fraction of the context a keep-warm or check-in turn writes
//                instead of reading, as if its cache had gone cold (WARM_WRITE,
//                default 0): the cost stop comes sooner the higher it is
//
// GET /_control answers the settings; GET /_requests the last 200 requests
// (time, model, the settings used and the head of the last user text), also
// appended to REQUEST_LOG when it is set.
//
//   PORT=40180 node fake-anthropic.mjs
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 40180);
const requestLog = process.env.REQUEST_LOG ?? null;

const settings = {
  context: Number(process.env.CONTEXT ?? 800_000),
  lifetime: process.env.LIFETIME === "1h" ? "1h" : "5m",
  write: Number(process.env.WRITE ?? 2000),
  warmWrite: Number(process.env.WARM_WRITE ?? 0),
};
const recent = [];
let n = 0;

/** Checks and converts one setting; throws on a bad value. */
function setting(key, value) {
  switch (key) {
    case "context":
    case "write": {
      const v = Number(value);
      if (!Number.isInteger(v) || v < 0) throw new Error(`${key} must be a whole number of tokens`);
      return v;
    }
    case "lifetime":
      if (value !== "5m" && value !== "1h") throw new Error('lifetime must be "5m" or "1h"');
      return value;
    case "warmWrite": {
      const v = Number(value);
      if (!(v >= 0 && v <= 1)) throw new Error("warmWrite must be a fraction from 0 to 1");
      return v;
    }
    default:
      throw new Error(`unknown setting ${key}`);
  }
}

const blocksOf = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);

/** The last user message's text, "" for a tool result. */
function lastUserText(body) {
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === "user" || m.role === "assistant");
  if (!last || last.role !== "user") return "";
  const blocks = blocksOf(last.content);
  if (blocks.some((b) => b.type === "tool_result")) return "";
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** The settings for one conversation: the shared ones, overridden by its markers. */
function settingsFor(body) {
  const out = { ...settings };
  const convo = JSON.stringify(body.messages ?? []);
  for (const m of convo.matchAll(/\[fake: (context|lifetime|write|warmWrite)=([^\]\\"]+)\]/g)) {
    try {
      out[m[1]] = setting(m[1], m[2]);
    } catch {}
  }
  return out;
}

/** Titles, summaries of tool output and other side calls Claude Code makes on its small model. */
const isSmall = (body) => (body.max_tokens ?? 0) < 1000 || String(body.model ?? "").includes("haiku");

const isKeeperMessage = (text) => /Still waiting on |Don't wait for me either way\./.test(text);

function usageFor(body, text, s) {
  if (isSmall(body)) {
    return { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  }
  const write = Math.min(s.context, isKeeperMessage(text) ? Math.max(s.write, Math.round(s.context * s.warmWrite)) : s.write);
  return {
    input_tokens: 3,
    output_tokens: 20,
    cache_read_input_tokens: s.context - write,
    cache_creation_input_tokens: write,
    cache_creation: s.lifetime === "1h" ? { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write } : { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
  };
}

function answerFor(body, text) {
  if (!isSmall(body) && /\[fake: background\]/.test(text)) {
    const input = { command: "sleep 1800", description: "Wait for the fake deploy", run_in_background: true };
    return { stop: "tool_use", tool: { name: "Bash", input } };
  }
  const exact = /reply with exactly "(.+)"/is.exec(text)?.[1];
  if (exact !== undefined) return { stop: "end_turn", text: exact.replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
  if (/^\/compact|<command-name>\/compact/.test(text.trim()) || /summar/i.test(text.slice(0, 300))) return { stop: "end_turn", text: "Summary: the user asked for short test replies." };
  return { stop: "end_turn", text: "OK" };
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.end();
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function messages(body, res) {
  const text = lastUserText(body);
  const hold = /\[fake: hold=(\d+)\]/.exec(text)?.[1];
  if (hold !== undefined && !isSmall(body)) {
    setTimeout(() => reply(body, res, text), Number(hold) * 1000);
    return;
  }
  reply(body, res, text);
}

function reply(body, res, text) {
  const s = settingsFor(body);
  if (!isSmall(body) && /\[fake: fail\]/.test(text)) {
    const entry = { at: new Date().toISOString(), model: body.model, settings: s, failed: true, text: text.slice(0, 300) };
    recent.push(entry);
    if (recent.length > 200) recent.shift();
    if (requestLog !== null) appendFileSync(requestLog, `${JSON.stringify(entry)}\n`);
    json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "fake: this turn fails on purpose" } });
    return;
  }
  const usage = usageFor(body, text, s);
  const answer = answerFor(body, text);
  const id = `msg_fake_${Date.now()}_${n++}`;
  const entry = { at: new Date().toISOString(), model: body.model, settings: s, usage, text: text.slice(0, 300) };
  recent.push(entry);
  if (recent.length > 200) recent.shift();
  if (requestLog !== null) appendFileSync(requestLog, `${JSON.stringify(entry)}\n`);

  const message = { id, type: "message", role: "assistant", model: body.model ?? "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage };
  const block =
    answer.tool === undefined
      ? { start: { type: "text", text: "" }, delta: { type: "text_delta", text: answer.text }, whole: { type: "text", text: answer.text } }
      : {
          start: { type: "tool_use", id: `toolu_${id}`, name: answer.tool.name, input: {} },
          delta: { type: "input_json_delta", partial_json: JSON.stringify(answer.tool.input) },
          whole: { type: "tool_use", id: `toolu_${id}`, name: answer.tool.name, input: answer.tool.input },
        };
  if (!body.stream) {
    json(res, 200, { ...message, content: [block.whole], stop_reason: answer.stop });
    return;
  }
  sse(res, [
    ["message_start", { message }],
    ["content_block_start", { index: 0, content_block: block.start }],
    ["content_block_delta", { index: 0, delta: block.delta }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: answer.stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }],
    ["message_stop", {}],
  ]);
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://fake");
    let body = {};
    try {
      body = raw === "" ? {} : JSON.parse(raw);
    } catch {
      json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "body is not JSON" } });
      return;
    }
    if (url.pathname === "/_control") {
      if (req.method === "POST") {
        try {
          const next = {};
          for (const [key, value] of Object.entries(body)) next[key] = setting(key, value);
          Object.assign(settings, next);
        } catch (error) {
          json(res, 400, { error: error.message });
          return;
        }
      }
      json(res, 200, settings);
      return;
    }
    if (url.pathname === "/_requests") return json(res, 200, recent);
    if (url.pathname === "/v1/messages/count_tokens") return json(res, 200, { input_tokens: settingsFor(body).context });
    if (url.pathname === "/v1/messages" && req.method === "POST") return messages(body, res);
    // Model lists and anything else Claude Code asks for on start.
    json(res, 200, { data: [], has_more: false });
  });
}).listen(port, "127.0.0.1", () => console.log(`fake Anthropic API on http://127.0.0.1:${port}`));
