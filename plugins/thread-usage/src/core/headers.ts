/**
 * The per-thread attribution header: values for
 * `bb.providers.experimental_contributeEnv`, and validation of the "extra
 * headers" setting.
 */
import { sessionIdFor } from "./gateway";

export const SESSION_HEADER = "x-litellm-session-id";
export const SESSION_ENV = "BB_USAGE_SESSION";

export interface EnvEntry {
  name: string;
  value: string;
  reason: string;
}

/** Header names that carry credentials; values appear verbatim in timeline events. */
export function isAuthHeader(name: string): boolean {
  const n = name.trim().toLowerCase();
  return (
    n === "authorization" ||
    n === "proxy-authorization" ||
    n === "x-api-key" ||
    n === "x-litellm-api-key" ||
    n === "cookie" ||
    // Any name with a credential word as one of its parts: api-key, apikey,
    // x-auth-token, client-secret, ocp-apim-subscription-key, …
    /(^|-)(api-?key|key|secret|token|auth|password|passwd|credentials?|session-key)(-|$)/.test(n)
  );
}

export interface ParsedHeaders {
  headers: { name: string; value: string }[];
  errors: string[];
}

/** Parses `Name: Value` lines. Blank lines and `#` comments are skipped. */
export function parseExtraHeaders(text: string): ParsedHeaders {
  const headers: { name: string; value: string }[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      errors.push(`Line ${i + 1}: expected "Name: Value"`);
      return;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      errors.push(`Line ${i + 1}: "${name}" is not a valid header name`);
    } else if (isAuthHeader(name)) {
      errors.push(
        `Line ${i + 1}: "${name}" carries credentials; bb shows these values in the timeline, so it is not allowed here`,
      );
    } else if (name.toLowerCase() === SESSION_HEADER) {
      errors.push(`Line ${i + 1}: ${SESSION_HEADER} is set by the plugin`);
    } else {
      headers.push({ name, value });
    }
  });
  return { headers, errors };
}

export function extraHeadersError(text: string): string | null {
  const { errors } = parseExtraHeaders(text);
  return errors[0] ?? null;
}

/**
 * Environment entries for one provider command. Claude Code gets the full
 * `ANTHROPIC_CUSTOM_HEADERS` (it cannot expand variables); other harnesses
 * get `BB_USAGE_SESSION`, which their own config turns into the header.
 * Cursor gets nothing: it cannot use a custom gateway.
 */
export function attributionEnv(
  providerId: string,
  threadId: string,
  extraHeaders: string,
): EnvEntry[] {
  const session = sessionIdFor(threadId);
  if (providerId === "claude-code") {
    const extra = parseExtraHeaders(extraHeaders).headers.map((h) => `${h.name}: ${h.value}`);
    return [
      {
        name: "ANTHROPIC_CUSTOM_HEADERS",
        value: [`${SESSION_HEADER}: ${session}`, ...extra].join("\n"),
        reason: "Thread Usage: tag gateway requests with this bb thread",
      },
    ];
  }
  if (providerId.includes("cursor")) return [];
  return [
    {
      name: SESSION_ENV,
      value: session,
      reason: "Thread Usage: gateway session id for this bb thread",
    },
  ];
}
