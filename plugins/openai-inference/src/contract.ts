/**
 * The host entry's methods, which the server calls on the primary host
 * (`bb.hosts.experimental_client`). `configure` carries the Endpoints there,
 * where the plugin's settings cannot be read, and answers which variables
 * each one lacks in bb's environment. `complete` sends one AI task's prompt
 * to an Endpoint and answers with its text or why it could not.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { endpointListSchema, endpointSchema } from "./endpoints.js";

export const contract = defineRpcContract({
  configure: {
    input: endpointListSchema,
    output: z.array(z.object({ id: z.string(), missing: z.array(z.string()) }).strict()),
  },
  complete: {
    input: z.object({ endpoint: endpointSchema, prompt: z.string() }).strict(),
    output: z.union([
      z.object({ ok: z.literal(true), text: z.string() }).strict(),
      z.object({ ok: z.literal(false), message: z.string().min(1) }).strict(),
    ]),
  },
});
