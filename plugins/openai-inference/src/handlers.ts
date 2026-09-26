/** The host entry's handlers, apart from the entry so tests can build them. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions } from "./complete.js";
import type { contract } from "./contract.js";
import { endpointStatus, expandEndpoint, missingVariables, redactor } from "./endpoints.js";
import { readLearned, writeLearned, type LearnedFields } from "./learned.js";

/**
 * Where 0.1 kept the Endpoints, keys included; 0.2 is sent each Endpoint with
 * its request, so the file only holds keys that may be stale.
 */
const OLD_ENDPOINTS_FILE = "endpoints.json";

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
): ExperimentalHostRpcHandlers<typeof contract> {
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
      await rm(join(dataDir, OLD_ENDPOINTS_FILE), { force: true });
      // What a URL refused says nothing about the URL an Endpoint moves to.
      const fields = await loadLearned(dataDir);
      const stale = Object.keys(fields).filter((url) => !input.some((endpoint) => endpoint.url === url));
      for (const url of stale) delete fields[url];
      if (stale.length > 0) await saveLearned(dataDir, fields);
      return input.map((endpoint) => ({ id: endpoint.id, missing: missingVariables(endpoint, env) }));
    },
    complete: async ({ endpoint, prompt }, context) => {
      const status = endpointStatus(endpoint, missingVariables(endpoint, env));
      if (!status.ready || endpoint.model === null) {
        return { ok: false, message: `Endpoint "${endpoint.id}" cannot answer: ${status.ready ? "it has no model." : status.message}` };
      }
      const { model } = endpoint;
      const { dataDir } = context.experimental_paths;
      const fields = await loadLearned(dataDir);
      let changed = false;
      const learnedFields = {
        fields: fields[endpoint.url]?.[model] ?? [],
        save: (dropped: readonly string[]) => {
          const models = (fields[endpoint.url] ??= {});
          if (dropped.length > 0) models[model] = [...dropped];
          else delete models[model];
          if (Object.keys(models).length === 0) delete fields[endpoint.url];
          changed = true;
        },
      };
      const redact = redactor(endpoint, env);
      try {
        const text = await complete(prompt, expandEndpoint({ ...endpoint, model }, env), {
          learned: learnedFields,
          signal: context.signal,
          redact,
          fetch: fetchImpl,
        });
        return { ok: true, text };
      } catch (error) {
        return { ok: false, message: redact(error instanceof Error ? error.message : String(error)) };
      } finally {
        if (changed) await saveLearned(dataDir, fields);
      }
    },
  };
}
