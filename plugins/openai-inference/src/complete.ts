/**
 * Answers one bb helper completion over OpenAI Chat Completions
 * (`POST {baseUrl}/chat/completions`), and maps every failure to the error
 * code bb's retry and fallback key on.
 */
import type {
  ExperimentalAiInferenceCompleteInput,
  ExperimentalAiInferenceCompleteOutput,
  ExperimentalAiServiceErrorCode,
} from "@get-bb/plugin-sdk/ai-services";
import type { Endpoint } from "./endpoint.js";

type JsonObject = { [key: string]: unknown };
type Failure = Extract<ExperimentalAiInferenceCompleteOutput, { ok: false }>;

/**
 * How a request asks the model not to think: OpenAI's `reasoning_effort`, or
 * the `enable_thinking` switch local servers pass to the chat template
 * (`chat_template_kwargs` for mlx_lm.server, vLLM and llama.cpp, top level for
 * mlx-vlm).
 */
export type ThinkingOff = "reasoning_effort" | "enable_thinking";

/** Which optional request fields an endpoint and model accept. */
export interface Features {
  /** `response_format: json_schema`. */
  structured: boolean;
  /** The fields of `CompleteOptions.thinkingOff`. */
  thinkingOff: boolean;
}

export interface CompleteOptions {
  /** Sends these fields until the endpoint rejects them. */
  thinkingOff: ThinkingOff;
  /** What each endpoint and model rejected before, so it is not asked again. */
  learned?: Map<string, Features>;
  /** Aborted when bb cancels the request. */
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

const ERROR_DETAIL_CHARS = 300;
/**
 * Enough for a title or a commit message. Without it a local server uses its
 * own default (512 on mlx_lm.server), and a model that thinks anyway spends
 * bb's few seconds on thinking.
 */
const MAX_TOKENS = 256;
const THINKING_FIELDS = /reasoning_effort|enable_thinking|chat_template_kwargs/i;

const fail = (code: ExperimentalAiServiceErrorCode, message: string): Failure => ({ ok: false, code, message });

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Asks the endpoint for a JSON value matching `input.outputSchema`.
 *
 * The first request asks for it with `response_format: json_schema`, and
 * asks the model not to think. When the server rejects it (HTTP 400 or 422),
 * the request is sent again without the thinking fields if the error names
 * one, else without both; when that succeeds, `options.learned` records it for
 * the next call. Every request carries the schema in the prompt too, so a
 * server that ignores `response_format` still answers in JSON.
 *
 * Args:
 *   input: bb's `ai.inference.complete` request.
 *   endpoint: Where to send it.
 *   options: See `CompleteOptions`.
 *
 * Returns:
 *   The value, or a failure whose code bb's fallback keys on.
 */
export async function complete(
  input: ExperimentalAiInferenceCompleteInput,
  endpoint: Endpoint,
  options: CompleteOptions,
): Promise<ExperimentalAiInferenceCompleteOutput> {
  const fetchImpl = options.fetch ?? fetch;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), input.timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  const post = (body: JsonObject) =>
    fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  const key = `${endpoint.baseUrl} ${input.model}`;
  let features = options.learned?.get(key) ?? { structured: true, thinkingOff: true };
  try {
    let response = await post(requestBody(input, features, options.thinkingOff));
    while ((response.status === 400 || response.status === 422) && (features.structured || features.thinkingOff)) {
      const rejectsThinking = THINKING_FIELDS.test(await response.text()) && features.thinkingOff;
      features = rejectsThinking ? { ...features, thinkingOff: false } : { structured: false, thinkingOff: false };
      response = await post(requestBody(input, features, options.thinkingOff));
      // Learned only from a success: a 400 or 422 can mean something else,
      // such as an unknown model or, from LiteLLM, a spent budget.
      if (response.ok) options.learned?.set(key, features);
    }
    if (!response.ok) return httpFailure(response.status, await response.text());
    return parseCompletion(await response.text(), input);
  } catch (error) {
    if (deadline.signal.aborted) return fail("timeout", `No answer from ${endpoint.baseUrl} within ${input.timeoutMs} ms.`);
    if (options.signal?.aborted) return fail("request_failed", "bb cancelled the request.");
    return fail("service_unavailable", `Could not reach ${endpoint.baseUrl}: ${describe(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The Chat Completions request body; exported for tests. */
export function requestBody(
  input: ExperimentalAiInferenceCompleteInput,
  { structured, thinkingOff }: Features,
  style: ThinkingOff,
): JsonObject {
  const instruction =
    "Do not call any tool. Reply with only a JSON object, and no other text, that matches this JSON Schema:\n" +
    JSON.stringify(input.outputSchema);
  return {
    model: input.model,
    messages: [{ role: "user", content: `${input.prompt}\n\n${instruction}` }],
    stream: false,
    max_tokens: MAX_TOKENS,
    ...(structured
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "result", schema: input.outputSchema, strict: isStrictSchema(input.outputSchema) },
          },
        }
      : {}),
    ...(thinkingOff && style === "reasoning_effort" ? { reasoning_effort: input.reasoningEffort } : {}),
    ...(thinkingOff && style === "enable_thinking"
      ? { chat_template_kwargs: { enable_thinking: false }, enable_thinking: false }
      : {}),
  };
}

/**
 * Whether OpenAI's strict mode accepts the schema: every object lists all its
 * properties as required and sets `additionalProperties: false`. Asking for
 * strict mode with any other schema gets HTTP 400.
 */
export function isStrictSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictSchema);
  if (!isObject(schema)) return true;
  if (schema.type === "object" || isObject(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    const keys = Object.keys(isObject(schema.properties) ? schema.properties : {});
    if (schema.additionalProperties !== false || keys.some((key) => !required.includes(key))) return false;
  }
  return Object.values(schema).every(isStrictSchema);
}

/** Maps an HTTP error status to bb's error code. */
export function httpFailure(status: number, body: string): Failure {
  const detail = errorDetail(body);
  const message = `HTTP ${status}${detail ? `: ${detail}` : ""}`;
  if (status === 401 || status === 403) return fail("auth_required", message);
  if (status === 408) return fail("timeout", message);
  if (status === 429) return fail("rate_limited", message);
  if (status >= 500) return fail("service_unavailable", message);
  return fail("request_failed", message);
}

function errorDetail(body: string): string {
  let detail = body;
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isObject(parsed) ? parsed.error : undefined;
    const message = isObject(error) ? error.message : (error ?? (isObject(parsed) ? parsed.detail : undefined));
    if (typeof message === "string") detail = message;
  } catch {
    // Not JSON: keep the text as it is.
  }
  detail = detail.replace(/\s+/g, " ").trim();
  return detail.length > ERROR_DETAIL_CHARS ? `${detail.slice(0, ERROR_DETAIL_CHARS)}...` : detail;
}

function parseCompletion(text: string, input: ExperimentalAiInferenceCompleteInput): ExperimentalAiInferenceCompleteOutput {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("invalid_response", "The response is not JSON.");
  }
  const choices = isObject(body) && Array.isArray(body.choices) ? body.choices : [];
  const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : undefined;
  // A server that splits out a thinking model's reasoning may leave the
  // answer there when the model never closed its thinking.
  const content = [message?.content, message?.reasoning_content].find((text) => typeof text === "string" && text.trim() !== "");
  if (typeof content !== "string") {
    return fail("invalid_response", "The response has no message content.");
  }
  const value = extractJsonObject(withoutThinking(content));
  if (value === null) return fail("invalid_response", "The answer holds no JSON object.");
  const required = Array.isArray(input.outputSchema.required) ? input.outputSchema.required : [];
  const missing = required.filter((key): key is string => typeof key === "string" && !(key in value));
  if (missing.length > 0) return fail("invalid_response", `The answer lacks required keys: ${missing.join(", ")}.`);
  return { ok: true, model: input.model, value: value as Extract<ExperimentalAiInferenceCompleteOutput, { ok: true }>["value"] };
}

/** Drops the reasoning a thinking model writes before `</think>`. */
const withoutThinking = (content: string): string => {
  const end = content.lastIndexOf("</think>");
  return end === -1 ? content : content.slice(end + "</think>".length);
};

/** The first JSON object in `text`, which may be wrapped in prose or a code fence. */
export function extractJsonObject(text: string): JsonObject | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = closingBrace(text, start);
    if (end === -1) return null;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (isObject(value)) return value;
    } catch {
      // Braces in prose: try the next one.
    }
  }
  return null;
}

function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : null;
  return cause ? `${error.message} (${cause})` : error.message;
}
