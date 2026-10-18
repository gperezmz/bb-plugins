/** The host entry's handlers, apart from the entry so tests can build them. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { complete, type CompleteOptions } from "./complete.js";
import type { contract } from "./contract.js";
import { endpointStatus, expandEndpoint, missingVariables, redactor } from "./endpoints.js";
import { readKeys, writeKeys, type Keys } from "./keys.js";
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

  // Every change to the keys file reads it and writes it back, so they run one at a time.
  let keying: Promise<unknown> = Promise.resolve();
  const changeKeys = (dataDir: string, change: (keys: Keys) => void): Promise<null> => {
    const done = keying.then(async () => {
      // A file that cannot be read is not replaced: that would delete every key in it.
      const keys = await readKeys(dataDir).catch(() => {
        throw new Error("keys.json in the plugin's data directory cannot be read, so no key was changed: delete it and type the keys again.");
      });
      change(keys);
      await writeKeys(dataDir, keys);
    });
    keying = done.catch(() => undefined);
    return done.then(() => null);
  };

  return {
    putKey: ({ id, url, key }, context) =>
      changeKeys(context.experimental_paths.dataDir, (keys) => {
        keys[id] = { url, key };
      }),
    removeKey: ({ id }, context) =>
      changeKeys(context.experimental_paths.dataDir, (keys) => {
        delete keys[id];
      }),
    configure: async (input, context) => {
      const { dataDir } = context.experimental_paths;
      await rm(join(dataDir, OLD_ENDPOINTS_FILE), { force: true });
      // What a URL refused says nothing about the URL an Endpoint moves to.
      const fields = await loadLearned(dataDir);
      // An empty list is what the server sends before it has the Endpoints, as while it copies 0.3's settings, so it forgets nothing.
      const stale = input.length === 0 ? [] : Object.keys(fields).filter((url) => !input.some((endpoint) => endpoint.url === url));
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
      // A key is used only for the URL it was typed for.
      const held = endpoint.key.kind === "literal" ? await readKeys(dataDir).then((keys) => keys[endpoint.id], () => undefined) : undefined;
      const literalKey = held !== undefined && held.url === endpoint.url ? held.key : null;
      if (endpoint.key.kind === "literal" && literalKey === null) {
        return { ok: false, message: `Endpoint "${endpoint.id}" cannot answer: its literal key is not saved for its URL.` };
      }
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
      const redact = redactor(endpoint, env, literalKey);
      try {
        const text = await complete(prompt, expandEndpoint({ ...endpoint, model }, env, literalKey), {
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
