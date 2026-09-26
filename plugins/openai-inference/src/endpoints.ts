/**
 * The Endpoints: the entries of the `endpoints` setting, each an
 * OpenAI-compatible server and the model it answers with, which bb offers as
 * one AI service.
 *
 * An Endpoint's url and key may reference bb's environment as `${NAME}`. The
 * server hands the Endpoints to the host entry unexpanded; the host entry,
 * which runs with bb's environment, expands them for each request and writes
 * the expanded values nowhere.
 */
import { z } from "zod";

export const endpointSchema = z
  .object({
    id: z.string().min(1),
    /** Base URL that `/chat/completions` is appended to; may hold `${NAME}`. */
    url: z.string().min(1),
    /** The key in effect: a literal key from the `keys` setting, or a `${NAME}` reference. */
    key: z.string().nullable(),
    /** The model every request names; null only in a setting saved before 0.2.0. */
    model: z.string().nullable(),
  })
  .strict();
export type Endpoint = z.infer<typeof endpointSchema>;
export const endpointListSchema = z.array(endpointSchema);

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const httpUrl = z.url({ protocol: /^https?$/ });

/**
 * The `endpoints` setting as it may be saved: a JSON list of
 * `{id, url, model, key?}`. `model` is optional here so that a value saved
 * before 0.2.0 still lists its Endpoints; `savedModelRequired` refuses a new
 * value without one.
 */
const listedSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "An id is lowercase letters, digits and dashes."),
        url: z
          .string()
          .refine(
            (url) => url.includes("${") || httpUrl.safeParse(url).success,
            "A url is an http:// or https:// URL, or references a variable as ${NAME}.",
          ),
        model: z.string().trim().min(1, "A model is a model name the server serves.").optional(),
        key: z
          .string()
          .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/, "A key here can only be a ${NAME} reference; put a literal key in Endpoint keys.")
          .optional(),
      })
      .strict(),
  )
  .refine((list) => new Set(list.map((e) => e.id)).size === list.length, "Each id appears once.");

const withModels = listedSchema.superRefine((list, ctx) => {
  const without = list.filter((e) => e.model === undefined).map((e) => `"${e.id}"`);
  if (without.length > 0) {
    ctx.addIssue({ code: "custom", message: `"model" is required: add the model to Endpoint ${without.join(", ")}.` });
  }
});

/** The `keys` setting: a JSON object from Endpoint id to key. */
const keysSchema = z.record(z.string(), z.string());

const parseJson = <T>(schema: z.ZodType<T>, text: string): z.ZodSafeParseResult<T> => {
  try {
    return schema.safeParse(JSON.parse(text));
  } catch {
    return schema.safeParse(Symbol("not JSON"));
  }
};

/** Validates a setting's JSON text without changing it, for `experimental_schema`. */
const jsonText = <T>(schema: z.ZodType<T>, empty: string) =>
  z.string().superRefine((text, ctx) => {
    const parsed = parseJson(schema, text.trim() || empty);
    if (!parsed.success) ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "Not valid JSON." });
  });

export const endpointsText = jsonText(withModels, "[]");
export const keysText = jsonText(keysSchema, "{}");

/**
 * The Endpoints the settings define, unexpanded, each with its key in effect:
 * its entry in `keys`, else its own `${NAME}` reference.
 */
export function resolveEndpoints(settings: { endpoints: string; keys?: string }): Endpoint[] {
  const listed = parseJson(listedSchema, settings.endpoints.trim() || "[]");
  const keys = parseJson(keysSchema, settings.keys?.trim() || "{}");
  return (listed.success ? listed.data : []).map(({ id, url, key, model }) => ({
    id,
    url,
    key: (keys.success ? keys.data[id]?.trim() : undefined) || key || null,
    model: model ?? null,
  }));
}

/** The variables an Endpoint's url and key in effect reference, each once. */
const references = (endpoint: Endpoint): string[] => [
  ...new Set([...`${endpoint.url} ${endpoint.key ?? ""}`.matchAll(REFERENCE)].map((m) => m[1])),
];

/** The variables an Endpoint's url and key in effect reference that are unset or empty in `env`. */
export function missingVariables(endpoint: Endpoint, env: Readonly<Record<string, string | undefined>>): string[] {
  return references(endpoint).filter((name) => !env[name]?.trim());
}

/** Whether an Endpoint can answer, as bb's `status()` reports it. */
export type EndpointStatus = { ready: true } | { ready: false; message: string };

/**
 * Whether an Endpoint can answer, from its configuration alone.
 *
 * Args:
 *   endpoint: The Endpoint, unexpanded.
 *   missing: The variables it references that bb's environment on the primary
 *     host lacks, from `missingVariables` there.
 */
export function endpointStatus(endpoint: Endpoint, missing: readonly string[]): EndpointStatus {
  const reasons = [
    ...(endpoint.model === null ? ['The Endpoint needs a model: add "model" to it in the endpoints setting.'] : []),
    ...(missing.length > 0 ? [`Not set in bb's environment: ${missing.join(", ")}.`] : []),
  ];
  return reasons.length === 0 ? { ready: true } : { ready: false, message: reasons.join(" ") };
}

/** An Endpoint ready to send to: its references expanded and its model set. */
export interface ExpandedEndpoint {
  id: string;
  /** Without trailing slashes. */
  url: string;
  key: string | null;
  model: string;
}

/** The Endpoint with its references replaced from `env`; call `missingVariables` first. */
export function expandEndpoint(endpoint: Endpoint & { model: string }, env: Readonly<Record<string, string | undefined>>): ExpandedEndpoint {
  const expand = (text: string) => text.replace(REFERENCE, (_, name: string) => env[name]?.trim() ?? "");
  return {
    id: endpoint.id,
    url: expand(endpoint.url).replace(/\/+$/, ""),
    key: endpoint.key === null ? null : expand(endpoint.key),
    model: endpoint.model,
  };
}

/**
 * A function that takes out of a text every secret the expanded Endpoint
 * carries: each expanded `${NAME}` value, and the host of one that is a URL,
 * goes back to its `${NAME}`, and a literal key becomes `<key>`.
 */
export function redactor(endpoint: Endpoint, env: Readonly<Record<string, string | undefined>>): (text: string) => string {
  const secrets = new Map<string, string>();
  for (const name of references(endpoint)) {
    const value = env[name]?.trim();
    if (!value) continue;
    secrets.set(value, `\${${name}}`);
    // A server echoes a URL's host alone, in a Host header or its own URL.
    const host = URL.canParse(value) ? new URL(value).host : "";
    if (host) secrets.set(host, `\${${name}}`);
  }
  if (endpoint.key !== null && !endpoint.key.includes("${")) secrets.set(endpoint.key, "<key>");
  // Longest first, so a value that holds another is replaced whole.
  const values = [...secrets.keys()].sort((a, b) => b.length - a.length);
  return (text) => values.reduce((out, value) => out.split(value).join(secrets.get(value)), text);
}
