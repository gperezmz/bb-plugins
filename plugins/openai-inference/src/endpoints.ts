/**
 * The Endpoints: each an OpenAI-compatible server and the model it answers
 * with, which bb offers as one AI service. The plugin keeps them in its own
 * storage and edits them on its page in Settings.
 *
 * An Endpoint's url and variable key may reference bb's environment as
 * `${NAME}`. The server hands the Endpoints to the host entry unexpanded; the
 * host entry, which runs with bb's environment, expands them for each request
 * and writes the expanded values nowhere.
 *
 * An Endpoint never holds a literal key. The key the Endpoint holds is a
 * kind, and a literal key itself is kept by the host entry alone, in a file
 * only its owner reads (`keys.ts`).
 */
import { z } from "zod";

/** The key an Endpoint sends as a Bearer token, by where it comes from. */
export const keySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  /** A `${NAME}` reference to bb's environment. */
  z.object({ kind: z.literal("variable"), reference: z.string().min(1) }).strict(),
  /** A key the host entry holds; `set` is false while none is saved, as after the URL changed. */
  z.object({ kind: z.literal("literal"), set: z.boolean() }).strict(),
]);
export type EndpointKey = z.infer<typeof keySchema>;

export const endpointSchema = z
  .object({
    id: z.string().min(1),
    /** Base URL that `/chat/completions` is appended to; may hold `${NAME}`. */
    url: z.string().min(1),
    key: keySchema,
    /** The model every request names; null only for an Endpoint copied from a setting saved before 0.2.0. */
    model: z.string().nullable(),
  })
  .strict();
export type Endpoint = z.infer<typeof endpointSchema>;
export const endpointListSchema = z.array(endpointSchema);

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The variables an Endpoint's url and variable key reference, each once. */
const references = (endpoint: Endpoint): string[] => [
  ...new Set(
    [...`${endpoint.url} ${endpoint.key.kind === "variable" ? endpoint.key.reference : ""}`.matchAll(REFERENCE)].map((m) => m[1]),
  ),
];

/** The variables an Endpoint's url and variable key reference that are unset or empty in `env`. */
export function missingVariables(endpoint: Endpoint, env: Readonly<Record<string, string | undefined>>): string[] {
  return references(endpoint).filter((name) => !env[name]?.trim());
}

/** Where an Endpoint is edited, as a not-ready reason names it. */
const PAGE = "the Endpoints section of the plugin's page under Settings → Installed plugins → OpenAI-compatible inference";

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
    ...(endpoint.model === null ? [`The Endpoint needs a model: enter it in ${PAGE}.`] : []),
    ...(endpoint.key.kind === "literal" && !endpoint.key.set ? [`The Endpoint's key is Literal and not set: enter it in ${PAGE}.`] : []),
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

/**
 * The Endpoint with its references replaced from `env` and its key in
 * effect; call `missingVariables` first.
 *
 * Args:
 *   endpoint: The Endpoint, with its model set.
 *   env: bb's environment.
 *   literalKey: The Endpoint's literal key, read from the host entry's file;
 *     used only where the Endpoint's key is Literal.
 */
export function expandEndpoint(
  endpoint: Endpoint & { model: string },
  env: Readonly<Record<string, string | undefined>>,
  literalKey: string | null,
): ExpandedEndpoint {
  const expand = (text: string) => text.replace(REFERENCE, (_, name: string) => env[name]?.trim() ?? "");
  const { key } = endpoint;
  return {
    id: endpoint.id,
    url: expand(endpoint.url).replace(/\/+$/, ""),
    key: key.kind === "variable" ? expand(key.reference) : key.kind === "literal" ? literalKey : null,
    model: endpoint.model,
  };
}

/**
 * A function that takes out of a text every secret the expanded Endpoint
 * carries: each expanded `${NAME}` value, and the host of one that is a URL,
 * goes back to its `${NAME}`, and a literal key becomes `<key>`.
 */
export function redactor(
  endpoint: Endpoint,
  env: Readonly<Record<string, string | undefined>>,
  literalKey: string | null,
): (text: string) => string {
  const secrets = new Map<string, string>();
  for (const name of references(endpoint)) {
    const value = env[name]?.trim();
    if (!value) continue;
    secrets.set(value, `\${${name}}`);
    // A server echoes a URL's host alone, in a Host header or its own URL.
    const host = URL.canParse(value) ? new URL(value).host : "";
    if (host) secrets.set(host, `\${${name}}`);
  }
  if (literalKey !== null && literalKey !== "") secrets.set(literalKey, "<key>");
  // Longest first, so a value that holds another is replaced whole.
  const values = [...secrets.keys()].sort((a, b) => b.length - a.length);
  return (text) => values.reduce((out, value) => out.split(value).join(secrets.get(value)), text);
}
