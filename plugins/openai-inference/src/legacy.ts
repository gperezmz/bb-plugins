/**
 * The Endpoints and keys as 0.3 saved them, in two JSON settings
 * (`endpoints` and `keys`), read for the one-time copy into the plugin's own
 * storage. Names no framework.
 */
import { z } from "zod";
import type { Endpoint } from "./endpoints.js";
import { isVariableReference } from "./rules.js";

const entrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "An id is lowercase letters, digits and dashes."),
    url: z.string().refine((url) => url.includes("${") || (/^https?:\/\//.test(url) && URL.canParse(url)), "A url is an http:// or https:// URL, or references a variable as ${NAME}."),
    /** Optional so that a setting saved before 0.2.0 still lists its Endpoints. */
    model: z.string().trim().min(1).optional(),
    key: z.string().refine(isVariableReference, "A key here can only be a ${NAME} reference.").optional(),
  })
  .strict();
const endpointsSchema = z.array(entrySchema).refine((list) => new Set(list.map((e) => e.id)).size === list.length, "Each id appears once.");
const keysSchema = z.record(z.string(), z.string());

/** One Endpoint to copy, with the literal key to keep for it. */
export interface Legacy {
  endpoint: Endpoint;
  /** The literal key from `keys`, which wins over the Endpoint's own reference; null when none. */
  literalKey: string | null;
}

export type LegacyRead = { ok: true; items: Legacy[] } | { ok: false; reason: string };

const parse = <T>(schema: z.ZodType<T>, text: string, name: string): { ok: true; value: T } | { ok: false; reason: string } => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `The ${name} setting is not valid JSON.` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: `The ${name} setting is not valid: ${parsed.error.issues[0]?.message ?? "unreadable"}` };
};

/**
 * Reads the two settings' text. An empty or unset setting reads as none; a key
 * for an id no Endpoint has is dropped.
 */
export function readLegacy(endpointsText: string | undefined, keysText: string | undefined): LegacyRead {
  const endpoints = parse(endpointsSchema, endpointsText?.trim() || "[]", "endpoints");
  if (!endpoints.ok) return endpoints;
  const keys = parse(keysSchema, keysText?.trim() || "{}", "keys");
  if (!keys.ok) return keys;
  return {
    ok: true,
    items: endpoints.value.map(({ id, url, model, key }) => {
      const literalKey = keys.value[id]?.trim() || null;
      return {
        endpoint: {
          id,
          url: url.trim(),
          model: model ?? null,
          key: literalKey !== null ? { kind: "literal", set: true } : key !== undefined ? { kind: "variable", reference: key } : { kind: "none" },
        },
        literalKey,
      };
    }),
  };
}
