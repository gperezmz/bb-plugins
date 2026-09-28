// Claude Code transcript lines in the shapes Claude Code 2.x writes them: one
// assistant line per content block, sharing the response's message id and
// requestId and carrying its usage; tool results of mixed size; attachment
// and system lines; and compact boundaries.
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";

const hex = (n) => randomBytes(n).toString("hex");
const filler = (n) => "lorem ipsum dolor sit amet ".repeat(Math.ceil(n / 27)).slice(0, n);

/** The fields every line carries, in Claude Code's order. */
function envelope(session, at, extra) {
  return { parentUuid: randomUUID(), isSidechain: false, userType: "external", cwd: "/work/project", sessionId: session, version: "2.3.4", gitBranch: "main", ...extra, uuid: randomUUID(), timestamp: new Date(at).toISOString() };
}

function prompt(session, at, text) {
  return JSON.stringify(envelope(session, at, { type: "user", message: { role: "user", content: text }, promptId: randomUUID() }));
}

function toolResult(session, at, size) {
  const id = `toolu_${hex(12)}`;
  return JSON.stringify(envelope(session, at, { type: "user", message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: filler(size), is_error: false }] }, toolUseResult: { stdout: filler(Math.min(size, 400)), stderr: "", interrupted: false } }));
}

function attachment(session, at) {
  return JSON.stringify(envelope(session, at, { type: "attachment", attachment: { type: "todo_reminder", content: [{ content: filler(120), status: "in_progress" }] } }));
}

/** One model response: a thinking, a text and a tool-use line with the same usage. */
function response(session, at, { model, context, lifetime, keeper }) {
  const write = keeper ? 300 : 900 + (context % 4000);
  const usage = {
    input_tokens: 3,
    cache_creation_input_tokens: write,
    cache_read_input_tokens: context,
    cache_creation: { ephemeral_5m_input_tokens: lifetime === "5m" ? write : 0, ephemeral_1h_input_tokens: lifetime === "1h" ? write : 0 },
    output_tokens: keeper ? 40 : 350,
    service_tier: "standard",
  };
  const message = { model, id: `msg_${hex(12)}`, type: "message", role: "assistant", stop_reason: null, stop_sequence: null, usage };
  const requestId = `req_${hex(12)}`;
  const blocks = keeper
    ? [{ type: "text", text: "Not finished yet." }]
    : [
        { type: "thinking", thinking: filler(700), signature: hex(200) },
        { type: "text", text: filler(400) },
        { type: "tool_use", id: `toolu_${hex(12)}`, name: "Bash", input: { command: filler(160), description: "Run the tests" } },
      ];
  return blocks.map((block) => JSON.stringify(envelope(session, at, { type: "assistant", message: { ...message, content: [block] }, requestId })));
}

/**
 * One turn's lines: the message that started it, then `calls` requests, each
 * but a keep-warm's followed by a tool result. `at` is the wall time every
 * line is stamped with.
 */
export function turnText({ session = "s", at = Date.now(), text = "Please carry on with the next part of the plan.", model = "claude-opus-5-5", context = 120_000, lifetime = "5m", calls = 9, keeper = false }) {
  const lines = [prompt(session, at, text), attachment(session, at)];
  for (let i = 0; i < calls; i++) {
    lines.push(...response(session, at, { model, context: context + i * 1_500, lifetime, keeper }));
    if (!keeper) lines.push(toolResult(session, at, i % 7 === 3 ? 30_000 : 3_000));
  }
  return lines.join("\n") + "\n";
}

/** `/compact` as Claude Code writes it: the command, a boundary and the summary. */
export function compactText({ session = "s", at = Date.now(), pre = 125_000, post = 22_000 }) {
  return [
    JSON.stringify(envelope(session, at, { type: "user", message: { role: "user", content: "<command-name>/compact</command-name>\n<command-message>compact</command-message>" } })),
    JSON.stringify(envelope(session, at, { type: "system", subtype: "compact_boundary", content: "Conversation compacted", level: "info", compactMetadata: { trigger: "manual", preTokens: pre, postTokens: post } })),
    JSON.stringify(envelope(session, at, { type: "user", isCompactSummary: true, message: { role: "user", content: `This session is being continued from a previous conversation. ${filler(3_000)}` } })),
  ].join("\n") + "\n";
}

/** Writes a transcript of at least `bytes` to `path`: turns of growing context, compacted every 60 turns. */
export function generate(path, bytes, { session = "s", lifetime = "5m", at = Date.parse("2026-09-01T09:00:00Z") } = {}) {
  const fd = openSync(path, "w");
  let size = 0;
  let context = 30_000;
  for (let n = 1; size < bytes; n++) {
    at += 90_000;
    const text = n % 60 === 0 ? compactText({ session, at, pre: context, post: 25_000 }) : turnText({ session, at, context, lifetime, calls: 5 + (n % 8) });
    context = n % 60 === 0 ? 25_000 : context + 9_000;
    size += writeSync(fd, text);
  }
  closeSync(fd);
  return size;
}
