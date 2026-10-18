/**
 * What the plugin's page in Settings calls on the server: the Endpoints, and
 * each change to them. No method returns a literal key; `saveEndpoint` is the
 * only one that takes one, and only from this page.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { endpointListSchema } from "./endpoints.js";

const draftSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    model: z.string(),
    key: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z.object({ kind: z.literal("variable"), reference: z.string() }).strict(),
      z.object({ kind: z.literal("literal"), value: z.string().nullable() }).strict(),
    ]),
  })
  .strict();

const fieldErrorsSchema = z
  .object({ id: z.string(), url: z.string(), model: z.string(), key: z.string() })
  .partial()
  .strict();

/** A change that was made, with the Endpoints now saved; or a refusal. */
const changeSchema = z.union([
  z.object({ ok: z.literal(true), endpoints: endpointListSchema }).strict(),
  z.object({ ok: z.literal(false), fields: fieldErrorsSchema }).strict(),
  z.object({ ok: z.literal(false), problem: z.string() }).strict(),
]);

export const pageContract = defineRpcContract({
  endpoints: {
    input: z.null(),
    output: z
      .object({
        endpoints: endpointListSchema,
        /** What the page says about the Endpoints 0.3 saved, or null once they are copied. */
        notice: z.string().nullable(),
      })
      .strict(),
  },
  saveEndpoint: {
    input: z.object({ draft: draftSchema, create: z.boolean() }).strict(),
    output: changeSchema,
  },
  removeEndpoint: {
    input: z.object({ id: z.string() }).strict(),
    output: changeSchema,
  },
});
