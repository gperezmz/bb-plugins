/** The host entry's handlers, apart from the entry so tests can build them. */
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions } from "./complete.js";
import { expandEndpoint, missingVariables, readEndpoints, writeEndpoints } from "./endpoints.js";
import type { hostContract } from "./host-contract.js";
import { readLearned, writeLearned, type LearnedFields } from "./learned.js";

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
  // Read on the first call, since bb gives the data directory only then.
  let learned: Promise<LearnedFields> | undefined;
  const loadLearned = (dataDir: string) => (learned ??= readLearned(dataDir));
  // One write at a time, as every write uses the same temporary file. A
  // failed write costs only the refusals it would have saved.
  let saving = Promise.resolve();
  const saveLearned = (dataDir: string, fields: LearnedFields) =>
    (saving = saving.then(() => writeLearned(dataDir, fields)).catch(() => undefined));

  return {
    configure: async (input, context) => {
      const { dataDir } = context.experimental_paths;
      await writeEndpoints(dataDir, input);
      // What a URL refused says nothing about the URL an endpoint moves to.
      const fields = await loadLearned(dataDir);
      const stale = Object.keys(fields).filter((url) => !input.some((endpoint) => endpoint.url === url));
      for (const url of stale) delete fields[url];
      if (stale.length > 0) await saveLearned(dataDir, fields);
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
      const { dataDir } = context.experimental_paths;
      const fields = await loadLearned(dataDir);
      let changed = false;
      const learned = {
        fields: fields[endpoint.url]?.[input.model] ?? [],
        save: (dropped: readonly string[]) => {
          const models = (fields[endpoint.url] ??= {});
          if (dropped.length > 0) models[input.model] = [...dropped];
          else delete models[input.model];
          if (Object.keys(models).length === 0) delete fields[endpoint.url];
          changed = true;
        },
      };
      const output = await complete(input, expandEndpoint(endpoint, env), { learned, signal: context.signal, fetch: fetchImpl });
      if (changed) await saveLearned(dataDir, fields);
      return output;
    },
    "ai.voice.transcribe": () => ({
      ok: false,
      code: "request_failed",
      message: "OpenAI-compatible inference does not transcribe speech.",
    }),
  };
}
