/**
 * The OpenAI-compatible servers bb can send helper completions to. Each one
 * is an AI service whose id the user puts in `BB_INFERENCE=<id>/<model>`.
 *
 * The server reads them from the settings, adds `gateway` from bb's
 * environment, and hands the result to the host entry, which cannot read the
 * settings and keeps them in a file only its user can read, so a restarted
 * worker still has them.
 */
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const endpointSchema = z
  .object({
    id: z.string().min(1),
    /** Base URL that `/chat/completions` is appended to, without a trailing slash. */
    url: z.string().min(1),
    key: z.string().nullable(),
  })
  .strict();
export type Endpoint = z.infer<typeof endpointSchema>;
export const endpointListSchema = z.array(endpointSchema);

/** The `endpoints` setting: a JSON list of `{id, url}`. */
const listedSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "An id is lowercase letters, digits and dashes."),
        url: z.url({ protocol: /^https?$/, error: "A url is an http:// or https:// URL." }),
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

const trimmed = (value: string | undefined): string | null => value?.trim() || null;

/**
 * The endpoints the settings and bb's environment define.
 *
 * Args:
 *   settings: The `endpoints` and `keys` settings, as stored.
 *   env: bb's environment. With `GATEWAY_URL` set and no endpoint called
 *     `gateway` listed, adds `gateway`, keyed by `GATEWAY_VIRTUAL_KEY` unless
 *     `keys` has one for it.
 */
export function resolveEndpoints(
  settings: { endpoints: string; keys?: string },
  env: Readonly<Record<string, string | undefined>>,
): Endpoint[] {
  const listed = parseJson(listedSchema, settings.endpoints.trim() || "[]");
  const keys = parseJson(keysSchema, settings.keys?.trim() || "{}");
  const keyOf = (id: string) => (keys.success ? trimmed(keys.data[id]) : null);
  const endpoints: Endpoint[] = (listed.success ? listed.data : []).map(({ id, url }) => ({
    id,
    url: url.replace(/\/+$/, ""),
    key: keyOf(id),
  }));
  const gatewayUrl = trimmed(env.GATEWAY_URL);
  if (gatewayUrl !== null && !endpoints.some((e) => e.id === "gateway")) {
    endpoints.push({ id: "gateway", url: gatewayUrl.replace(/\/+$/, ""), key: keyOf("gateway") ?? trimmed(env.GATEWAY_VIRTUAL_KEY) });
  }
  return endpoints;
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
