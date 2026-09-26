/**
 * Answers one bb AI task over OpenAI Chat Completions
 * (`POST {url}/chat/completions`) with the model's text, and rejects with a
 * message naming the Endpoint when it cannot.
 */
import type { ExpandedEndpoint } from "./endpoints.js";

type JsonObject = { [key: string]: unknown };

/** What the Endpoint's URL refused before for its model. */
export interface Learned {
  /** The optional fields left out of the first request. */
  fields: readonly string[];
  /** Records the fields to leave out from now on; none forgets the entry. */
  save(fields: readonly string[]): void;
}

export interface CompleteOptions {
  /** The optional fields this URL and model refused before, so they are not sent again. */
  learned?: Learned;
  /** Aborted when bb cancels the request. */
  signal?: AbortSignal;
  /** Takes every secret out of text the server or the network wrote, before it is cut short. */
  redact?: (text: string) => string;
  fetch?: typeof fetch;
}

const ERROR_DETAIL_CHARS = 300;
/**
 * Enough for a title or a commit message. Without it a local server uses its
 * own default (512 on mlx_lm.server), and a model that thinks anyway spends
 * bb's few seconds on thinking.
 */
const MAX_TOKENS = 256;

/**
 * The request fields a server may refuse, with the words that name each in
 * an error. `reasoning_effort` turns thinking off for OpenAI models;
 * `chat_template_kwargs` does for mlx_lm.server, vLLM and llama.cpp, and a
 * top-level `enable_thinking` for mlx-vlm.
 */
const OPTIONAL_FIELDS: Record<string, RegExp> = {
  reasoning_effort: /reasoning_effort/i,
  chat_template_kwargs: /chat_template_kwargs/i,
  enable_thinking: /enable_thinking/i,
  max_tokens: /max_tokens/i,
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Sends bb's prompt to the Endpoint and returns the answer's message content.
 *
 * The request asks the model not to think and caps the answer's length. A
 * server that refuses a field answers HTTP 400 or 422: the request is sent
 * again without the fields the error names, or without all optional fields
 * when it names none. When a request then succeeds, `options.learned` records
 * what was dropped. When the first request left out learned fields and its
 * error names one of them, the server has changed: the learned fields are
 * forgotten and the request starts again with every field.
 *
 * Args:
 *   prompt: bb's prompt, sent unchanged.
 *   endpoint: Where to send it.
 *   options: See `CompleteOptions`.
 *
 * Returns:
 *   The message content as the server returned it.
 *
 * Throws:
 *   Error: The server answered with an error, could not be reached, or its
 *     answer holds no message content; or bb aborted the request.
 */
export async function complete(prompt: string, endpoint: ExpandedEndpoint, options: CompleteOptions = {}): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const redact = options.redact ?? ((text: string) => text);
  const post = (body: JsonObject) =>
    fetchImpl(`${endpoint.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  // A network error, unless bb aborted the request.
  const failure = (message: string) =>
    new Error(options.signal?.aborted ? `bb cancelled the request to Endpoint "${endpoint.id}".` : message);
  const learned = options.learned?.fields ?? [];
  let dropped = learned;
  let response: Response;
  let error: string | undefined;
  try {
    response = await post(requestBody(endpoint.model, prompt, dropped));
    while (response.status === 400 || response.status === 422) {
      const text = await response.text();
      const named = (fields: readonly string[]) => fields.filter((field) => OPTIONAL_FIELDS[field].test(text));
      if (dropped === learned && named(learned).length > 0) {
        // It names a field it was not sent, so what was learned no longer holds.
        options.learned?.save([]);
        dropped = [];
      } else {
        const left = Object.keys(OPTIONAL_FIELDS).filter((field) => !dropped.includes(field));
        if (left.length === 0) {
          error = text;
          break;
        }
        dropped = [...dropped, ...(named(left).length > 0 ? named(left) : left)];
      }
      response = await post(requestBody(endpoint.model, prompt, dropped));
    }
    // Learned only from a success: a 400 or 422 can mean something else,
    // such as an unknown model or, from LiteLLM, a spent budget.
    if (response.ok && dropped !== learned) options.learned?.save(dropped);
    if (!response.ok) error ??= await response.text();
  } catch (cause) {
    throw failure(`Could not reach Endpoint "${endpoint.id}": ${redact(describe(cause))}`);
  }
  if (error !== undefined) {
    const detail = errorDetail(redact(error));
    throw new Error(`Endpoint "${endpoint.id}" answered HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw failure(`Endpoint "${endpoint.id}" broke off its answer: ${redact(describe(cause))}`);
  }
  return messageContent(text, endpoint.id);
}

/** The Chat Completions request body, without the `dropped` fields; exported for tests. */
export function requestBody(model: string, prompt: string, dropped: readonly string[] = []): JsonObject {
  const body: JsonObject = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
    enable_thinking: false,
    max_tokens: MAX_TOKENS,
  };
  for (const field of dropped) delete body[field];
  return body;
}

/** The server's own error message out of an error body, on one line and cut short. */
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

function messageContent(text: string, id: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Endpoint "${id}" answered with something that is not JSON.`);
  }
  const choices = isObject(body) && Array.isArray(body.choices) ? body.choices : [];
  const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : undefined;
  if (typeof message?.content !== "string" || message.content.trim() === "") {
    throw new Error(`Endpoint "${id}" answered without message content.`);
  }
  return message.content;
}

/** The error with its cause's code and message, which may name the host and port. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const detail = [cause?.code, cause?.message].filter((part) => typeof part === "string" && part !== "").join(": ");
  return detail ? `${error.message} (${detail})` : error.message;
}
