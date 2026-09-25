/** The host entry's handlers, apart from the entry so tests can build them. */
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions } from "./complete.js";
import { expandEndpoint, missingVariables, readEndpoints, writeEndpoints } from "./endpoints.js";
import type { hostContract } from "./host-contract.js";

/**
 * Builds the handlers.
 *
 * Args:
 *   env: bb's environment, which `${NAME}` references are expanded from.
 *   fetchImpl: Replaces `fetch` in tests.
 */
export function createHandlers(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: CompleteOptions["fetch"],
): ExperimentalHostRpcHandlers<typeof hostContract> {
  const learned = new Map<string, string[]>();
  return {
    configure: async (input, context) => {
      await writeEndpoints(context.experimental_paths.dataDir, input);
      return input.map((endpoint) => ({ id: endpoint.id, missing: missingVariables(endpoint, env) }));
    },
    "ai.inference.complete": async (input, context) => {
      const endpoint = (await readEndpoints(context.experimental_paths.dataDir)).find((e) => e.id === input.serviceId);
      if (endpoint === undefined) {
        return { ok: false, code: "request_failed", message: `No endpoint "${input.serviceId}" in the plugin's settings.` };
      }
      const missing = missingVariables(endpoint, env);
      if (missing.length > 0) {
        return { ok: false, code: "request_failed", message: `Not set in bb's environment: ${missing.join(", ")}.` };
      }
      return complete(input, expandEndpoint(endpoint, env), { learned, signal: context.signal, fetch: fetchImpl });
    },
    "ai.voice.transcribe": () => ({
      ok: false,
      code: "request_failed",
      message: "OpenAI-compatible inference does not transcribe speech.",
    }),
  };
}
