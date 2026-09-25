/**
 * The OpenAI-compatible servers bb can send helper completions to. Each one
 * is an AI service whose id the user puts in `BB_INFERENCE=<id>/<model>`.
 *
 * An endpoint's url and key may reference bb's environment as `${NAME}`. The
 * server hands the endpoints to the host entry unexpanded; the host entry,
 * which runs with bb's environment, expands them for each request and writes
 * the expanded values nowhere.
 */
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const endpointSchema = z
  .object({
    id: z.string().min(1),
    /** Base URL that `/chat/completions` is appended to; may hold `${NAME}`. */
    url: z.string().min(1),
    /** A literal key from the `keys` setting, or a `${NAME}` reference. */
    key: z.string().nullable(),
  })
  .strict();
export type Endpoint = z.infer<typeof endpointSchema>;
export const endpointListSchema = z.array(endpointSchema);

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const httpUrl = z.url({ protocol: /^https?$/ });

/** The `endpoints` setting: a JSON list of `{id, url, key?}`. */
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
        key: z
          .string()
          .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/, "A key here can only be a ${NAME} reference; put a literal key in Endpoint keys.")
          .optional(),
      })
      .strict(),
  )
  .refine((list) => new Set(list.map((e) => e.id)).size === list.length, "Each id appears once.");

/** The `keys` setting: a JSON object from endpoint id to key. */
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

export const endpointsText = jsonText(listedSchema, "[]");
export const keysText = jsonText(keysSchema, "{}");

/**
 * The endpoints the settings define, unexpanded. A key in `keys` wins over
 * the endpoint's own `${NAME}` reference.
 */
export function resolveEndpoints(settings: { endpoints: string; keys?: string }): Endpoint[] {
  const listed = parseJson(listedSchema, settings.endpoints.trim() || "[]");
  const keys = parseJson(keysSchema, settings.keys?.trim() || "{}");
  return (listed.success ? listed.data : []).map(({ id, url, key }) => ({
    id,
    url,
    key: (keys.success ? keys.data[id]?.trim() : undefined) || key || null,
  }));
}

/** The variables an endpoint references that are unset or empty in `env`. */
export function missingVariables(endpoint: Endpoint, env: Readonly<Record<string, string | undefined>>): string[] {
  const names = [...`${endpoint.url} ${endpoint.key ?? ""}`.matchAll(REFERENCE)].map((m) => m[1]);
  return [...new Set(names.filter((name) => !env[name]?.trim()))];
}

/** The endpoint with its references replaced from `env`; call `missingVariables` first. */
export function expandEndpoint(endpoint: Endpoint, env: Readonly<Record<string, string | undefined>>): Endpoint {
  const expand = (text: string) => text.replace(REFERENCE, (_, name: string) => env[name]?.trim() ?? "");
  return { id: endpoint.id, url: expand(endpoint.url).replace(/\/+$/, ""), key: endpoint.key === null ? null : expand(endpoint.key) };
}

const ENDPOINTS_FILE = "endpoints.json";

/** Reads the endpoints the server last sent; none sent yet reads as none. */
export async function readEndpoints(dataDir: string): Promise<Endpoint[]> {
  try {
    const parsed = endpointListSchema.safeParse(JSON.parse(await readFile(join(dataDir, ENDPOINTS_FILE), "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Replaces the stored endpoints; the file holds keys, so only its owner may read it. */
export async function writeEndpoints(dataDir: string, endpoints: Endpoint[]): Promise<void> {
  const file = join(dataDir, ENDPOINTS_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(endpoints), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}
