/** The host entry's handlers, apart from the entry so tests can build them. */
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions, type Features } from "./complete.js";
import { isServiceId } from "./contract.js";
import type { hostContract } from "./host-contract.js";
import { readSettings, resolveEndpoint, writeSettings } from "./endpoint.js";

/**
 * Builds the handlers.
 *
 * Args:
 *   env: The environment the gateway's variables are read from.
 *   fetchImpl: Replaces `fetch` in tests.
 */
export function createHandlers(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: CompleteOptions["fetch"],
): ExperimentalHostRpcHandlers<typeof hostContract> {
  const learned = new Map<string, Features>();
  return {
    configure: async (input, context) => {
      await writeSettings(context.experimental_paths.dataDir, input);
      return null;
    },
    "ai.inference.complete": async (input, context) => {
      if (!isServiceId(input.serviceId)) {
        return { ok: false, code: "request_failed", message: `This plugin serves no AI service "${input.serviceId}".` };
      }
      const endpoint = resolveEndpoint(input.serviceId, await readSettings(context.experimental_paths.dataDir), env);
      if ("missing" in endpoint) return { ok: false, code: "request_failed", message: endpoint.missing };
      return complete(input, endpoint, {
        thinkingOff: input.serviceId === "gateway" ? "reasoning_effort" : "enable_thinking",
        learned,
        signal: context.signal,
        fetch: fetchImpl,
      });
    },
    "ai.voice.transcribe": () => ({
      ok: false,
      code: "request_failed",
      message: "OpenAI-compatible inference does not transcribe speech.",
    }),
  };
}
