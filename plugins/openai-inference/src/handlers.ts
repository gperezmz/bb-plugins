/** The host entry's handlers, apart from the entry so tests can build them. */
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions } from "./complete.js";
import { readEndpoints, writeEndpoints } from "./endpoints.js";
import type { hostContract } from "./host-contract.js";

/**
 * Builds the handlers.
 *
 * Args:
 *   fetchImpl: Replaces `fetch` in tests.
 */
export function createHandlers(fetchImpl?: CompleteOptions["fetch"]): ExperimentalHostRpcHandlers<typeof hostContract> {
  const learned = new Map<string, string[]>();
  return {
    configure: async (input, context) => {
      await writeEndpoints(context.experimental_paths.dataDir, input);
      return null;
    },
    "ai.inference.complete": async (input, context) => {
      const endpoint = (await readEndpoints(context.experimental_paths.dataDir)).find((e) => e.id === input.serviceId);
      if (endpoint === undefined) {
        return { ok: false, code: "request_failed", message: `No endpoint "${input.serviceId}" in the plugin's settings.` };
      }
      return complete(input, endpoint, { learned, signal: context.signal, fetch: fetchImpl });
    },
    "ai.voice.transcribe": () => ({
      ok: false,
      code: "request_failed",
      message: "OpenAI-compatible inference does not transcribe speech.",
    }),
  };
}
