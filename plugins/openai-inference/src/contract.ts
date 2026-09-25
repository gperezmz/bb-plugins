/**
 * The host method the server calls (`bb.hosts.experimental_client`):
 * `configure` carries the endpoints to the host entry, where the plugin's
 * settings cannot be read, and answers which variables each one lacks there. The host entry adds bb's AI-service methods in
 * `host-contract.ts`; bb's server runtime has no `@get-bb/plugin-sdk/ai-services`
 * module, so this file must not import it.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { endpointListSchema } from "./endpoints.js";

export const configureContract = defineRpcContract({
  configure: {
    input: endpointListSchema,
    output: z.array(z.object({ id: z.string(), missing: z.array(z.string()) }).strict()),
  },
});
